import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { pathToFileURL } from 'node:url'

const code = await readFile(new URL('../client.js', import.meta.url), 'utf8')
const flush = async () => { for (let i = 0; i < 32; i++) await Promise.resolve() }

function harness(initial = [], initialHost = {}, options = {}) {
  let module, props, statuses = new Map(initial)
  let host = { ok: true, items: [], dispositions: {}, ...initialHost }
  const cleanup = [], feeds = new Set(), intervals = new Set(), requests = [], opened = [], registrations = [], timers = new Map(), sessionFeeds = new Set()
  let fetcher, sessionRows = {}, hookFrame, timerId = 0, confirmResult = true, subjectRenderer
  const services = new Map(), slotCalls = [], confirmations = []
  const Service = options.Service ?? class {
    constructor(ctx, name) { this.ctx = ctx; ctx.reflect.provide(name, this) }
  }
  const hookState = new Map()
  const useState = (initial) => {
    if (!hookFrame) return [initial, () => {}]
    const frame = hookFrame, index = frame.index++
    if (!(index in frame.values)) frame.values[index] = initial
    return [frame.values[index], (value) => { frame.values[index] = typeof value === 'function' ? value(frame.values[index]) : value }]
  }
  const render = (node, path = 'root') => {
    if (Array.isArray(node)) return node.flatMap((child, index) => render(child, `${path}.${index}`))
    if (!node || typeof node !== 'object') return node
    if (typeof node.type === 'function') {
      const id = `${path}:${node.type.name}:${node.props?.key ?? ''}`
      const values = hookState.get(id) ?? []; hookState.set(id, values)
      hookFrame = { values, index: 0 }
      const output = node.type(node.props ?? {})
      hookFrame = undefined
      return render(output, `${path}.component`)
    }
    return { ...node, children: render(node.children, `${path}.children`) }
  }
  const context = vm.createContext({
    window: { __ModuleLoader__: { load(definition) { module = definition.factory((name) => {
      if (name === '@deepseek-ai/cordis') return { Service }
      if (name !== 'react') throw new Error(`Unexpected Client dependency: ${name}`)
      return {
        createElement: (type, props, ...children) => ({ type, props, children }),
        useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(), useState,
      }
    }) } }, open() {}, confirm: (label) => { confirmations.push(label); return typeof confirmResult === 'function' ? confirmResult() : confirmResult } },
    document: { baseURI: 'http://localhost:49391/' }, URL, AbortController, Date,
    setInterval(fn) { intervals.add(fn); return fn }, clearInterval(fn) { intervals.delete(fn) },
    setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms }); return id }, clearTimeout(id) { timers.delete(id) },
    async fetch(url, options) {
      requests.push({ ...JSON.parse(options.body), signal: options.signal })
      if (fetcher) return fetcher(url, options)
      return { ok: true, json: async () => host }
    },
  })
  vm.runInContext(code, context)
  const setup = {
    reflect: { provide(name, value) { services.set(name, value) } },
    locale: { register: () => () => {}, bind: () => (key) => key, resolveText: (value) => value.en },
    effect(fn) { const release = fn(); let active = true
      const dispose = () => { if (active) { active = false; release?.() } }
      cleanup.push(dispose); return dispose }, 
    uiSession: { sessionStatus: {
      getSnapshot: () => statuses,
      subscribe(listener) { feeds.add(listener); return () => feeds.delete(listener) },
    } },
    sessions: { list: { getSnapshot: () => ({ byId: sessionRows }), subscribe: (fn) => { sessionFeeds.add(fn); return () => sessionFeeds.delete(fn) } } },
    uiWorkspace: { openSession: (id) => opened.push(id) },
    slots: { inject: (_name, fn) => fn(), register(definition, component) {
      registrations.push({ definition, component })
      if (definition.key === 'attention-inbox') props = definition.inject()
      return () => {}
    } },
  }
  if (options.owner) {
    for (const name of ['locale', 'uiSession', 'sessions', 'uiWorkspace', 'slots']) options.owner.provide(name, setup[name])
    module.apply(options.owner)
  } else module.apply(setup)
  return {
    get client() { return options.owner?.get('attentionClient') ?? services.get('attentionClient') },
    get props() { return props }, get view() { return props.view.getSnapshot() }, feeds, intervals, requests, opened, registrations, timers,
    render(slot = 'main') { const registration = registrations.find((r) => r.definition.name === slot)
      return render({ type: registration.component, props: { ...registration.definition.inject(),
        renderSlot: (name, owner, opts) => { slotCalls.push({ name, owner, opts }); return subjectRenderer ? subjectRenderer(name, owner, opts) : opts?.fallback },
      } }) },
    slotCalls, confirmations,
    confirm(value) { confirmResult = value },
    subjectRenderer(value) { subjectRenderer = value },
    sessionRows(rows) { sessionRows = rows; for (const fn of sessionFeeds) fn() },
    expireTimers() { for (const [id, { fn }] of [...timers]) { timers.delete(id); fn() } },
    statuses(entries) { statuses = new Map(entries); for (const listener of [...feeds]) listener() },
    setHost(value) { host = { ok: true, items: [], dispositions: {}, ...value } },
    setFetch(value) { fetcher = value },
    async poll() { for (const fn of intervals) fn(); await flush() },
    close() { for (const fn of cleanup.reverse()) fn() },
  }
}
const status = (pendingInteraction) => ({ pendingInteraction })
const approval = (key = 'a', answer = () => {}) => ({ kind: 'approval', key, toolName: 'bash', answerable: true, answer })
const item = (overrides = {}) => ({ key: 'external:1', revision: 1, producer: 'plugin', subject: { type: 'custom', ref: 'x' },
  kind: 'review', blocking: 'soft', title: 'Review', openedAt: '2026-11-04T10:00:00Z', actions: [], ...overrides })

test('subscribes immediately; live request removal is immediate, age is stable across polls', async () => {
  const h = harness([['s1', status(approval())]])
  assert.equal(h.feeds.size, 1)
  await flush()
  const before = h.view.items[0]
  await h.poll()
  assert.equal(h.view.items[0].openedAt, before.openedAt)
  h.statuses([['s1', status(approval('next'))]])
  assert.notEqual(h.view.items[0].key, before.key)
  h.statuses([])
  assert.equal(h.view.total, 0)
  assert.equal(h.view.badge, 0)
  h.close()
  assert.equal(h.feeds.size, 0)
  assert.equal(h.intervals.size, 0)
})

test('approval requires explicit action; stale clicks cannot answer a replacement', async () => {
  let answers = []
  const first = approval('a', (value) => { answers.push(value); first.answerable = false })
  const h = harness([['s1', status(first)]])
  await flush()
  assert.deepEqual(answers, [])
  const old = h.view.items[0]
  h.statuses([['s1', status(approval('b', (value) => answers.push(value)))]])
  await h.props.run(old, 'approval.allow-once')
  assert.deepEqual(answers, [])
  await h.props.run(h.view.items[0], 'approval.reject')
  assert.deepEqual(answers, ['rejected'])
  h.close()
})

test('hard and system blockers cannot be dismissed; soft actions use the Host endpoint', async () => {
  const h = harness([['s1', status(approval())]], { items: [item(), item({ key: 'account', blocking: 'system', kind: 'credential' })] })
  await flush()
  for (const blocker of h.view.items.filter((i) => i.blocking !== 'soft')) await h.props.dispose(blocker, 'dismissed')
  assert.equal(h.requests.filter((r) => r.op === 'dispose').length, 0)
  const soft = h.view.items.find((i) => i.blocking === 'soft')
  await h.props.dispose(soft, 'snoozed')
  const request = h.requests.find((r) => r.op === 'dispose')
  assert.equal(request.kind, 'snoozed')
  assert.equal(request.revision, 1)
  assert.ok(Date.parse(request.until) > Date.now())
  assert.equal(h.view.total, 3) // Host facts, never optimistic pretending-to-dismiss.
  h.close()
})

test('PendingQuestion answer channels, card subscriptions, and reliable Session fallback', async () => {
  const cardListeners = new Set(), replies = []
  let channel = 'waterfall'
  const question = { kind: 'question', key: 'q', callId: 'call', questions: [{ id: 'choice', question: 'Which?', options: [{ label: 'A' }] }],
    getSnapshot: () => ({ state: 'open', channel, closed: false }),
    subscribe(fn) { cardListeners.add(fn); return () => cardListeners.delete(fn) },
    async answer(value) { replies.push(value) },
  }
  const h = harness([['s1', status(question)]])
  await flush()
  assert.equal(cardListeners.size, 1)
  const obligation = h.view.items[0]
  assert.equal(obligation.questions[0].id, 'choice')
  await h.props.run(obligation, 'question.answer', { answers: [{ id: 'choice', selected: ['A'] }] })
  assert.equal(replies.length, 1)
  h.expireTimers() // No resolved fact arrived: retry/open is available after 5s.
  channel = 'none'
  for (const fn of [...cardListeners]) fn()
  assert.equal(h.view.items[0].questions, undefined)
  await h.props.run(h.view.items[0], 'question.answer', {})
  assert.deepEqual(h.opened, ['s1'])
  h.statuses([])
  assert.equal(cardListeners.size, 0)
  h.close()
})

test('Host custom kind tier, actions and subject descriptions survive aggregation', async () => {
  const h = harness([], { items: [item({ kind: 'custom', blocking: 'hard', actions: ['custom.resolve'] })],
    kinds: { custom: { blocking: 'hard', rank: 3, label: { en: 'Custom' } } },
    actions: { 'custom.resolve': { side: 'host', label: { en: 'Resolve' } } },
    subjects: { 'external:1': { title: 'A subject', subtitle: 'Context' } },
  })
  await flush()
  assert.equal(h.view.badge, 1)
  assert.equal(h.view.groups[0].id, 'waiting')
  assert.equal(h.view.subjects['external:1'].title, 'A subject')
  await h.props.run(h.view.items[0], 'custom.resolve', { choice: 1 })
  const request = h.requests.find((r) => r.op === 'act')
  assert.equal(request.actionId, 'custom.resolve')
  assert.equal(request.input.choice, 1)
  h.close()
})

test('unload aborts in-flight requests and ignores their late replies', async () => {
  const h = harness()
  await flush()
  let resolve
  h.setFetch(() => new Promise((done) => { resolve = done }))
  for (const fn of h.intervals) fn()
  const pending = h.requests.at(-1)
  h.close()
  assert.equal(pending.signal.aborted, true)
  const snapshot = h.view
  resolve({ ok: true, json: async () => ({ ok: true, items: [item()] }) })
  await flush()
  assert.equal(h.view, snapshot)
})

test('failed answer stays visible and retry clears the error without auto-answering', async () => {
  let shouldFail = true, count = 0
  const pending = approval('a', async () => { count++; if (shouldFail) throw new Error('transport failed') })
  const h = harness([['s1', status(pending)]])
  await flush()
  const obligation = h.view.items[0]
  await h.props.run(obligation, 'approval.allow-once')
  assert.equal(count, 1)
  assert.equal(h.view.total, 1)
  assert.equal(h.view.failed[obligation.key], true)
  assert.equal(h.view.pending[obligation.key], undefined)
  shouldFail = false
  await h.props.run(obligation, 'approval.reject')
  assert.equal(count, 2)
  assert.equal(h.view.failed[obligation.key], undefined)
  h.statuses([])
  assert.equal(Object.keys(h.view.pending).length, 0)
  assert.equal(Object.keys(h.view.failed).length, 0)
  h.close()
})

test('Host failure keeps last-known blockers; stale state response cannot restore removed local requests', async () => {
  const h = harness([['s1', status(approval())]], { items: [item({ blocking: 'system', kind: 'credential' })] })
  await flush()
  h.setFetch(async () => { throw new Error('offline') })
  await h.poll()
  assert.equal(h.view.hostAvailable, false)
  assert.equal(h.view.total, 2)
  h.statuses([])
  assert.equal(h.view.items.length, 1)
  assert.equal(h.view.items[0].kind, 'credential')
  h.setHost({ items: [item({ kind: 'approval', blocking: 'hard', producer: 'client' })] })
  h.setFetch(undefined)
  await h.poll()
  assert.equal(h.view.total, 0) // Native interaction facts, never Host copies.
  h.close()
})

test('native Host mirrors deduplicate against live cards and cannot revive a settled request', async () => {
  const pending = approval('request', () => {})
  pending.callId = 'call-123'
  const mirror = item({ key: 'native-host', producer: 'builtin-approval', kind: 'approval', blocking: 'hard', subject: { type: 'session', ref: 's1' }, native: { callId: 'call-123', toolName: 'bash' } })
  const h = harness([['s1', status(pending)]], { items: [mirror] })
  await flush()
  assert.equal(h.view.total, 1)
  h.statuses([])
  assert.equal(h.view.total, 0)
  await h.poll()
  assert.equal(h.view.total, 0, 'cached Host mirror cannot reopen a locally completed request')
  h.close()
})

test('external plugin questions are preserved even when no native card exists', async () => {
  const h = harness([], { items: [item({ kind: 'question', blocking: 'hard', producer: 'tickets' })] })
  await flush()
  assert.equal(h.view.total, 1)
  assert.equal(h.view.items[0].producer, 'tickets')
  h.close()
})

const nodes = (node) => Array.isArray(node) ? node.flatMap(nodes) : node && typeof node === 'object' ? [node, ...nodes(node.children)] : []
const text = (node) => Array.isArray(node) ? node.map(text).join(' ') : node && typeof node === 'object' ? text(node.children) : String(node ?? '')
const button = (tree, label) => nodes(tree).find((node) => node.type === 'button' && text(node) === label)

test('coverage compares every native pending Session on updates, including unknown and unavailable cards', async () => {
  const h = harness([
    ['approval', status(approval())],
    ['unknown', status({ kind: 'future-kind', key: 'future', question: 'Open source' })],
    ['transition', status({ kind: 'question', key: 'q', answerable: false, getSnapshot: () => ({ closed: true, state: 'settled' }) })],
    ['idle', {}],
  ], { items: [item({ kind: 'credential', blocking: 'system' }), item({ key: 'soft' })] })
  await flush()
  assert.equal(h.view.coverage.gap, 0)
  assert.equal(h.view.coverage.nativeSessionCount, 3)
  assert.equal(h.view.badge, h.view.items.filter((i) => ['system', 'hard'].includes(i.blocking)).length)
  assert.equal(h.view.badge, 4)
  assert.equal(h.view.items.find((i) => i.subject.ref === 'unknown').actions.join(','), 'subject.open')
  assert.equal(h.view.items.find((i) => i.subject.ref === 'transition').questions, undefined)
  const checks = h.view.coverage.checks
  h.statuses([['replacement', status(approval('next'))]])
  assert.equal(h.view.coverage.gap, 0)
  assert.ok(h.view.coverage.checks > checks)
  assert.equal(h.view.coverage.nativeSessionCount, 1)
  const debug = nodes(h.render()).find((node) => node.props?.['data-coverage-gap'] === 0)
  assert.ok(debug)
  h.close()
})

test('native acknowledgements do not record acted or hide a blocker before facts change', async () => {
  let replies = 0
  const h = harness([['s', status(approval('request', () => { replies++ }))]])
  await flush()
  const obligation = h.view.items[0]
  await h.props.run(obligation, 'approval.allow-once')
  assert.equal(replies, 1)
  const tracking = h.requests.filter((r) => r.op === 'native-action')
  assert.equal(tracking.map((r) => r.phase).join(','), 'attempt,accepted')
  assert.equal(tracking[0].sessionId, 's')
  assert.equal(tracking[0].requestId, undefined, 'browser render key is not a Host-native request id')
  assert.equal(h.requests.filter((r) => r.kind === 'acted' || r.op === 'acted').length, 0)
  assert.equal(h.view.total, 1)
  assert.equal(h.view.pending[obligation.key], true)
  await h.props.run(obligation, 'approval.allow-once')
  assert.equal(replies, 1, 'cannot submit twice while awaiting a native fact')
  h.expireTimers()
  assert.equal(h.view.total, 1)
  assert.equal(h.view.failed[obligation.key], true)
  assert.equal(h.view.pending[obligation.key], undefined)
  await h.props.run(obligation, 'approval.reject')
  assert.equal(replies, 2, 'unresolved request remains retryable')
  h.statuses([])
  assert.equal(h.view.total, 0)
  assert.equal(h.timers.size, 0)
  h.close()
})

test('native refusal records failed, remains visible, and allows retry', async () => {
  let accepted = false
  const h = harness([['s', status(approval('request', () => accepted))]])
  await flush()
  const obligation = h.view.items[0]
  await h.props.run(obligation, 'approval.reject')
  assert.equal(h.requests.filter((r) => r.op === 'native-action').map((r) => r.phase).join(','), 'attempt,failed')
  assert.equal(h.view.failed[obligation.key], true)
  assert.equal(h.view.total, 1)
  accepted = true
  await h.props.run(obligation, 'approval.reject')
  assert.equal(h.view.failed[obligation.key], undefined)
  h.close()
  assert.equal(h.timers.size, 0)
})

test('metrics acknowledgement failure does not swallow native action and offers retry sync', async () => {
  let replies = 0, offline = true
  const h = harness([['s', status(approval('a', () => { replies++ }))]])
  await flush()
  h.setFetch(async (_url, options) => {
    const body = JSON.parse(options.body)
    if (body.op === 'native-action' && offline) throw new Error('offline')
    return { ok: true, json: async () => ({ ok: true, items: [] }) }
  })
  await h.props.run(h.view.items[0], 'approval.reject')
  assert.equal(replies, 1)
  assert.equal(h.view.nativeTrackingFailed, true)
  assert.ok(button(h.render(), 'retryTracking'))
  offline = false
  await h.props.retryTracking()
  assert.equal(h.view.nativeTrackingFailed, false)
  h.close()
})

test('settings mount in panel and native settings; values and mute removal come from Host facts', async () => {
  const h = harness([], { settings: { reviewEnabled: false, ledgerRetentionDays: 42 },
    muteRules: [{ scope: 'session', ref: 's1' }, { scope: 'workspace', ref: 'workspace-id' }] })
  await flush()
  let tree = h.render('settings.section')
  assert.equal(nodes(tree).find((node) => node.type === 'input' && node.props.type === 'checkbox').props.checked, false)
  assert.equal(nodes(tree).find((node) => node.type === 'input' && node.props.type === 'number').props.value, '42')
  assert.equal(nodes(tree).filter((node) => node.type === 'button' && text(node) === 'unmute').length, 2)
  nodes(tree).find((node) => node.type === 'input' && node.props.type === 'checkbox').props.onChange({ target: { checked: true } })
  await flush()
  assert.equal(h.requests.find((r) => r.op === 'settings').patch.reviewEnabled, true)
  assert.equal(h.view.settings.reviewEnabled, false, 'no optimistic settings facts')
  await h.props.unmute(h.view.muteRules[1])
  assert.equal(h.requests.find((r) => r.op === 'unmute').ref, 'workspace-id')
  button(h.render(), 'settings').props.onClick()
  tree = h.render()
  assert.ok(button(tree, 'back'))
  assert.ok(text(tree).includes('ledgerRetentionDays'))
  h.setFetch(async () => { throw new Error('offline') })
  await h.props.updateSettings({ ledgerRetentionDays: 30 })
  assert.equal(h.view.settingsError, true)
  assert.equal(h.view.settings.ledgerRetentionDays, 42)
  assert.ok(text(h.render('settings.section')).includes('settingsFailed'))
  h.close()
})

test('mute menus and API enforce soft-only Session and actual workspace ids', async () => {
  const h = harness([['hard-session', status(approval())]], { items: [
    item({ key: 'soft-session', subject: { type: 'session', ref: 'soft-session', workspace: '/cwd-is-not-workspace-id' } }),
    item({ key: 'system', blocking: 'system', kind: 'credential', subject: { type: 'session', ref: 'system' } }),
  ], subjects: { 'soft-session': { workspace: { id: 'workspace-id', title: 'Real workspace' } } } })
  await flush()
  assert.equal(nodes(h.render()).filter((node) => node.type === 'summary' && text(node) === 'mute').length, 1)
  for (const blocker of h.view.items.filter((row) => row.blocking !== 'soft')) await h.props.mute(blocker, 'session')
  assert.equal(h.requests.filter((r) => r.op === 'mute').length, 0)
  const soft = h.view.items.find((row) => row.key === 'soft-session')
  await h.props.mute(soft, 'session')
  await h.props.mute(soft, 'workspace')
  assert.equal(h.requests.filter((r) => r.op === 'mute').map((r) => `${r.scope}:${r.ref}`).join(','), 'session:soft-session,workspace:workspace-id')
  assert.equal(h.view.items.length, 3)
  h.close()
})

test('footer uses real L1/L2 and native-confirmed metrics; missing samples are explicit', async () => {
  const h = harness([], { funnel: { l1DroppedToday: 12, l2DroppedToday: 3, shownToday: 4 },
    metrics: { hardResponseMedianMs: 120000, hardActed: 5, inboxHardActed: 4, hardInPlaceRate: 0.8 } })
  await flush()
  const footer = nodes(h.render()).find((node) => node.type === 'footer')
  assert.match(text(footer), /dropped 15/)
  assert.match(text(footer), /L1 12 \/ L2 3/)
  assert.match(text(footer), /120|2min/)
  assert.match(text(footer), /80% \(4\/5\)/)
  h.setHost({})
  await h.poll()
  const emptyMetrics = text(nodes(h.render()).find((node) => node.type === 'footer'))
  assert.match(emptyMetrics, /noSamples/)
  h.close()
})

test('plan review displays complete detail and uses the exact native intent approve option', async () => {
  const plan = 'First step\n' + 'A complete plan paragraph.\n'.repeat(120)
  const replies = []
  const question = { kind: 'plan-review', key: 'plan', callId: 'call', questions: [{ id: 'review', question: 'Review?', detail: plan,
    intent: { kind: 'plan-review', approve: 'Ship the approved plan' }, options: [{ label: 'Revise' }, { label: 'Ship the approved plan' }] }],
    getSnapshot: () => ({ state: 'continued', channel: 'rpc', closed: false }), answer: (value) => { replies.push(value) } }
  const h = harness([['s1', status(question)]])
  await flush()
  const tree = h.render()
  assert.ok(nodes(tree).some((node) => node.type === 'pre' && text(node) === plan))
  assert.deepEqual(replies, [])
  const approve = button(tree, 'Ship the approved plan')
  assert.equal(approve.props.type, 'button')
  assert.equal(nodes(tree).some((node) => node.props?.onKeyDown), false, 'no global Enter or Escape decision binding')
  approve.props.onClick()
  await flush()
  assert.equal(replies[0].answers[0].selected[0], 'Ship the approved plan')
  assert.equal(replies[0].answers[0].id, 'review')
  h.close()
})

test('question input Enter, repeat and IME confirmation cannot implicitly submit an answer', async () => {
  let count = 0
  const question = { kind: 'question', key: 'q', questions: [{ id: 'q', question: 'Which?', options: [{ label: 'A' }] }],
    getSnapshot: () => ({ state: 'open', channel: 'waterfall', closed: false }), answer: () => { count++ } }
  const h = harness([['s1', status(question)]])
  await flush()
  let tree = h.render()
  nodes(tree).find((node) => node.type === 'input' && node.props.type === 'radio').props.onChange()
  tree = h.render()
  const form = nodes(tree).find((node) => node.type === 'form')
  let prevented = 0
  for (const extra of [{}, { repeat: true }, { nativeEvent: { isComposing: true } }, { keyCode: 229 }])
    form.props.onKeyDown({ key: 'Enter', target: { tagName: 'INPUT' }, preventDefault: () => prevented++, ...extra })
  assert.equal(prevented, 4)
  assert.equal(count, 0)
  assert.equal(button(tree, 'answer').props.disabled, false)
  form.props.onSubmit({ preventDefault() {} })
  await flush()
  assert.equal(count, 1)
  h.close()
})

test('visible Session telemetry follows main-view retention changes', async () => {
  const h = harness()
  await flush()
  h.sessionRows({ s1: { retainedBy: { mainView: 1 } }, s2: { retainedBy: { mainView: 0 } } })
  await flush()
  assert.equal(h.requests.filter((r) => r.op === 'telemetry').at(-1).visibleSessionIds.join(','), 's1')
  const clientId = h.requests.filter((r) => r.op === 'telemetry').at(-1).clientId
  assert.equal(typeof clientId, 'string')
  const before = h.requests.filter((r) => r.op === 'telemetry').length
  await h.poll()
  assert.equal(h.requests.filter((r) => r.op === 'telemetry').length, before + 1, 'refreshes visibility lease even without changes')
  assert.equal(h.requests.filter((r) => r.op === 'telemetry').at(-1).clientId, clientId)
  h.close()
})

test('request replacement while native attempt acknowledgement is pending never answers the replacement', async () => {
  let release, oldReplies = 0, nextReplies = 0
  const h = harness([['s', status(approval('old', () => { oldReplies++ }))]])
  await flush()
  h.setFetch(async (_url, options) => {
    const body = JSON.parse(options.body)
    if (body.op === 'native-action' && body.phase === 'attempt') await new Promise((resolve) => { release = resolve })
    return { ok: true, json: async () => ({ ok: true, items: [] }) }
  })
  const operation = h.props.run(h.view.items[0], 'approval.allow-once')
  await flush()
  h.statuses([['s', status(approval('new', () => { nextReplies++ }))]])
  release()
  await operation
  assert.equal(oldReplies, 0)
  assert.equal(nextReplies, 0)
  assert.equal(h.requests.filter((r) => r.op === 'native-action').map((r) => r.phase).join(','), 'attempt,failed')
  assert.equal(h.view.coverage.gap, 0)
  assert.equal(h.view.total, 1)
  h.close()
})

test('native tracking uses canonical Host mirror identity rather than browser approval render counters', async () => {
  let h
  const pending = approval('approval:7', () => h.statuses([]))
  pending.callId = 'real-call'
  h = harness([['s', status(pending)]], { items: [item({ key: 'host-approval', revision: 9,
    kind: 'approval', blocking: 'hard', subject: { type: 'session', ref: 's' }, native: { callId: 'real-call', requestId: 'host-request-id' } })] })
  await flush()
  await h.props.run(h.view.items[0], 'approval.allow-once')
  const acks = h.requests.filter((r) => r.op === 'native-action')
  assert.equal(acks.length, 2)
  assert.equal(acks.map((r) => r.phase).join(','), 'attempt,accepted')
  for (const ack of acks) {
    assert.equal(ack.key, 'host-approval')
    assert.equal(ack.revision, 9)
    assert.equal(ack.requestId, 'host-request-id')
    assert.equal(ack.callId, 'real-call')
  }
  assert.equal(h.view.total, 0)
  h.close()
})

test('workspace mute never invents an id from a Session cwd', async () => {
  const h = harness([], { items: [item({ subject: { type: 'session', ref: 's', workspace: '/path/to/cwd' } })] })
  await flush()
  const tree = h.render()
  assert.ok(button(tree, 'muteSession'))
  assert.equal(button(tree, 'muteWorkspace'), undefined)
  await h.props.mute(h.view.items[0], 'workspace')
  assert.equal(h.requests.filter((r) => r.op === 'mute').length, 0)
  assert.equal(h.view.failed[h.view.items[0].key], true)
  h.close()
})

test('public Client action dispatch uses Host metadata, current revisions and facts for visibility', async () => {
  const replies = []
  const actions = { 'custom.resolve': { side: 'client', label: { en: 'Resolve locally' } } }
  const h = harness([], { items: [item({ actions: ['custom.resolve'] })], actions,
    subjects: { 'external:1': { title: 'A subject', open: { route: 'subject-page' } } } })
  await flush()
  assert.equal(h.client.apiVersion, 1)
  assert.equal(button(h.render(), 'Resolve locally'), undefined, 'metadata without an executor falls back to opening')
  const release = h.client.registerAction({ id: 'custom.resolve', run: (o, input, signal) => { replies.push({ o, input, signal }) } })
  assert.equal(typeof release, 'function')
  assert.ok(button(h.render(), 'Resolve locally'))
  const original = h.view.items[0]
  await h.props.run(original, 'custom.resolve', { choice: 3 })
  assert.equal(replies.length, 1)
  assert.equal(replies[0].input.choice, 3)
  assert.equal(replies[0].o.key, original.key)
  assert.equal(h.requests.some((r) => r.op === 'act'), false, 'Client executors never run through Host act')
  assert.equal(h.view.total, 1, 'a returned Client Promise does not close an obligation')
  h.setHost({ items: [item({ revision: 2, title: 'Changed', actions: ['custom.resolve'] })], actions })
  await h.poll()
  await h.props.run(original, 'custom.resolve')
  assert.equal(replies.length, 1, 'stale revisions never dispatch')
  assert.throws(() => h.client.registerAction({ id: 'custom.resolve', run() {} }), /CLIENT_ACTION_UNAVAILABLE/)
  assert.throws(() => h.client.registerAction({ id: 'approval.allow-once', run() {} }), /RESERVED_CLIENT_ACTION/)
  assert.throws(() => h.client.registerAction({ id: 'bad', confirm: 'unknown', run() {} }), /INVALID_CLIENT_ACTION/)
  release(); release()
  assert.equal(replies[0].signal.aborted, true)
  assert.equal(button(h.render(), 'Resolve locally'), undefined)
  await h.props.run(h.view.items[0], 'custom.resolve')
  assert.equal(replies.length, 1, 'unregistered executors cannot dispatch')
  h.close()
})

test('destructive Client actions require actual confirmation and recheck executor ownership afterward', async () => {
  let count = 0
  const h = harness([], { items: [item({ actions: ['custom.delete'] })],
    actions: { 'custom.delete': { side: 'client', label: { en: 'Delete source' }, confirm: 'destructive' } } })
  await flush()
  const release = h.client.registerAction({ id: 'custom.delete', run() { count++ } })
  h.confirm(false)
  await h.props.run(h.view.items[0], 'custom.delete')
  assert.equal(count, 0)
  assert.equal(h.confirmations[0], 'Delete source')
  h.confirm(true)
  await h.props.run(h.view.items[0], 'custom.delete')
  assert.equal(count, 1)
  h.confirm(() => { release(); return true })
  await h.props.run(h.view.items[0], 'custom.delete')
  assert.equal(count, 1, 'an executor removed during a confirmation dialog cannot run')
  assert.equal(h.view.failed[h.view.items[0].key], true)
  h.close()
})

test('Client registration destructive confirmation and failed executors remain retryable', async () => {
  let fail = true, count = 0
  const h = harness([], { items: [item({ actions: ['custom.change'] })],
    actions: { 'custom.change': { side: 'client', label: { en: 'Change' } } } })
  await flush()
  h.client.registerAction({ id: 'custom.change', confirm: 'destructive', run() { count++; if (fail) throw new Error('not ready') } })
  await h.props.run(h.view.items[0], 'custom.change')
  assert.equal(h.confirmations.length, 1, 'executor may require confirmation in addition to Host metadata')
  assert.equal(h.view.failed[h.view.items[0].key], true)
  assert.equal(h.view.total, 1)
  fail = false
  await h.props.run(h.view.items[0], 'custom.change')
  assert.equal(count, 2)
  assert.equal(h.view.failed[h.view.items[0].key], undefined)
  h.close()
})

test('attention.subject is a declared keyed slot with type-based rich render and generic fallback', async () => {
  const h = harness([], { items: [item()], subjects: { 'external:1': { title: 'Source title', subtitle: 'Source subtitle' } } })
  await flush()
  const registration = h.registrations.find((r) => r.definition.name === 'main')
  assert.equal(registration.definition.children['attention.subject'].kind, 'keyed')
  assert.equal(registration.definition.children['attention.subject'].scope, 'root')
  let tree = h.render()
  assert.ok(text(tree).includes('Source title › Source subtitle'))
  assert.equal(h.slotCalls.at(-1).name, 'attention.subject')
  assert.equal(h.slotCalls.at(-1).opts.entryKey, 'custom')
  assert.equal(h.slotCalls.at(-1).owner.subject.ref, 'x')
  assert.equal(h.slotCalls.at(-1).owner.obligation.key, 'external:1')
  assert.equal(h.slotCalls.at(-1).owner.description.title, 'Source title')
  h.subjectRenderer((_name, owner, opts) => owner.subject.type === 'custom'
    ? { type: 'strong', props: {}, children: ['A rich source'] } : opts.fallback)
  tree = h.render()
  assert.ok(text(tree).includes('A rich source'))
  assert.equal(nodes(tree).find((n) => n.props?.['data-attention-key'] === 'external:1').type, 'li')
  assert.equal(tree.props['data-attention-inbox'], 'page')
  h.close()
})

test('actual Cordis caller lifecycle unregisters Client executors and aborts their signals', {
  skip: !process.env.DSH_TEST_RUNTIME && 'set DSH_TEST_RUNTIME to real Cordis runtime',
}, async () => {
  const { Context, Service } = await import(pathToFileURL(`${process.env.DSH_TEST_RUNTIME}/cordis/lib/index.js`).href)
  const root = new Context()
  const h = harness([], { items: [item({ actions: ['custom.lifecycle'] })],
    actions: { 'custom.lifecycle': { side: 'client', label: { en: 'Lifecycle' } } } }, { owner: root, Service })
  try {
    await flush()
    let signal, count = 0
    const contributor = root.plugin((ctx) => {
      ctx.attentionClient.registerAction({ id: 'custom.lifecycle', run(_item, _input, ownSignal) { signal = ownSignal; count++ } })
    })
    await contributor
    assert.ok(button(h.render(), 'Lifecycle'))
    await h.props.run(h.view.items[0], 'custom.lifecycle')
    assert.equal(count, 1)
    assert.equal(signal.aborted, false)
    await contributor.dispose()
    assert.equal(signal.aborted, true)
    assert.equal(button(h.render(), 'Lifecycle'), undefined)
    await h.props.run(h.view.items[0], 'custom.lifecycle')
    assert.equal(count, 1)
    const second = root.plugin((ctx) => { ctx.attentionClient.registerAction({ id: 'custom.lifecycle', run() {} }) })
    await second
    assert.ok(button(h.render(), 'Lifecycle'), 'a new contributor can reuse the released id')
    await second.dispose()
  } finally { await root.fiber.dispose() }
})

test('defaultAction displays a localized label without exposing input or scheduling execution', async () => {
  let executions = 0
  const h = harness([], { items: [
    item({ key: 'past-deadline', deadline: '2000-01-01T00:00:00Z', actions: ['custom.cleanup'],
      defaultAction: { actionId: 'custom.cleanup', input: { secret: 'private-default-input' } } }),
    item({ key: 'without-deadline', defaultAction: { actionId: 'custom.missing-label', input: 'also-private' } }),
  ], actions: { 'custom.cleanup': { side: 'client', label: { zh: '本地清理', en: 'Local cleanup' } } } })
  await flush()
  h.client.registerAction({ id: 'custom.cleanup', run() { executions++ } })
  let tree = h.render()
  const defaults = nodes(tree).filter((node) => node.props?.['data-default-action-id'])
  assert.equal(defaults.length, 2)
  assert.equal(text(defaults[0]), 'defaultAction: 本地清理')
  assert.equal(text(defaults[1]), 'defaultAction: custom.missing-label')
  assert.equal(defaults.every((node) => node.type === 'span' && !node.props.onClick), true)
  assert.equal(text(tree).includes('private-default-input'), false)
  assert.equal(text(tree).includes('also-private'), false)
  assert.equal(h.timers.size, 0, 'defaultAction does not install a deadline timer')
  await h.poll()
  h.expireTimers()
  tree = h.render()
  assert.ok(text(tree).includes('defaultAction: 本地清理'))
  assert.equal(executions, 0, 'past deadlines, polling and rendering never run the default action')
  assert.equal(h.requests.some((request) => request.op === 'act'), false)
  h.close()
})
