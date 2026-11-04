import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AttentionService, openStore } from '../index.js'
import { projection, initialState, applyEvent, obligationsOf } from '../lib/projection.js'

function fixture() {
  const store = { data: { dispositions: {}, external: {}, ledger: [] }, fail: false,
    async commit(next) { if (this.fail) throw new Error('DISK_FULL'); this.data = structuredClone(next) }, async close() {} }
  const events = []
  const service = new AttentionService({ emit: (...event) => events.push(event), logger: { warn() {} } }, store)
  return { service, store, events }
}
const draft = (patch = {}) => ({ key: 'one', subject: { type: 'work-item', ref: 'w1' }, kind: 'review', title: 'Review artifact', actions: [], ...patch })
const request = (body) => new Request('http://localhost/api/attention-inbox', { method: 'POST', body: JSON.stringify(body) })

test('two producers on one subject do not withdraw each other; updates retain age and revisions', async () => {
  const { service } = fixture()
  let title = 'A'
  service.registerProducer({ id: 'a', subjectType: 'session', derive: () => [draft({ title })] })
  service.registerProducer({ id: 'b', subjectType: 'session', derive: () => [draft({ title: 'B' })] })
  service.invalidate('a', 'same'); service.invalidate('b', 'same')
  assert.equal(service.list().length, 2)
  const before = service.list().find((item) => item.producer === 'a')
  title = 'A changed'; service.invalidate('a', 'same')
  assert.equal(service.list().length, 2)
  const after = service.list().find((item) => item.producer === 'a')
  assert.equal(after.revision, 2); assert.equal(after.openedAt, before.openedAt)
  await service.shutdown()
})

test('concurrent raises survive; option-only changes invalidate a prior dismissal', async () => {
  const { service } = fixture()
  const [a] = await Promise.all([service.raise(draft(), 'p'), service.raise(draft({ key: 'two' }), 'p')])
  assert.equal(service.list().length, 2)
  const same = await service.raise(draft(), 'p'); assert.equal(same.revision, a.revision)
  await service.dispose(a.key, a.revision, { kind: 'dismissed' })
  assert.equal(service.list().length, 1)
  const changed = await service.raise(draft({ options: [{ id: 'a', label: 'A' }] }), 'p')
  assert.equal(changed.revision, 2); assert.equal(service.list().length, 2)
  const response = service.list(); response[0].title = 'evil'
  assert.notEqual(service.list()[0].title, 'evil')
})

test('failed persistence neither acknowledges nor mutates state', async () => {
  const { service, store } = fixture()
  store.fail = true
  await assert.rejects(service.raise(draft(), 'p'), /DISK_FULL/)
  assert.equal(service.list().length, 0)
  store.fail = false
  const item = await service.raise(draft(), 'p')
  store.fail = true
  await assert.rejects(service.dispose(item.key, 1, { kind: 'dismissed' }), /DISK_FULL/)
  assert.equal(service.list().length, 1)
})

test('blockers cannot be hidden, stale revisions cannot act, undeclared actions cannot execute', async () => {
  const { service } = fixture()
  const item = await service.raise(draft({ kind: 'question', actions: ['send'] }), 'p')
  let calls = 0
  service.registerAction({ id: 'send', side: 'host', run: async () => { calls++ } })
  service.registerAction({ id: 'other', side: 'host', run: async () => { calls++ } })
  await assert.rejects(service.dispose(item.key, 1, { kind: 'dismissed' }), /BLOCKER/)
  await assert.rejects(service.act(item.key, 2, 'send'), /STALE/)
  await assert.rejects(service.act(item.key, 1, 'other'), /ACTION_NOT_AVAILABLE/)
  await service.act(item.key, 1, 'send')
  assert.equal(calls, 1); assert.equal(service.list().length, 1, 'button execution is not source resolution')
  await service.withdraw(item.key, 'acted'); assert.equal(service.list().length, 0)
})

test('filters can suppress soft items, never actual human blockers; defaults send channels hard only', async () => {
  const { service } = fixture()
  const delivered = []
  service.registerChannel({ id: 'c', deliver: (item) => delivered.push(item.key) })
  service.registerChannel({ id: 'broken', select() { throw new Error('bad channel') }, deliver() { throw new Error('must not call') } })
  service.registerFilter({ id: 'broken', apply() { throw new Error('bad filter') } })
  service.registerFilter({ id: 'drop', apply: () => 'drop' })
  await service.raise(draft(), 'p')
  await service.raise(draft({ key: 'hard', kind: 'approval' }), 'p')
  await new Promise(setImmediate)
  assert.equal(delivered.length, 1); assert.equal(service.list().length, 1)
})

test('route rejects malformed JSON, invalid snooze, unsupported ops, and returns custom metadata', async () => {
  const { service } = fixture()
  service.registerKind({ id: 'choice', blocking: 'soft', rank: 2, label: 'Choice' })
  service.registerSubjectType({ type: 'work-item', describe: () => ({ title: 'Task' }), open: () => ({ panelId: 'tasks' }) })
  const item = await service.raise(draft({ kind: 'choice' }), 'p')
  const state = await (await service.handleRoute(request({ op: 'state' }))).json()
  assert.equal(state.kinds.choice.blocking, 'soft'); assert.equal(state.subjects[item.key].title, 'Task')
  assert.equal((await service.handleRoute(request({ op: 'missing' }))).status, 400)
  assert.equal((await service.handleRoute(new Request('http://localhost', { method: 'POST', body: '{' }))).status, 400)
  assert.equal((await service.handleRoute(request({ op: 'dispose', key: item.key, revision: 1, kind: 'snoozed', until: 'invalid' }))).status, 409)
})

test('domain-backed store loads existing state and only publishes acknowledged writes', async () => {
  const state = { dispositions: {}, external: {}, ledger: [] }; let saved = state; let spec
  const store = await openStore({ storageDomain: { async open(value) { spec = value; return { global: { get: () => saved, set: async (value) => { saved = value } }, async close() {} } } } })
  assert.equal(spec.name, 'attention_inbox'); assert.equal(spec.global.schema.safeParse(state).success, true)
  await store.commit({ ...state, ledger: [] }); assert.equal(store.data, saved)
})

test('projection ignores retries/tool errors; only terminal turn reasons produce recoverable failures', () => {
  const state = initialState()
  const toolError = applyEvent(state, { type: 'tool/result', seq: 1, time: Date.now(), data: { error: true } })
  assert.equal(toolError.failure, null); assert.equal(toolError.counts[1].layer, 'l1')
  const aborted = applyEvent(state, { type: 'turn/end', seq: 2, time: Date.now(), data: { reason: { kind: 'aborted', reason: { kind: 'user' } } } })
  assert.equal(aborted.failure, null); assert.equal(aborted.counts[2].count, 1)
  const failure = applyEvent(state, { type: 'turn/end', seq: 4, time: Date.now(), data: { reason: { kind: 'error', error: { message: 'Provider failed' } } } })
  assert.equal(obligationsOf('s', failure)[0].kind, 'turn-failed')
  assert.equal(obligationsOf('s', applyEvent(failure, { type: 'turn/start' })).length, 0)
  assert.equal(projection.stateSchema.safeParse(failure).success, true)
})

test('settings persist without erasing legacy data; retention and scoped soft mutes obey facts', async () => {
  const { service, store } = fixture()
  assert.deepEqual(service.getSettings(), { reviewEnabled: true, ledgerRetentionDays: 90 })
  service.observeSession({ id: 's' })
  service.workspaceRegistry = { get: (id) => id === 'w' ? { id } : undefined, list: () => [{ id: 'w', sessionIds: ['s'] }] }
  const soft = await service.raise(draft({ subject: { type: 'session', ref: 's' } }), 'p')
  await service.raise(draft({ key: 'hard', kind: 'approval', subject: soft.subject }), 'p')
  await service.mute('workspace', 'w'); assert.equal(service.list().length, 1)
  await service.mute('workspace', 'w', true); assert.equal(service.list().length, 2)
  await assert.rejects(service.mute('workspace', 'invented'), /UNKNOWN_MUTE_TARGET/)
  await service.updateSettings({ reviewEnabled: false }); assert.equal(service.list().length, 1)
  assert.equal(Object.keys(store.data.external).length, 2)
  const restarted = new AttentionService({}, store); assert.equal(restarted.getSettings().reviewEnabled, false)
  await assert.rejects(restarted.updateSettings({ ledgerRetentionDays: 0 }), /INVALID_SETTINGS/)
  store.data.ledger.push({ closedAt: new Date(Date.now()-10*86400000).toISOString() })
  await restarted.updateSettings({ ledgerRetentionDays: 7 }); assert.equal(store.data.ledger.length, 0)
})

test('HTTP settings, ledger source noise and real duplicate merge counters survive repeated reads', async () => {
  const { service, store } = fixture()
  const response = await service.handleRoute(request({ op: 'settings', patch: { ledgerRetentionDays: 30 } }))
  assert.equal(response.status, 200); assert.equal((await response.json()).settings.ledgerRetentionDays, 30)
  for (let i = 0; i < 5; i++) {
    const item = await service.raise(draft({ key: `noise-${i}` }), 'noisy')
    await service.dispose(item.key, item.revision, { kind: 'dismissed' })
    await service.withdraw(item.key)
  }
  const noise = service.snapshot().metrics.noiseBySource.find((row) => row.source === 'noisy')
  assert.equal(noise.closed, 5); assert.equal(noise.dismissed, 5); assert.equal(noise.noiseRate, 1); assert.equal(noise.suggestRuleChange, true)
  service.invalidateDerived('duplicate', 'w1', [draft(), draft()]); await service.queue
  const before = service.snapshot().funnel
  assert.equal(before.l2DroppedToday, 1)
  service.snapshot(); service.list(); service.invalidateDerived('duplicate', 'w1', [draft(), draft()]); await service.queue
  assert.equal(service.snapshot().funnel.l2DroppedToday, 1)
  const restarted = new AttentionService({}, store)
  assert.equal(restarted.snapshot().funnel.l2DroppedToday, 1)
  assert.equal(restarted.snapshot().metrics.noiseBySource[0].dismissed, 5)
})

test('replay only creates autonomous reviews from known source messages and stable L1 counts', async () => {
  const now = Date.now()
  for (const source of [undefined, { kind: 'user' }, { kind: 'unknown' }, { kind: 'goal', goalId: 'g', revision: 1, round: 1 }, { kind: 'schedule' }, { kind: 'agent-message' }]) {
    const events = [
      { type: 'turn/start', seq: 1, time: now, data: {} },
      { type: 'user/message', seq: 2, time: now, data: { source } },
      { type: 'tool/result', seq: 3, time: now, data: { error: { code: 'RETRY' } } },
      { type: 'turn/end', seq: 4, time: now, data: { reason: { kind: 'completed' } } },
    ]
    const state = events.reduce(applyEvent, initialState())
    assert.equal(obligationsOf('s', state).filter((item) => item.reviewOrigin === 'autonomous-turn').length, ['goal', 'schedule', 'agent-message'].includes(source?.kind) ? 1 : 0)
    assert.deepEqual(state, events.reduce(applyEvent, initialState()))
    const { service } = fixture(); service.observeCounts('s', state.counts); service.observeCounts('s', state.counts); await service.queue
    assert.equal(service.snapshot().funnel.l1DroppedToday, 1, 'repeated reads/replay must not increase counters')
  }
})

test('goal snapshots survive replay, cleared goals disappear, old failures expire', () => {
  const goal = { id: 'g', revision: 1, objective: 'ship', phase: 'blocked', blockedReason: { code: 'x', message: 'need token' } }
  const state = applyEvent(initialState(), { type: 'goal/change', time: Date.now(), data: { goal } })
  assert.equal(obligationsOf('s', state)[0].detail, 'need token')
  assert.equal(obligationsOf('s', applyEvent(state, { type: 'goal/change', time: Date.now(), data: { goal: null } })).length, 0)
  const failure = applyEvent(initialState(), { type: 'turn/end', seq: 1, time: Date.now()-72*3600000, data: { reason: { kind: 'interrupted' } } })
  assert.equal(obligationsOf('s', failure).length, 0)
})
