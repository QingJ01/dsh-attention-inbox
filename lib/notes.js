/**
 * Daily notes (docs/009-daily-notes.md): capture → dispatch → track → harvest → schedule.
 *
 * Notes live in their own storage domain, so the inbox ledger schema is
 * untouched and removing the notes data never affects obligations. The
 * timeline, the daily review and every status are derived on read; only
 * what the person decided (text, structure, dates, lanes) and what was
 * harvested from a Session's own log is stored.
 */
import { z } from 'zod'
import { isIsoDate, isoDate, plan, tasksOf, isOpen } from './schedule.js'
import { summarizeActivity } from './service.js'

export const NOTES_ROUTE = '/api/attention-notes'
export const MAX_NOTES = 5000
export const MAX_SUGGESTIONS = 8
export const DEFAULT_NOTE_SETTINGS = {
  capacityMin: 240, reviewCostMin: 15, agentSlots: 2, horizonDays: 7, skipWeekends: false, workspaceId: null,
}

const day = z.string().refine(isIsoDate, 'INVALID_DATE')
const id = z.string().min(1).max(64).regex(/^[A-Za-z0-9_.:-]+$/)
const sessionId = z.string().min(1).max(200)
const planSchema = z.object({
  date: z.union([day, z.literal('later')]).optional(), estimateMin: z.number().int().min(5).max(960).optional(),
  lane: z.enum(['me', 'agent']).optional(),
}).strict()
const noteSchema = z.object({
  id, day, parentId: id.nullable(), order: z.number().finite(), text: z.string().max(4000),
  kind: z.enum(['note', 'suggestion']).default('note'),
  state: z.enum(['open', 'done', 'dropped']).default('open'), closedAt: z.string().optional(),
  createdAt: z.string(), updatedAt: z.string(),
  sessionId: sessionId.optional(), mode: z.enum(['task', 'explore']).optional(), linkedAt: z.string().optional(),
  workspaceId: z.string().min(1).max(200).optional(),
  result: z.object({ text: z.string().max(400), at: z.string() }).strict().optional(),
  harvestedAt: z.number().optional(), dismissed: z.array(z.string().max(400)).max(50).optional(),
  // Every next step already offered for this note: a deleted, accepted-and-edited or dismissed one is never offered again.
  offered: z.array(z.string().max(400)).max(200).optional(),
  plan: planSchema.optional(), plannedFor: z.union([day, z.literal('later')]).optional(),
  rollovers: z.number().int().min(0).optional(), rolledOn: day.optional(),
}).strict()
const settingsSchema = z.object({
  capacityMin: z.number().int().min(30).max(960), reviewCostMin: z.number().int().min(0).max(120),
  agentSlots: z.number().int().min(0).max(10), horizonDays: z.number().int().min(3).max(14),
  skipWeekends: z.boolean(), workspaceId: z.string().min(1).max(200).nullable(),
}).strict()
const stateSchema = z.object({ notes: z.record(z.string(), noteSchema), settings: settingsSchema.default(DEFAULT_NOTE_SETTINGS) })
const empty = () => ({ notes: {}, settings: { ...DEFAULT_NOTE_SETTINGS } })
const patchSchema = z.object({
  id, day: day.optional(), parentId: id.nullable().optional(), order: z.number().finite().optional(), text: z.string().max(4000).optional(),
  state: z.enum(['open', 'done', 'dropped']).optional(), plan: planSchema.nullable().optional(), workspaceId: z.string().min(1).max(200).nullable().optional(),
}).strict()
// What the browser knows about linked Sessions; the Host only reads their logs when they settled after the last harvest.
const sessionsSchema = z.array(z.object({ id: sessionId, updatedAt: z.number(), running: z.boolean() })).max(200)

export async function openNotesStore(ctx) {
  const domain = await ctx.storageDomain.open({ name: 'attention_notes', version: 1, tables: {}, layout: 'single', global: { schema: stateSchema, initial: empty() } })
  return { data: stateSchema.parse(domain.global.get()), async commit(next) { await domain.global.set(next); this.data = next }, close: () => domain.close() }
}

/** Lines of the last ```next-steps block an exploration asked the Agent to end with. Nothing is guessed. */
export function parseNextSteps(text) {
  if (typeof text !== 'string') return []
  const blocks = [...text.matchAll(/```next-steps[^\n]*\n([\s\S]*?)```/g)]
  const block = blocks.at(-1)?.[1]
  if (!block) return []
  return block.split('\n').map((line) => line.replace(/^\s*(?:[-*+]|\d+[.)])\s*(?:\[[ xX]\]\s*)?/, '').trim())
    .filter((line) => line.length > 1).map((line) => line.slice(0, 400)).slice(0, MAX_SUGGESTIONS)
}

export class NotesService {
  /**
   * @param store - persisted notes state.
   * @param options - now, workspaces() for the picker, sessionQuery() for read-only harvest, inboxActed(day) for the review.
   */
  constructor(store, { now = () => new Date(), workspaces = () => [], sessionQuery = () => undefined, inboxActed = () => 0, warn = () => {} } = {}) {
    this.store = store; this.now = now; this.workspaces = workspaces; this.sessionQuery = sessionQuery; this.inboxActed = inboxActed; this.warn = warn
    this.queue = Promise.resolve(); this.closed = false; this.harvesting = new Set()
  }
  transact(change) {
    const task = this.queue.then(async () => {
      if (this.closed) throw new Error('CLOSED')
      const next = structuredClone(this.store.data)
      next.settings = { ...DEFAULT_NOTE_SETTINGS, ...next.settings }
      const value = await change(next)
      if (value === false) return value // nothing changed; skip the write
      await this.store.commit(next)
      return value
    })
    this.queue = task.catch(() => {})
    return task
  }
  async shutdown() { this.closed = true; await this.queue; await this.store.close?.() }
  settings() { return { ...DEFAULT_NOTE_SETTINGS, ...this.store.data.settings } }
  list() { return Object.values(this.store.data.notes).map((note) => structuredClone(note)) }
  today(value) { return isIsoDate(value) ? value : isoDate(this.now()) }
  timeline(today, notes = this.list()) {
    const s = this.settings()
    return plan(notes, { today, capacityMin: s.capacityMin, reviewCostMin: s.reviewCostMin, agentSlots: s.agentSlots, horizonDays: s.horizonDays, skipWeekends: s.skipWeekends })
  }
  state(todayInput) {
    const today = this.today(todayInput)
    const notes = this.list()
    let workspaces = []
    try {
      workspaces = (this.workspaces() ?? []).filter((w) => w && !w.archived).map((w) => ({ id: w.id, title: w.title, path: w.path }))
    } catch { workspaces = [] }
    return { ok: true, today, notes, settings: this.settings(), workspaces, timeline: this.timeline(today, notes), review: this.review(today, notes) }
  }

  /**
   * Count a slip once per day: an open task planned for a day that has passed rolled over.
   * Placement is remembered so tomorrow can tell whether today's plan held.
   */
  sweep(todayInput) {
    const today = this.today(todayInput)
    const placed = new Map()
    const timeline = this.timeline(today)
    for (const dayPlan of timeline.days) for (const item of dayPlan.items) placed.set(item.id, item.date)
    for (const item of timeline.later) placed.set(item.id, 'later')
    const tasks = tasksOf(this.list())
    const stale = tasks.some((note) => (note.plannedFor !== placed.get(note.id)) || (note.plannedFor && note.plannedFor !== 'later' && note.plannedFor < today && note.rolledOn !== today))
    if (!stale) return Promise.resolve(false)
    return this.transact((state) => {
      let changed = false
      for (const task of tasks) {
        const note = state.notes[task.id]
        if (!note) continue
        if (note.plannedFor && note.plannedFor !== 'later' && note.plannedFor < today && note.rolledOn !== today) {
          note.rollovers = (note.rollovers ?? 0) + 1; note.rolledOn = today; changed = true
        }
        const next = placed.get(task.id)
        if (next !== undefined && note.plannedFor !== next) { note.plannedFor = next; changed = true }
      }
      return changed
    })
  }

  upsert(input, today) {
    const patch = patchSchema.parse(input)
    return this.transact((state) => {
      const stamp = this.now().toISOString()
      const existing = state.notes[patch.id]
      if (existing?.kind === 'suggestion' && (patch.text !== undefined || patch.parentId !== undefined)) throw new Error('SUGGESTION_READ_ONLY')
      if (!existing && Object.keys(state.notes).length >= MAX_NOTES) throw new Error('NOTES_FULL')
      const parentId = patch.parentId !== undefined ? patch.parentId : existing?.parentId ?? null
      if (parentId !== null) {
        if (!state.notes[parentId]) throw new Error('UNKNOWN_PARENT')
        for (let cursor = parentId; cursor; cursor = state.notes[cursor]?.parentId) if (cursor === patch.id) throw new Error('CYCLE')
      }
      const siblings = Object.values(state.notes).filter((note) => (note.parentId ?? null) === parentId && note.id !== patch.id)
      const order = patch.order ?? existing?.order ?? (siblings.reduce((max, note) => Math.max(max, note.order), 0) + 1)
      const rootDay = parentId ? rootOf(state.notes, parentId).day : undefined
      const note = existing ? { ...existing } : { id: patch.id, day: patch.day ?? this.today(today), text: '', kind: 'note', state: 'open', createdAt: stamp }
      note.parentId = parentId; note.order = order
      if (rootDay) note.day = rootDay
      else if (patch.day) note.day = patch.day
      if (patch.text !== undefined) note.text = patch.text
      if (patch.state !== undefined && patch.state !== note.state) {
        note.state = patch.state
        if (patch.state === 'open') delete note.closedAt
        else note.closedAt = stamp
      }
      if (patch.workspaceId === null) delete note.workspaceId
      else if (patch.workspaceId !== undefined) note.workspaceId = patch.workspaceId
      if (patch.plan === null) delete note.plan
      // The plan is replaced whole: JSON cannot carry "clear this field", so the browser sends the complete choice.
      else if (patch.plan !== undefined) {
        if (Object.keys(patch.plan).length) note.plan = patch.plan
        else delete note.plan
      }
      note.updatedAt = stamp
      state.notes[note.id] = noteSchema.parse(note)
      // Children follow their root to its day.
      if (!parentId && existing && existing.day !== note.day) for (const child of descendants(state.notes, note.id)) child.day = note.day
    })
  }
  remove(noteId) {
    id.parse(noteId)
    return this.transact((state) => {
      if (!state.notes[noteId]) return false
      for (const child of descendants(state.notes, noteId)) delete state.notes[child.id]
      delete state.notes[noteId]
    })
  }
  link(noteId, session, mode = 'task', workspaceId) {
    id.parse(noteId)
    const ref = sessionId.parse(session)
    const kind = z.enum(['task', 'explore']).parse(mode)
    const workspace = workspaceId === undefined || workspaceId === null ? undefined : z.string().min(1).max(200).parse(workspaceId)
    return this.transact((state) => {
      const note = state.notes[noteId]
      if (!note) throw new Error('UNKNOWN_NOTE')
      if (note.kind !== 'note') throw new Error('SUGGESTION_READ_ONLY')
      // One note, one Session: a second link (another tab, a retry) would orphan the first Agent.
      if (note.sessionId && note.sessionId !== ref) throw new Error('ALREADY_LINKED')
      if (note.sessionId === ref) return false
      const stamp = this.now().toISOString()
      Object.assign(note, { sessionId: ref, mode: kind, linkedAt: stamp, updatedAt: stamp })
      if (workspace) note.workspaceId = workspace
      delete note.result; delete note.harvestedAt
    })
  }
  /** @param expected - when given, only that Session is unlinked; a newer link is left alone. */
  unlink(noteId, expected) {
    id.parse(noteId)
    if (expected !== undefined) sessionId.parse(expected)
    return this.transact((state) => {
      const note = state.notes[noteId]
      if (!note || !note.sessionId || (expected !== undefined && note.sessionId !== expected)) return false
      for (const key of ['sessionId', 'mode', 'linkedAt', 'result', 'harvestedAt']) delete note[key]
      note.updatedAt = this.now().toISOString()
    })
  }
  /** A suggestion becomes an ordinary note; the person owns it from now on. */
  accept(noteId) {
    id.parse(noteId)
    return this.transact((state) => {
      const note = state.notes[noteId]
      if (!note || note.kind !== 'suggestion') throw new Error('NOT_A_SUGGESTION')
      note.kind = 'note'; note.updatedAt = this.now().toISOString()
    })
  }
  /** A dismissed suggestion is removed and never re-added for the same parent. */
  dismiss(noteId) {
    id.parse(noteId)
    return this.transact((state) => {
      const note = state.notes[noteId]
      if (!note || note.kind !== 'suggestion') throw new Error('NOT_A_SUGGESTION')
      const parent = note.parentId ? state.notes[note.parentId] : undefined
      if (parent) parent.dismissed = [...(parent.dismissed ?? []), note.text].slice(-50)
      delete state.notes[noteId]
    })
  }
  updateSettings(patch) {
    return this.transact((state) => {
      state.settings = settingsSchema.parse({ ...DEFAULT_NOTE_SETTINGS, ...state.settings, ...patch })
    })
  }

  /**
   * Read the last result of linked Sessions that settled since their last harvest.
   * Uses the read-only session query; nothing is activated, nothing is guessed.
   */
  async harvest(sessions) {
    const query = this.sessionQuery()
    if (!query || this.closed) return false
    const facts = new Map(sessionsSchema.parse(sessions).map((row) => [row.id, row]))
    const due = this.list().filter((note) => note.kind === 'note' && note.sessionId && !this.harvesting.has(note.id)).filter((note) => {
      const fact = facts.get(note.sessionId)
      return fact && !fact.running && fact.updatedAt > (note.harvestedAt ?? 0)
    }).slice(0, 8)
    if (!due.length) return false
    for (const note of due) this.harvesting.add(note.id)
    try {
      const results = await Promise.all(due.map(async (note) => {
        try {
          const docs = await query.filterEvents(note.sessionId, [{ kind: 'type', values: ['assistant/message'] }, { kind: 'surface', values: ['current'] }])
          let summary
          for (let i = docs.length - 1; i >= 0 && !summary; i--) summary = summarizeActivity(docs[i]?.text?.replace(/```[\s\S]*?```/g, ''))
          const steps = note.mode === 'explore' ? parseNextSteps(docs.map((doc) => doc?.text ?? '').join('\n')) : []
          return { note, summary, steps, at: facts.get(note.sessionId).updatedAt }
        } catch (error) { this.warn(error); return undefined }
      }))
      return await this.transact((state) => {
        let changed = false
        const stamp = this.now().toISOString()
        for (const result of results) {
          const note = result && state.notes[result.note.id]
          if (!note || note.sessionId !== result.note.sessionId) continue
          note.harvestedAt = result.at; changed = true
          if (result.summary && result.summary !== note.result?.text) note.result = { text: result.summary.slice(0, 400), at: stamp }
          const known = new Set([...(note.dismissed ?? []), ...(note.offered ?? []), ...Object.values(state.notes).filter((child) => child.parentId === note.id).map((child) => child.text)])
          let order = Object.values(state.notes).filter((child) => child.parentId === note.id).reduce((max, child) => Math.max(max, child.order), 0)
          for (const text of result.steps) {
            if (known.has(text) || Object.keys(state.notes).length >= MAX_NOTES) continue
            known.add(text)
            note.offered = [...(note.offered ?? []), text].slice(-200)
            const childId = `s-${note.id.slice(0, 40)}-${(++order).toString(36)}-${Math.random().toString(36).slice(2, 6)}`
            state.notes[childId] = noteSchema.parse({ id: childId, day: note.day, parentId: note.id, order, text, kind: 'suggestion', state: 'open', createdAt: stamp, updatedAt: stamp })
          }
        }
        return changed
      })
    } finally { for (const note of due) this.harvesting.delete(note.id) }
  }

  /** Yesterday in facts, and how fast ideas become work over the last 30 days. */
  review(today, notes = this.list()) {
    const yesterday = isoDate(new Date(Date.parse(`${today}T12:00:00`) - 86400_000))
    const dayOf = (stamp) => stamp ? isoDate(new Date(stamp)) : undefined
    const own = notes.filter((note) => note.kind === 'note')
    let inboxActed = 0
    try { inboxActed = Number(this.inboxActed(yesterday)) || 0 } catch { inboxActed = 0 }
    const linked = own.filter((note) => dayOf(note.linkedAt) === yesterday)
    const summary = {
      date: yesterday,
      done: own.filter((note) => note.state === 'done' && dayOf(note.closedAt) === yesterday).length,
      dropped: own.filter((note) => note.state === 'dropped' && dayOf(note.closedAt) === yesterday).length,
      dispatched: linked.length,
      reviewed: linked.filter((note) => note.state === 'done').length,
      rolled: own.filter((note) => note.rolledOn === today).length,
      inboxActed,
    }
    summary.empty = !summary.done && !summary.dropped && !summary.dispatched && !summary.rolled && !inboxActed
    const since = Date.parse(`${today}T00:00:00`) - 30 * 86400_000
    const recent = own.filter((note) => Date.parse(note.createdAt) >= since && note.text.trim())
    const median = (values) => {
      const sorted = values.filter(Number.isFinite).sort((a, b) => a - b)
      return sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : null
    }
    const started = recent.filter((note) => note.linkedAt || note.state === 'done')
    const tasks = tasksOf(notes)
    const metrics = {
      captured: recent.length,
      conversionRate: recent.length ? started.length / recent.length : null,
      startMedianMs: median(recent.filter((note) => note.linkedAt).map((note) => Date.parse(note.linkedAt) - Date.parse(note.createdAt))),
      finishMedianMs: median(recent.filter((note) => note.linkedAt && note.state === 'done' && note.closedAt).map((note) => Date.parse(note.closedAt) - Date.parse(note.linkedAt))),
      averageRollovers: tasks.length ? tasks.reduce((sum, note) => sum + (note.rollovers ?? 0), 0) / tasks.length : null,
      open: own.filter(isOpen).length,
    }
    return { yesterday: summary, metrics }
  }

  async handleRoute(request) {
    try {
      const text = await request.text()
      if (text.length > 64 * 1024) return Response.json({ ok: false, code: 'TOO_LARGE' }, { status: 413 })
      const body = JSON.parse(text)
      switch (body.op) {
        case 'state':
          if (body.sessions !== undefined) await this.harvest(body.sessions).catch((error) => this.warn(error))
          break
        case 'upsert': await this.upsert(body.note, body.today); break
        case 'delete': await this.remove(body.id); break
        case 'link': await this.link(body.id, body.sessionId, body.mode, body.workspaceId); break
        case 'unlink': await this.unlink(body.id, body.sessionId); break
        case 'accept': await this.accept(body.id); break
        case 'dismiss': await this.dismiss(body.id); break
        case 'settings': await this.updateSettings(body.patch ?? {}); break
        default: return Response.json({ ok: false, code: 'UNKNOWN_OPERATION' }, { status: 400 })
      }
      await this.sweep(body.today)
      return Response.json(this.state(body.today), { headers: { 'cache-control': 'no-store' } })
    } catch (error) {
      const code = error instanceof SyntaxError ? 'BAD_JSON' : error instanceof z.ZodError ? 'INVALID_INPUT' : String(error.message)
      return Response.json({ ok: false, code }, { status: error instanceof SyntaxError || error instanceof z.ZodError ? 400 : 409 })
    }
  }
}

function rootOf(notes, noteId) {
  let note = notes[noteId]
  while (note?.parentId && notes[note.parentId]) note = notes[note.parentId]
  return note
}
function descendants(notes, noteId) {
  const out = [], queue = [noteId]
  while (queue.length) {
    const parent = queue.shift()
    for (const note of Object.values(notes)) if (note.parentId === parent) { out.push(note); queue.push(note.id) }
  }
  return out
}
