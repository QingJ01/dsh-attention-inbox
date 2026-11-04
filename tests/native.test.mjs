import { test } from 'node:test'
import assert from 'node:assert/strict'
import { initialState, applyEvent, approvalsOf, questionsOf } from '../lib/projection.js'
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
