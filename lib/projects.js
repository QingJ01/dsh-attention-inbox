/**
 * Project timelines (docs/010-project-timeline.md): what every Session of a
 * Workspace asked, concluded and changed, read from the Session logs.
 *
 * Read-only by construction: logs are read through `sessionQuery.readSession`,
 * which never makes a Session live; nothing is prompted, created or stored.
 * Digests are cached in memory by the Session's last update the browser saw,
 * and built a few at a time so a large project fills in progressively.
 */
import { z } from 'zod'

export const PROJECTS_ROUTE = '/api/attention-projects'
export const DIGESTS_PER_REQUEST = 6
export const TIMELINE_LIMIT = 240
export const SESSION_TURN_LIMIT = 200
const CACHE_LIMIT = 600
const ASK_MAX = 280
const ANSWER_MAX = 480

const factsSchema = z.array(z.object({
  id: z.string().min(1).max(200), updatedAt: z.number().optional(), running: z.boolean().optional(),
})).max(2000)

/** Collapse markdown into plain readable text: code blocks, markers and links go, whitespace folds. */
export function plainText(text, max) {
  if (typeof text !== 'string') return ''
  const out = text
    .replace(/```[\s\S]*?(```|$)/g, ' ')
    .replace(/<[^>\n]{1,80}>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, '')
    // Emphasis markers go; underscores stay, they are part of identifiers like DEEPSEEK_API_KEY.
    .replace(/\*\*|__(?=\S)|(?<=\S)__|[*`~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return out.length > max ? `${out.slice(0, max - 1).trimEnd()}…` : out
}

const textOf = (content) => Array.isArray(content)
  ? content.filter((block) => block?.type === 'text' && typeof block.text === 'string').map((block) => block.text).join('\n')
  : ''

/** Paths a write-capable tool call touched; unknown tools contribute nothing. */
export function filesOfCall(name, args) {
  if (typeof args !== 'string') return []
  if (name === 'apply_patch' || /\*\*\* (Add|Update|Delete) File: /.test(args)) {
    let patch = args
    try { const parsed = JSON.parse(args); patch = typeof parsed === 'string' ? parsed : Object.values(parsed ?? {}).filter((v) => typeof v === 'string').join('\n') } catch {}
    return [...patch.matchAll(/\*\*\* (?:Add File|Update File|Delete File|Move to): ([^\n\r]+)/g)].map((m) => m[1].trim()).filter(Boolean)
  }
  if (name !== 'edit' && name !== 'write' && name !== 'multi_edit' && name !== 'notebook_edit') return []
  try {
    const parsed = JSON.parse(args)
    const path = parsed?.file_path ?? parsed?.path ?? parsed?.notebook_path
    return typeof path === 'string' && path.trim() ? [path.trim()] : []
  } catch { return [] }
}
function commandOfCall(name, args) {
  if (name !== 'bash' || typeof args !== 'string') return undefined
  try { const command = JSON.parse(args)?.command; return typeof command === 'string' ? command.replace(/\s+/g, ' ').trim().slice(0, 160) : undefined }
  catch { return undefined }
}
const relative = (path, root) => {
  if (!root || typeof path !== 'string') return path
  const base = root.endsWith('/') ? root : `${root}/`
  return path.startsWith(base) ? path.slice(base.length) : path
}

/**
 * One Session log, condensed: every human turn's ask and settled answer, the files and commands it used.
 * @param header - Session header (id, createdAt, origin, parentSession).
 * @param events - complete raw event log, ascending.
 * @param root - Workspace path, to show files relative to it.
 */
export function digestSession(header, events, root) {
  const turns = new Map()
  let title, lastAt = header?.createdAt ?? 0, todos
  const turnOf = (n, time) => {
    if (!turns.has(n)) turns.set(n, { n, at: time, endAt: undefined, ask: '', answer: '', outcome: 'running', files: new Set(), commands: [], commandCount: 0, toolCount: 0 })
    return turns.get(n)
  }
  let current
  for (const event of events ?? []) {
    if (!event || typeof event !== 'object') continue
    if (Number.isFinite(event.time)) lastAt = Math.max(lastAt, event.time)
    const data = event.data ?? {}
    switch (event.type) {
      case 'session/title': if (typeof data.title === 'string' && data.title.trim()) title = data.title.trim(); break
      case 'turn/start': current = turnOf(data.turn, event.time); break
      case 'turn/end': {
        const turn = turnOf(data.turn, event.time)
        turn.endAt = event.time
        turn.outcome = data.reason?.kind === 'completed' ? 'done' : data.reason?.kind === 'error' ? 'error' : data.reason?.kind ?? 'done'
        if (data.reason?.kind === 'error' && !turn.answer) turn.answer = plainText(data.reason.error?.message, ANSWER_MAX)
        break
      }
      case 'user/message': {
        // Only the person's own words; injected context and tool results are not asks.
        if (data.source?.kind !== 'user' || !current) break
        const text = plainText(textOf(data.content), ASK_MAX)
        if (text && !current.ask) current.ask = text
        break
      }
      case 'assistant/message': {
        if (!current) break
        const text = plainText(textOf(data.message?.content), ANSWER_MAX)
        if (text) current.answer = text // the last text-bearing message of the turn is its conclusion
        break
      }
      case 'tool/call': {
        const turn = Number.isFinite(data.turn) ? turnOf(data.turn, event.time) : current
        if (!turn) break
        turn.toolCount++
        for (const path of filesOfCall(data.name, data.arguments)) turn.files.add(relative(path, root))
        const command = commandOfCall(data.name, data.arguments)
        if (command) { turn.commandCount++; if (turn.commands.length < 6) turn.commands.push(command) }
        break
      }
      case 'todo/write': if (Array.isArray(data.todos)) todos = data.todos.slice(0, 30).map((todo) => ({ status: String(todo.status ?? ''), content: plainText(todo.content, 160) })); break
      default: break
    }
  }
  const list = [...turns.values()].filter((turn) => turn.ask || turn.answer || turn.toolCount).sort((a, b) => a.n - b.n)
  const fileCounts = new Map()
  for (const turn of list) for (const path of turn.files) fileCounts.set(path, (fileCounts.get(path) ?? 0) + 1)
  const out = list.map((turn) => ({ ...turn, files: [...turn.files] }))
  const last = out.at(-1)
  return {
    id: header?.id, title: title ?? (out[0]?.ask ? out[0].ask.slice(0, 60) : undefined), createdAt: header?.createdAt ?? out[0]?.at ?? 0, lastAt,
    origin: header?.origin, parentId: header?.parentSession,
    turnCount: out.length, turns: out,
    files: [...fileCounts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([path, count]) => ({ path, count })),
    commandCount: out.reduce((sum, turn) => sum + turn.commandCount, 0),
    outcome: last?.outcome ?? 'empty', todos,
  }
}

export class ProjectsService {
  /** @param options - workspaces() from the registry, sessionQuery() for read-only logs. */
  constructor({ workspaces = () => [], archived = () => [], sessionQuery = () => undefined, warn = () => {} } = {}) {
    this.workspaces = workspaces; this.archived = archived; this.sessionQuery = sessionQuery; this.warn = warn
    this.cache = new Map(); this.records = undefined; this.closed = false; this.building = new Map()
  }
  shutdown() { this.closed = true; this.cache.clear() }

  list() {
    let rows = []
    try { rows = (this.workspaces() ?? []).filter((w) => w && !w.archived) } catch { rows = [] }
    return rows.map((w) => {
      const digests = (w.sessionIds ?? []).map((id) => this.cache.get(id)?.digest).filter(Boolean)
      return { id: w.id, title: w.title, path: w.path, sessionCount: (w.sessionIds ?? []).length,
        lastAt: digests.reduce((max, d) => Math.max(max, d.lastAt ?? 0), 0) || undefined }
    })
  }
  workspace(id) {
    const row = (this.workspaces() ?? []).find((w) => w?.id === id)
    if (!row) throw new Error('UNKNOWN_WORKSPACE')
    return row
  }
  /** Session headers with format status, refreshed at most every 10 s. */
  async headers() {
    const query = this.sessionQuery()
    if (!query?.listSessions) return new Map()
    if (this.records && this.records.at > Date.now() - 10_000) return this.records.map
    const map = new Map((await query.listSessions()).map((record) => [record.header.id, record]))
    this.records = { at: Date.now(), map }
    return map
  }
  /** Digest one Session unless the cached one is as fresh as the browser's view of it. */
  async digest(id, key, root) {
    const cached = this.cache.get(id)
    if (cached && cached.key === key) return cached.digest
    if (this.building.has(id)) return this.building.get(id)
    const query = this.sessionQuery()
    if (!query?.readSession) return cached?.digest
    const task = (async () => {
      const snapshot = await query.readSession(id)
      const digest = digestSession(snapshot.header ?? snapshot.session, snapshot.events, root)
      this.cache.delete(id); this.cache.set(id, { key, digest })
      while (this.cache.size > CACHE_LIMIT) this.cache.delete(this.cache.keys().next().value)
      return digest
    })().finally(() => this.building.delete(id))
    this.building.set(id, task)
    return task
  }

  /**
   * One project: Session summaries, a cross-Session timeline of turns, and the most changed files.
   * @param workspaceId - Workspace to read.
   * @param facts - what the browser knows: updatedAt and running per Session id.
   */
  async project(workspaceId, facts = []) {
    const workspace = this.workspace(workspaceId)
    const seen = new Map(factsSchema.parse(facts).map((row) => [row.id, row]))
    const headers = await this.headers()
    let archived = new Set()
    try { archived = new Set(this.archived() ?? []) } catch {}
    const ids = [...new Set(workspace.sessionIds ?? [])]
    const skipped = []
    const due = []
    for (const id of ids) {
      const record = headers.get(id)
      if (record?.formatStatus === 'migration-required') { skipped.push({ id, reason: 'migration' }); continue }
      if (record && record.header?.origin === 'subagent') continue
      const key = seen.get(id)?.updatedAt ?? (archived.has(id) ? 'archived' : this.cache.get(id)?.key ?? 'unknown')
      if (this.cache.get(id)?.key !== key) due.push({ id, key })
    }
    // Newest first, a few per request: the page fills in while the browser keeps asking.
    due.sort((a, b) => (seen.get(b.id)?.updatedAt ?? 0) - (seen.get(a.id)?.updatedAt ?? 0))
    for (const item of due.slice(0, DIGESTS_PER_REQUEST)) {
      if (this.closed) break
      try { await this.digest(item.id, item.key, workspace.path) }
      catch (error) { skipped.push({ id: item.id, reason: 'unreadable' }); this.warn(error) }
    }
    const pending = Math.max(0, due.length - DIGESTS_PER_REQUEST)
    const subagents = new Map()
    for (const record of headers.values()) {
      const parent = record.header?.parentSession
      if (parent && record.header?.origin === 'subagent') subagents.set(parent, (subagents.get(parent) ?? 0) + 1)
    }
    const digests = ids.map((id) => this.cache.get(id)?.digest).filter((d) => d && d.turnCount > 0)
    const sessions = digests.map((d) => ({
      id: d.id, title: d.title, createdAt: d.createdAt, lastAt: d.lastAt, turnCount: d.turnCount, commandCount: d.commandCount,
      fileCount: d.files.length, files: d.files.slice(0, 5), outcome: d.outcome, archived: archived.has(d.id),
      running: seen.get(d.id)?.running === true, subagents: subagents.get(d.id) ?? 0,
      firstAsk: d.turns[0]?.ask ?? '', lastAnswer: d.turns.at(-1)?.answer ?? '',
      todos: d.todos ? { done: d.todos.filter((t) => t.status === 'completed').length, total: d.todos.length } : undefined,
    })).sort((a, b) => b.lastAt - a.lastAt)
    const timeline = digests.flatMap((d) => d.turns.map((turn) => ({
      sessionId: d.id, n: turn.n, at: turn.at, endAt: turn.endAt, ask: turn.ask, answer: turn.answer, outcome: turn.outcome,
      files: turn.files.slice(0, 6), fileCount: turn.files.length, commandCount: turn.commandCount,
    }))).sort((a, b) => b.at - a.at)
    const hot = new Map()
    for (const d of digests) for (const file of d.files) hot.set(file.path, (hot.get(file.path) ?? 0) + file.count)
    const days = new Set(timeline.map((entry) => new Date(entry.at).toISOString().slice(0, 10)))
    return {
      ok: true,
      workspace: { id: workspace.id, title: workspace.title, path: workspace.path },
      sessions, timeline: timeline.slice(0, TIMELINE_LIMIT), timelineTotal: timeline.length,
      hotFiles: [...hot].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 12).map(([path, count]) => ({ path, count })),
      stats: { sessions: sessions.length, turns: timeline.length, files: hot.size, activeDays: days.size,
        firstAt: timeline.at(-1)?.at, lastAt: timeline[0]?.at },
      pending, skipped,
    }
  }

  /** Every turn of one Session in the project, for its detail view. */
  async session(workspaceId, sessionId, updatedAt) {
    const workspace = this.workspace(workspaceId)
    if (!(workspace.sessionIds ?? []).includes(sessionId)) throw new Error('NOT_IN_WORKSPACE')
    const key = updatedAt ?? this.cache.get(sessionId)?.key ?? 'unknown'
    const digest = await this.digest(sessionId, key, workspace.path)
    if (!digest) throw new Error('UNAVAILABLE')
    return { ok: true, session: { ...digest, turns: digest.turns.slice(-SESSION_TURN_LIMIT), files: digest.files.slice(0, 60) } }
  }

  async handleRoute(request) {
    try {
      const text = await request.text()
      if (text.length > 256 * 1024) return Response.json({ ok: false, code: 'TOO_LARGE' }, { status: 413 })
      const body = JSON.parse(text)
      const headers = { 'cache-control': 'no-store' }
      switch (body.op) {
        case 'list': return Response.json({ ok: true, workspaces: this.list() }, { headers })
        case 'project': return Response.json(await this.project(String(body.workspaceId ?? ''), body.sessions ?? []), { headers })
        case 'session': return Response.json(await this.session(String(body.workspaceId ?? ''), String(body.sessionId ?? ''),
          Number.isFinite(body.updatedAt) ? body.updatedAt : undefined), { headers })
        default: return Response.json({ ok: false, code: 'UNKNOWN_OPERATION' }, { status: 400 })
      }
    } catch (error) {
      const code = error instanceof SyntaxError ? 'BAD_JSON' : error instanceof z.ZodError ? 'INVALID_INPUT' : String(error?.message ?? error)
      return Response.json({ ok: false, code }, { status: error instanceof SyntaxError || error instanceof z.ZodError ? 400 : 409 })
    }
  }
}
