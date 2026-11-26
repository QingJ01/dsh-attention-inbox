import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { NotesService } from '../lib/notes.js'
import { ProjectsService } from '../lib/projects.js'

const code = await readFile(new URL('../client.js', import.meta.url), 'utf8')
const flush = async () => { for (let i = 0; i < 64; i++) await new Promise((resolve) => setImmediate(resolve)) }

/** The real Client against the real notes Host route, with DSH services faked at their public seams. */
const open = new Set()
after(() => { for (const h of open) h.close() })
function harness(options = {}) {
  let module
  const registrations = [], cleanup = [], prompts = [], created = [], opened = [], tabs = [], openedTabs = []
  const sessionFeeds = new Set()
  let rows = {}, statuses = new Map(), notesRequests = 0
  const projectBodies = []
  const store = { data: { notes: {}, settings: undefined }, async commit(next) { this.data = structuredClone(next) }, async close() {} }
  const host = new NotesService(store, { sessionQuery: () => options.sessionQuery, workspaces: () => options.workspaces ?? [{ id: 'w1', title: 'dsh', path: '/work/dsh' }] })
  const hookState = new Map(); let frame
  const useState = (initial) => {
    if (!frame) return [initial, () => {}]
    const current = frame, index = current.index++
    if (!(index in current.values)) current.values[index] = initial
    return [current.values[index], (value) => { current.values[index] = typeof value === 'function' ? value(current.values[index]) : value }]
  }
  const render = (node, path = 'root') => {
    if (Array.isArray(node)) return node.flatMap((child, index) => render(child, `${path}.${index}`))
    if (!node || typeof node !== 'object') return node
    if (typeof node.type === 'function') {
      const id = `${path}:${node.type.name}:${node.props?.key ?? ''}`
      const values = hookState.get(id) ?? []; hookState.set(id, values)
      frame = { values, index: 0 }
      const output = node.type(node.props ?? {})
      frame = undefined
      return render(output, `${path}.c`)
    }
    return { ...node, children: render(node.children, `${path}.k`) }
  }
  const context = vm.createContext({
    window: { __ModuleLoader__: { load(definition) { module = definition.factory((name) => {
      if (name === '@deepseek-ai/cordis') return { Service: class { constructor(ctx, name) { this.ctx = ctx } } }
      // Like React, a component receives its children through props.children.
      const createElement = (type, props, ...children) => ({ type, children,
        props: typeof type === 'function' && children.length ? { ...props, children: children.length === 1 ? children[0] : children } : props })
      return { createElement, useSyncExternalStore: (_s, get) => get(), useState }
    }) } }, open() {} },
    document: { baseURI: 'http://localhost:49391/', querySelector: () => undefined },
    URL, AbortController, Date, Request, setTimeout, clearTimeout, setInterval, clearInterval, crypto: globalThis.crypto,
    async fetch(url, init) {
      if (String(url).endsWith('/api/attention-projects')) {
        projectBodies.push(JSON.parse(init.body))
        const response = await (options.projects ?? new ProjectsService()).handleRoute(new Request(url, { method: 'POST', body: init.body }))
        return { ok: response.ok, status: response.status, json: () => response.json() }
      }
      if (!String(url).endsWith('/api/attention-notes')) return { ok: true, json: async () => ({ ok: true, items: [] }) }
      notesRequests++
      if (options.failNotes) throw new Error('offline')
      const response = await host.handleRoute(new Request(url, { method: 'POST', body: init.body }))
      return { ok: response.ok, status: response.status, json: () => response.json() }
    },
  })
  vm.runInContext(code, context)
  const sessions = {
    list: { getSnapshot: () => ({ byId: rows }), subscribe: (fn) => { sessionFeeds.add(fn); return () => sessionFeeds.delete(fn) } },
    async create(opts) { created.push({ via: 'create', ...opts }); return `sess-${created.length}` },
    async using(id, opts, operation) {
      assert.equal(opts.source, 'controllerOperation')
      return operation({ ready: Promise.resolve({ session: { async prompt(content, mode) {
        prompts.push({ id, text: content[0].text, mode })
        return options.promptResult ?? { ok: true, value: { accepted: true } }
      } } }) })
    },
  }
  const ctx = {
    get: () => undefined,
    locale: { register: () => () => {}, bind: () => (key) => key },
    effect(fn) { const release = fn(); cleanup.push(() => release?.()); return () => release?.() },
    uiSession: { sessionStatus: { getSnapshot: () => statuses, subscribe: () => () => {} } },
    sessions,
    uiWorkspace: { openSession: (id) => opened.push(id), async connectWorkspace(id) { created.push({ via: 'connect', workspaceId: id }); return `sess-${created.length}` } },
    slots: { inject: (_n, fn) => fn(), register(definition, component) { registrations.push({ definition, component }); return () => {} } },
  }
  if (options.rightSidebar) ctx.inject = (_names, callback) => callback({
    ...ctx, sidebarRight: { openTab(kind) { if (options.rightSidebar === 'no-session' && !opened.length) throw new Error('no session'); openedTabs.push(kind) } },
    sidebarRightTabs: { register(definition) { tabs.push(definition); return () => {} } },
  })
  module.apply(ctx)
  let closed = false
  const notesProps = () => registrations.find((r) => r.definition.key === 'attention-notes').definition.inject()
  const handle = {
    host, store, prompts, created, opened, tabs, openedTabs, registrations, projectBodies,
    get requests() { return notesRequests },
    get props() { return notesProps() },
    get state() { return notesProps().notes.getSnapshot() },
    get actions() { return notesProps().actions },
    rows(value) { rows = value; for (const fn of [...sessionFeeds]) fn() },
    statuses(value) { statuses = new Map(value) },
    render(component = 'NotesPage', extra = {}) {
      const registration = registrations.find((r) => r.definition.key === 'attention-notes' && r.component.name === component)
      return render({ type: registration.component, props: { ...registration.definition.inject(), ...extra } })
    },
    close() { if (closed) return; closed = true; open.delete(handle); for (const fn of cleanup.reverse()) fn() },
  }
  open.add(handle)
  return handle
}
const text = (tree) => {
  if (tree === null || tree === undefined || tree === false) return ''
  if (typeof tree !== 'object') return String(tree)
  if (Array.isArray(tree)) return tree.map(text).filter(Boolean).join(' ')
  if (tree.type === 'style') return ''
  return [tree.props?.value !== undefined ? String(tree.props.value) : '', text(tree.children ?? [])].filter(Boolean).join(' ')
}
const find = (tree, predicate) => {
  for (const node of Array.isArray(tree) ? tree : [tree]) {
    if (!node || typeof node !== 'object') continue
    if (predicate(node)) return node
    const hit = find(node.children ?? [], predicate)
    if (hit) return hit
  }
}

test('nothing is fetched until the notes panel or its sidebar icon starts the controller', async () => {
  const h = harness()
  await flush()
  assert.equal(h.requests, 0)
  assert.ok(h.registrations.some((r) => r.definition.name === 'sidebar.panellist' && r.definition.id === 'attention-notes'))
  h.actions.start(); h.actions.start()
  await flush()
  assert.equal(h.requests, 1)
  assert.equal(h.state.phase, 'ready')
  h.close()
})

test('outline editing: create, type, indent, outdent, complete and delete persist on the Host', async () => {
  const h = harness()
  h.actions.start(); await flush()
  const a = h.actions.create({ text: '想法 A' })
  assert.equal(h.state.focusId, a)
  assert.equal(h.state.notes.length, 1, 'optimistic before the round trip')
  await flush()
  const b = h.actions.create({ after: h.state.notes.find((n) => n.id === a) })
  h.actions.setText(b, '细节')
  await h.actions.flush(b); await flush()
  assert.equal(h.store.data.notes[b].text, '细节')
  h.actions.indent(h.state.notes.find((n) => n.id === b)); await flush()
  assert.equal(h.store.data.notes[b].parentId, a)
  h.actions.outdent(h.state.notes.find((n) => n.id === b)); await flush()
  assert.equal(h.store.data.notes[b].parentId, null)
  assert.ok(h.store.data.notes[b].order > h.store.data.notes[a].order)
  await h.actions.setState(h.state.notes.find((n) => n.id === a), 'done'); await flush()
  assert.equal(h.store.data.notes[a].state, 'done')
  await h.actions.remove(h.state.notes.find((n) => n.id === b)); await flush()
  assert.equal(h.store.data.notes[b], undefined)
  h.close()
})

test('convert sends the note and its details to a new Session in the inferred Workspace, then links it', async () => {
  const h = harness()
  h.actions.start(); await flush()
  const id = h.actions.create({ text: '迁移 CI 环境变量' }); await flush()
  h.actions.create({ parentId: id, text: 'npm trusted publisher' }); await flush()
  h.rows({ other: { id: 'other', cwd: '/work/dsh', updatedAt: 5, running: false } })
  await h.actions.convert(h.state.notes.find((n) => n.id === id), 'task'); await flush()
  assert.deepEqual(h.created, [{ via: 'create', workspaceId: 'w1' }], 'a fresh Session, never the Workspace blank connectWorkspace reuses')
  assert.equal(h.prompts.length, 1)
  assert.equal(h.prompts[0].mode, 'queue')
  assert.match(h.prompts[0].text, /^迁移 CI 环境变量\n\npromptDetails\n- npm trusted publisher$/)
  const note = h.store.data.notes[id]
  assert.equal(note.sessionId, 'sess-1'); assert.equal(note.mode, 'task'); assert.equal(note.workspaceId, 'w1')
  h.rows({ 'sess-1': { id: 'sess-1', running: true, updatedAt: 6 } })
  let tree = h.render()
  assert.ok(find(tree, (n) => n.props?.className === 'cn-glyph running'), 'running glyph from the Session list')
  h.statuses([['sess-1', { pendingInteraction: { kind: 'approval' } }]])
  tree = h.render()
  assert.ok(find(tree, (n) => n.props?.className === 'cn-glyph waiting'))
  assert.match(text(tree), /1barWaiting/)
  find(tree, (n) => n.props?.['data-action-id'] === 'notes.open').props.onClick()
  assert.deepEqual(h.opened, ['sess-1'])
  h.close()
})

test('explore asks for a next-steps block; when the Session stops, its result and suggestions come back', async () => {
  const docs = [{ text: '读完了代码：存储层可以直接复用。\n```next-steps\n- 写存储层 ~1h\n- 写页面 2h\n```' }]
  const h = harness({ sessionQuery: { async filterEvents() { return docs } } })
  h.actions.start(); await flush()
  const id = h.actions.create({ text: '大纲笔记插件' }); await flush()
  await h.actions.convert(h.state.notes.find((n) => n.id === id), 'explore'); await flush()
  assert.match(h.prompts[0].text, /exploreIntro[\s\S]*```next-steps\n- exampleStep1\n- exampleStep2\n```$/)
  const sessionId = h.store.data.notes[id].sessionId
  h.rows({ [sessionId]: { id: sessionId, running: true, updatedAt: 10 } })
  h.rows({ [sessionId]: { id: sessionId, running: false, updatedAt: 20 } })
  await h.actions.refresh(); await flush()
  const note = h.state.notes.find((n) => n.id === id)
  assert.equal(note.result.text, '读完了代码：存储层可以直接复用。')
  const suggestions = h.state.notes.filter((n) => n.kind === 'suggestion')
  assert.deepEqual(suggestions.map((n) => n.text), ['写存储层 ~1h', '写页面 2h'])
  const tree = h.render()
  assert.ok(find(tree, (n) => n.props?.className === 'cn-reply' && /读完了代码/.test(text(n))), 'the result renders as an agent reply')
  assert.match(text(tree), /looksDone/, 'a stopped Session with a result offers to mark the note done')
  await h.actions.accept(suggestions[0]); await h.actions.dismiss(suggestions[1]); await flush()
  assert.deepEqual(h.state.notes.filter((n) => n.parentId === id).map((n) => [n.text, n.kind]), [['写存储层 ~1h', 'note']])
  h.close()
})

test('a rejected prompt leaves the note unlinked with a retryable error', async () => {
  const h = harness({ promptResult: { ok: false, error: { code: 'session/model-unavailable', message: 'model unavailable' } } })
  h.actions.start(); await flush()
  const id = h.actions.create({ text: 'try this' }); await flush()
  await h.actions.convert(h.state.notes.find((n) => n.id === id), 'task'); await flush()
  assert.equal(h.store.data.notes[id].sessionId, undefined)
  assert.equal(h.state.failed[id], 'model unavailable')
  assert.equal(h.state.converting[id], undefined)
  assert.match(text(h.render()), /convertFailed.*model unavailable/)
  h.close()
})

test('timeline renders two lanes, and its controls write the person\'s choices', async () => {
  const h = harness()
  h.actions.start(); await flush()
  const mine = h.actions.create({ text: '写周报 1h' }); await flush()
  const agent = h.actions.create({ text: '调研 loro' }); await flush()
  await h.actions.setPlan(h.state.notes.find((n) => n.id === agent), { lane: 'agent' }); await flush()
  let tree = h.render()
  find(tree, (n) => n.props?.['data-action-id'] === 'notes.tab.timeline').props.onClick()
  tree = h.render()
  const body = text(tree)
  assert.match(body, /groupMine · 1/)
  assert.match(body, /groupDispatch · 1/)
  assert.match(body, /you\s+1unitH15unitMin \/ 4unitH/, 'my hour plus one review')
  await h.actions.setPlan(h.state.notes.find((n) => n.id === mine), { date: 'later' }); await flush()
  assert.equal(h.store.data.notes[mine].plan.date, 'later')
  await h.actions.setPlan(h.state.notes.find((n) => n.id === mine), { date: '' }); await flush()
  assert.equal(h.store.data.notes[mine].plan, undefined, 'clearing the only choice clears the plan')
  h.close()
})

test('right sidebar tab registers only when the sidebar exists; pin opens it beside a Session', async () => {
  const plain = harness()
  assert.equal(plain.props.canPin(), false)
  plain.close()
  const h = harness({ rightSidebar: 'no-session' })
  assert.equal(h.tabs[0].kind, 'attention-notes')
  assert.ok(h.registrations.some((r) => r.definition.name === 'sidebar.right.pane.tab' && r.definition.key === 'dsh-attention-inbox/notes'))
  h.rows({ recent: { id: 'recent', updatedAt: 9, running: false }, older: { id: 'older', updatedAt: 1, running: false } })
  assert.equal(h.props.pin(), true)
  assert.deepEqual(h.opened, ['recent'], 'a Session is brought on screen first')
  await new Promise((resolve) => setTimeout(resolve, 250))
  assert.deepEqual(h.openedTabs, ['attention-notes'])
  h.close()
})

test('a Host failure keeps the outline usable and reports what was not saved', async () => {
  const h = harness({ failNotes: true })
  h.actions.start(); await flush()
  assert.equal(h.state.phase, 'error')
  assert.match(text(h.render()), /loadFailed/)
  h.close()
})

test('a linked, closed or already converting note never starts a second Session', async () => {
  const h = harness()
  h.actions.start(); await flush()
  const id = h.actions.create({ text: '只派一次' }); await flush()
  const first = h.actions.convert(h.state.notes.find((n) => n.id === id), 'task')
  await h.actions.convert(h.state.notes.find((n) => n.id === id), 'explore') // double trigger while the first runs
  await first; await flush()
  assert.equal(h.created.length, 1); assert.equal(h.prompts.length, 1)
  // The keyboard shortcut on a linked note, and a stale row object from before the link.
  const linked = h.state.notes.find((n) => n.id === id)
  await h.actions.convert(linked, 'task')
  await h.actions.convert({ ...linked, sessionId: undefined }, 'task'); await flush()
  assert.equal(h.created.length, 1, 'the queue re-reads the note and sees the link')
  const done = h.actions.create({ text: '已完成' }); await flush()
  await h.actions.setState(h.state.notes.find((n) => n.id === done), 'done'); await flush()
  await h.actions.convert(h.state.notes.find((n) => n.id === done), 'task'); await flush()
  assert.equal(h.created.length, 1)
  assert.equal(h.prompts.length, 1)
  h.close()
})

test('the Host refuses to relink a note, so another tab cannot orphan the first Agent', async () => {
  const h = harness()
  h.actions.start(); await flush()
  const id = h.actions.create({ text: 'x' }); await flush()
  await h.host.link(id, 'sess-a', 'task')
  await assert.rejects(h.host.link(id, 'sess-b', 'task'), /ALREADY_LINKED/)
  await h.host.unlink(id, 'sess-other')
  assert.equal(h.host.store.data.notes[id].sessionId, 'sess-a', 'unlink names the Session it undoes')
  h.close()
})

test('without a Workspace nothing is created and the reason is readable', async () => {
  const h = harness({ workspaces: [] })
  h.actions.start(); await flush()
  const id = h.actions.create({ text: '没有项目' }); await flush()
  await h.actions.convert(h.state.notes.find((n) => n.id === id), 'task'); await flush()
  assert.deepEqual(h.created, []); assert.deepEqual(h.prompts, [])
  assert.equal(h.state.failed[id], 'NO_WORKSPACE')
  assert.match(text(h.render()), /convertFailed\s*noWorkspace/)
  h.close()
})

test('a refused link starts no Agent work', async () => {
  const h = harness()
  h.actions.start(); await flush()
  const id = h.actions.create({ text: 'race' }); await flush()
  await h.host.link(id, 'sess-elsewhere', 'task') // another tab won; this tab has not refreshed yet
  const stale = { ...h.state.notes.find((n) => n.id === id), sessionId: undefined }
  h.host.store.data.notes[id].sessionId = 'sess-elsewhere'
  // Force this tab to believe the note is still unlinked.
  await h.actions.convert(stale, 'task'); await flush()
  assert.deepEqual(h.created, [], 'the fresh Host read sees the other tab\'s link before creating anything')
  assert.deepEqual(h.prompts, [], 'no prompt went to an unlinked Session')
  h.close()
})

test('suggestions are offered once: a deleted or edited one does not come back on the next harvest', async () => {
  const docs = [{ text: 'ok\n```next-steps\n- 第一步\n- 第二步\n```' }]
  const h = harness({ sessionQuery: { async filterEvents() { return docs } } })
  h.actions.start(); await flush()
  const id = h.actions.create({ text: '探索' }); await flush()
  await h.actions.convert(h.state.notes.find((n) => n.id === id), 'explore'); await flush()
  const sessionId = h.store.data.notes[id].sessionId
  h.rows({ [sessionId]: { id: sessionId, running: false, updatedAt: 20 } })
  await h.actions.refresh(); await flush()
  const [a, b] = h.state.notes.filter((n) => n.kind === 'suggestion')
  await h.actions.accept(a); await flush()
  h.actions.setText(a.id, '第一步，改过'); await h.actions.flush(a.id)
  await h.actions.remove(b); await flush()
  h.rows({ [sessionId]: { id: sessionId, running: false, updatedAt: 30 } }) // metadata bump, same log
  await h.actions.refresh(); await flush()
  assert.deepEqual(h.state.notes.filter((n) => n.parentId === id).map((n) => n.text), ['第一步，改过'])
  h.close()
})

test('Backspace on an emptied linked note keeps the note its Session reports to', async () => {
  const h = harness()
  h.actions.start(); await flush()
  const id = h.actions.create({ text: 'linked' }); await flush()
  await h.actions.convert(h.state.notes.find((n) => n.id === id), 'task'); await flush()
  h.actions.setText(id, ''); await h.actions.flush(id); await flush()
  const input = find(h.render(), (n) => n.props?.['data-note-input'] === id)
  let prevented = false
  input.props.onKeyDown({ key: 'Backspace', target: { value: '' }, preventDefault() { prevented = true }, nativeEvent: {} })
  await flush()
  assert.equal(prevented, false)
  assert.ok(h.store.data.notes[id], 'still there')
  h.close()
})

test('project timeline reads nothing until its page opens, then only reads', async () => {
  const T = Date.parse('2026-11-20T09:00:00Z')
  const logs = { s1: [
    { seq: 1, type: 'turn/start', time: T, data: { turn: 1 } },
    { seq: 2, type: 'user/message', time: T + 1, data: { content: [{ type: 'text', text: '修复登录' }], source: { kind: 'user' } } },
    { seq: 3, type: 'assistant/message', time: T + 2, data: { message: { content: [{ type: 'text', text: '已修复登录跳转。' }] } } },
    { seq: 4, type: 'turn/end', time: T + 3, data: { turn: 1, reason: { kind: 'completed' } } },
  ] }
  const query = { async listSessions() { return [{ header: { id: 's1', createdAt: T } }] }, async readSession(id) { return { header: { id, createdAt: T }, events: logs[id] } } }
  const projects = new ProjectsService({ workspaces: () => [{ id: 'w1', title: 'app', path: '/work/app', sessionIds: ['s1'] }], sessionQuery: () => query })
  const h = harness({ projects })
  await flush()
  assert.ok(h.registrations.some((r) => r.definition.name === 'sidebar.panellist' && r.definition.id === 'attention-projects'))
  assert.equal(h.projectBodies.length, 0, 'registering the sidebar entry reads no logs')
  const registration = h.registrations.find((r) => r.definition.key === 'attention-projects')
  const props = registration.definition.inject()
  const release = props.actions.mount(); await flush()
  assert.deepEqual(h.projectBodies.map((b) => b.op), ['list', 'project'])
  const state = props.source.getSnapshot()
  assert.equal(state.selected, 'w1')
  assert.equal(state.project.timeline[0].ask, '修复登录')
  assert.deepEqual(h.created, []); assert.deepEqual(h.prompts, [])
  props.actions.open('s1')
  assert.deepEqual(h.opened, ['s1'], 'opening is navigation only')
  release()
  h.close()
})
