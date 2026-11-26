import { test } from 'node:test'
import assert from 'node:assert/strict'
import { initialState, applyEvent, approvalsOf, questionsOf, plansOf, projection } from '../lib/projection.js'
import { AttentionService } from '../lib/service.js'

test('native approval audits open, decide, cancel and recover without zombie requests', () => {
  const initial = initialState()
  const pending = applyEvent(initial, { type: 'approval/asked', seq: 1, time: Date.now(), data: { id: 'a', toolName: 'bash', callId: 'c', reason: 'publish?' } })
  assert.equal(approvalsOf('s', pending)[0].native.callId, 'c')
  assert.equal(approvalsOf('s', applyEvent(pending, { type: 'approval/decided', data: { id: 'a', outcome: 'rejected' } })).length, 0)
  assert.equal(approvalsOf('s', applyEvent(pending, { type: 'turn/end', data: { reason: { kind: 'aborted' } } })).length, 0)
  assert.equal(approvalsOf('s', applyEvent(pending, { type: 'turn/start' })).length, 0)
})

test('question wire view carries stable call identity to channels and cold-session rows', () => {
  const view = { active: [{ callId: 'c', state: 'continued', questions: [{ id: 'q', question: 'A or B?', options: [{ label: 'A' }, { label: 'B' }], multiSelect: false }] }] }
  const items = questionsOf('s', view)
  assert.equal(items.length, 1); assert.equal(items[0].native.callId, 'c')
  assert.equal(items[0].native.state, 'continued')
  assert.equal(items[0].kind, 'question'); assert.equal(items[0].title, 'A or B?')
  assert.deepEqual(items[0].questions, view.active[0].questions)
  items[0].questions[0].options[0].label = 'changed in consumer'
  assert.equal(view.active[0].questions[0].options[0].label, 'A', 'DTO must not expose native projection objects for mutation')
  assert.equal(questionsOf('s', { active: [], settled: [{ callId: 'c', answers: [] }] }).length, 0)
  assert.equal(questionsOf('s', { active: [{ ...view.active[0], state: 'open' }] })[0].native.state, 'open')
})

test('native accepted acknowledgements require decision facts; cancellations never count; late ack attributes inbox', async () => {
  const store = { data: { dispositions: {}, external: {}, ledger: [] }, async commit(next) { this.data = next } }
  const service = new AttentionService({}, store)
  const draft = { key: 'a', kind: 'approval', subject: { type: 'session', ref: 's' }, title: 'Allow?', native: { requestId: 'a', callId: 'c' } }
  service.invalidateDerived('builtin-approval', 's', [draft]); await service.queue
  const item = service.raw()[0]
  const ack = { key: item.key, revision: item.revision, actionId: 'approval.allow-once' }
  await service.nativeAction({ ...ack, phase: 'attempt' }); await service.nativeAction({ ...ack, phase: 'accepted' })
  assert.equal(service.snapshot().metrics.hardActed, 0)
  service.invalidateDerived('builtin-approval', 's', []); await service.queue
  assert.equal(service.snapshot().metrics.hardActed, 0, 'removal without approval/decided is cancellation')
  service.invalidateDerived('builtin-approval', 's', [{ ...draft, key: 'b', native: { requestId: 'b', callId: 'd' } }]); await service.queue
  const next = service.raw()[0], late = { key: next.key, revision: next.revision, actionId: 'approval.reject' }
  await service.nativeAction({ ...late, phase: 'attempt' })
  service.confirmNative('s', 'approval', 'b'); service.invalidateDerived('builtin-approval', 's', []); await service.queue
  assert.equal(service.snapshot().metrics.hardActed, 1); assert.equal(service.snapshot().metrics.inboxHardActed, 0)
  await service.nativeAction({ ...late, phase: 'accepted' })
  assert.equal(service.snapshot().metrics.inboxHardActed, 1); assert.equal(service.snapshot().metrics.hardInPlaceRate, 1)
  assert.equal(store.data.ledger.length, 2, 'fact and withdrawal coalesce into one closure')
})

test('browser-local keys map by callId and late accepted acks retain their canonical identity', async () => {
  const store = { data: { dispositions: {}, external: {}, ledger: [] }, async commit(next) { this.data = next } }
  const service = new AttentionService({}, store)
  for (const kind of ['approval', 'question']) {
    const requestId = `request-${kind}`, callId = `call-${kind}`
    service.invalidateDerived(kind, 's', [{ key: requestId, kind, subject: { type: 'session', ref: 's' }, title: 'Answer', native: { callId, ...(kind === 'approval' ? { requestId } : {}) } }])
    await service.queue
    const ack = { key: `client:${kind}:s:browser-key`, revision: 1, sessionId: 's', kind, callId, actionId: kind === 'approval' ? 'approval.allow-once' : 'question.answer' }
    await service.nativeAction({ ...ack, phase: 'attempt' })
    service.confirmNative('s', kind, kind === 'approval' ? requestId : callId)
    service.invalidateDerived(kind, 's', []); await service.queue
    await service.nativeAction({ ...ack, phase: 'accepted' })
  }
  assert.equal(service.snapshot().metrics.hardActed, 2)
  assert.equal(service.snapshot().metrics.inboxHardActed, 2)
})

test('plan review follows only valid native call identity and withdraws on result or lost waiter', () => {
  const call = { type: 'tool/call', seq: 1, time: Date.now(), data: { name: 'exit_plan_mode', callId: 'plan-c', arguments: JSON.stringify({ plan: '# Deploy plan\n\nReview these steps.' }) } }
  const state = applyEvent(initialState(), call), item = plansOf('s', state)[0]
  assert.equal(item.kind, 'plan-review'); assert.equal(item.native.callId, 'plan-c')
  assert.equal(item.questions[0].intent.approve, 'Approve'); assert.equal(item.openedAt, new Date(call.time).toISOString())
  assert.equal(projection.stateSchema.safeParse(state).success, true)
  assert.equal(plansOf('s', applyEvent(initialState(), { ...call, data: { ...call.data, arguments: 'invalid json' } })).length, 0)
  assert.equal(plansOf('s', applyEvent(state, { type: 'plan/mode', data: { active: false } })).length, 1, 'manual plan off is not proof of approval')
  assert.equal(plansOf('s', applyEvent(state, { type: 'tool/result', data: { message: { toolCallId: 'other' } } })).length, 1)
  assert.equal(plansOf('s', applyEvent(state, { type: 'tool/result', data: { message: { toolCallId: 'plan-c', content: [{ type: 'text', text: 'Plan approved' }] } } })).length, 0)
  assert.equal(plansOf('s', applyEvent(state, { type: 'turn/end', seq: 3, time: Date.now(), data: { reason: { kind: 'aborted' } } })).length, 0)
  assert.equal(plansOf('s', applyEvent(state, { type: 'turn/start' })).length, 0)
})

test('actual native plan tool structured result confirms approval; cancellation and failure only withdraw', { skip: !process.env.DSH_TEST_RUNTIME && 'set DSH_TEST_RUNTIME to native DSH packages' }, async () => {
  const { pathToFileURL } = await import('node:url')
  const load = (name) => import(pathToFileURL(`${process.env.DSH_TEST_RUNTIME}/${name}/lib/index.js`).href)
  const { Context } = await load('cordis'), { defineTool } = await load('dsh-tools'), { createUserMessage } = await load('dsh-llm')
  const askUserPlugin = await load('dsh-tool-ask-user'), { default: planModePlugin } = await load('dsh-plan-mode'), { UserQuestionError } = await load('dsh-user-questions')
  const { createNativeFixtureHarness } = await import('./support/native-fixture.js'), inbox = await import('../index.js')
  const ctx = new Context(); let saved, harness, settle
  const domains = new Map()
  ctx.provide('storageDomain', { async open(spec) {
    if (spec.name !== 'attention_inbox') { domains.set(spec.name, structuredClone(spec.global.initial)); return { global: { get: () => domains.get(spec.name), async set(value) { domains.set(spec.name, spec.global.schema.parse(value)) } }, async close() {} } }
    saved ??= structuredClone(spec.global.initial); return { global: { get: () => saved, async set(value) { saved = spec.global.schema.parse(value) } }, async close() {} } } })
  ctx.provide('connection', { fetch: { register() {} } })
  try {
    for (const name of ['dsh-session', 'dsh-session-projection', 'dsh-agent', 'dsh-system-prompt', 'dsh-tools', 'dsh-user-approval', 'dsh-user-questions']) {
      const mod = await load(name); await ctx.plugin(mod.default ?? mod, {})
    }
    ctx.provide('llm', { prepareCall() { throw new Error('REAL_MODEL_FORBIDDEN') } })
    await ctx.plugin((await load('dsh-agent-loop')).default, { agents: [], maxParallelToolCalls: 1 })
    await ctx.plugin(inbox)
    const engine = ctx.get('attention').engine
    ctx.on('user-questions/request', () => new Promise((resolve, reject) => { settle = { resolve, reject } }))
    harness = createNativeFixtureHarness(ctx, { defineTool, createUserMessage, askUserPlugin, planModePlugin })
    const until = async (check) => { for (let i = 0; i < 1000; i++) { if (check()) return; await new Promise(setImmediate) } throw new Error('native fixture did not settle') }
    for (const outcome of ['approved', 'cancelled', 'failed']) {
      settle = undefined
      const { id } = await harness.start({ kind: 'plan-review', deferLaunch: true }); harness.launch(id)
      await until(() => settle !== undefined)
      const item = engine.raw().find((row) => row.subject.ref === id && row.kind === 'plan-review')
      assert.ok(item, 'Host plan mirror exists while native userQuestions.ask is waiting')
      const ack = { key: item.key, revision: item.revision, actionId: 'question.answer' }
      await engine.nativeAction({ ...ack, phase: 'attempt' })
      if (outcome === 'cancelled') settle.reject(new UserQuestionError('cancelled fixture', 'ASK_CANCELLED'))
      else settle.resolve({ answers: [{ id: 'plan-review', selected: [outcome === 'approved' ? 'Approve' : 'Keep planning'] }] })
      await until(() => !harness.status(id).running); await engine.queue
      await engine.nativeAction({ ...ack, phase: 'accepted' })
      const rows = engine.store.data.ledger.filter((row) => row.subject?.ref === id && row.kind === 'plan-review')
      assert.equal(rows.length, 1)
      assert.equal(rows[0].resolution, outcome === 'approved' ? 'acted' : 'withdrawn')
      assert.equal(rows[0].nativeConfirmed, outcome === 'approved')
      if (outcome === 'approved') assert.equal(rows[0].via, 'inbox')
      await harness.finish(id)
    }
    assert.equal(engine.snapshot().metrics.hardActed, 1)
    const coldCall = { type: 'tool/call', seq: 1, time: Date.now(), data: { name: 'exit_plan_mode', callId: 'cold-plan-call', arguments: JSON.stringify({ plan: '# Cold plan' }) } }
    const coldState = applyEvent(initialState(), coldCall)
    ctx.provide('sessionQuery', {
      async listSessions() { return [{ header: { id: 'cold-plan', createdAt: Date.now() - 30 * 86400_000 }, live: false }] },
      async observeSession() { return { events: [coldCall], projections: { values: { attentionInbox: coldState } }, [Symbol.dispose]() {} } },
    })
    await until(() => engine.health.backfill === 'ready'); await engine.queue
    assert.equal(engine.raw().some((item) => item.subject.ref === 'cold-plan'), false, 'prepared log with no live plan waiter cannot recreate a hard plan')
    assert.equal(engine.store.data.ledger.some((row) => row.subject?.ref === 'cold-plan'), false, 'cold waiter absence creates no synthetic closure sample')
  } finally { await harness?.cleanup(); await ctx.fiber.dispose() }
})

test('viewing a completed goal records a resolution rather than adding noise', async () => {
  const store = { data: { dispositions: {}, external: {}, ledger: [] }, async commit(next) { this.data = next } }
  const service = new AttentionService({}, store)
  const item = await service.raise({ key: 'review', kind: 'review', subject: { type: 'session', ref: 's' }, title: 'Goal complete' }, 'p')
  const response = await service.handleRoute(new Request('http://localhost', { method: 'POST', body: JSON.stringify({ op: 'viewed', sessionIds: ['s'] }) }))
  assert.equal(response.status, 200); assert.equal(service.list().length, 0)
  assert.equal(store.data.ledger[0].resolution, 'acted')
  assert.equal(service.snapshot().metrics.dismissed, 0)
  assert.equal(store.data.dispositions[item.key].revision, 1)
})
