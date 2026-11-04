import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { AttentionService } from '../lib/service.js'
import { ContextualAttentionService } from '../lib/contextual.js'

const draft = (key, patch = {}) => ({ key, subject: { type: 'record', ref: key }, kind: 'question', title: 'Please decide', ...patch })
const flush = () => new Promise(setImmediate)
function fixture() {
  const warnings = [], store = { data: { dispositions: {}, external: {}, ledger: [] }, async commit(next) { this.data = structuredClone(next) } }
  return { store, warnings, engine: new AttentionService({ logger: { warn(error) { warnings.push(error) } } }, store) }
}
async function mounted() {
  const ctx = new Context(), data = fixture()
  await ctx.plugin({ name: 'attention-host', apply(scope) { new ContextualAttentionService(scope, data.engine) } })
  return { ...data, ctx, async close() { await ctx.fiber.dispose(); await data.engine.shutdown() } }
}

test('real Cordis caller tracking automatically releases all registrations and only its own facts', async () => {
  const f = await mounted(); let a, b
  try {
    const first = f.ctx.plugin({ name: 'caller-a', inject: ['attention'], async apply(ctx) {
      a = ctx.attention
      a.registerSubjectType({ type: 'a', describe: () => ({ title: 'A' }) })
      a.registerKind({ id: 'a', blocking: 'soft' })
      a.registerAction({ id: 'a', side: 'host', async run() {} })
      a.registerFilter({ id: 'a', apply: () => 'keep' })
      a.registerChannel({ id: 'a', async deliver() {} })
      a.registerProducer({ id: 'a-derived', subjectType: 'record', derive: () => [draft('derived')] })
      a.invalidate('a-derived', 'same')
      await a.raise(draft('external'))
    } }); await first
    const second = f.ctx.plugin({ name: 'caller-b', inject: ['attention'], async apply(ctx) {
      b = ctx.attention
      b.registerAction({ id: 'b', side: 'host', async run() {} })
      b.registerProducer({ id: 'b-derived', subjectType: 'record', derive: () => [draft('derived')] })
      b.invalidate('b-derived', 'same'); await b.raise(draft('external'))
    } }); await second
    assert.deepEqual(new Set(f.engine.raw().map((o) => o.producer)), new Set(['caller-a', 'caller-b', 'a-derived', 'b-derived']))
    await first.dispose()
    assert.deepEqual(new Set(f.engine.raw().map((o) => o.producer)), new Set(['caller-b', 'b-derived']))
    assert.equal(f.store.data.ledger.filter((o) => o.resolution === 'withdrawn').length, 2)
    for (const map of ['subjectTypes', 'kinds', 'channels', 'filters']) assert.equal(f.engine[map].size, 0)
    assert.deepEqual([...f.engine.actions.keys()], ['b'])
    await assert.rejects(async () => a.raise(draft('after-unload')), /CALLER_UNLOADED|INACTIVE_EFFECT/)
    await b.raise(draft('still-active'))
    assert.equal(f.engine.raw().length, 3)
  } finally { await f.close() }
})

test('caller budget combines explicit producer names and derived refs without changing rejected facts', async () => {
  const f = await mounted(); let api
  try {
    await f.ctx.plugin({ name: 'budget-owner', inject: ['attention'], async apply(ctx) {
      api = ctx.attention
      api.registerProducer({ id: 'derived-one', subjectType: 'record', derive: () => [draft('one')] })
      api.registerProducer({ id: 'derived-two', subjectType: 'record', derive: () => [draft('two')] })
      await Promise.all(Array.from({ length: 49 }, (_, i) => api.raise(draft(String(i)), `explicit-${i}`)))
    } })
    api.invalidate('derived-one', 'a')
    const before = f.engine.raw()
    assert.throws(() => api.invalidate('derived-two', 'b'), /PRODUCER_LIMIT/)
    assert.throws(() => api.invalidate('derived-one', 'other-ref'), /PRODUCER_LIMIT/)
    await assert.rejects(api.raise(draft('overflow'), 'new-producer'), /PRODUCER_LIMIT/)
    assert.deepEqual(f.engine.raw(), before)
    assert.equal(f.warnings.length, 3)
  } finally { await f.close() }
})

test('producer unregister also withdraws external submissions and awaits ledger cleanup', async () => {
  const { engine, store } = fixture()
  const release = engine.registerProducer({ id: 'mixed', subjectType: 'record', derive: () => [draft('d')] })
  engine.invalidate('mixed', 'ref')
  await engine.raise(draft('external'), 'mixed')
  await engine.raise(draft('other'), 'other')
  await release()
  assert.deepEqual(engine.raw().map((o) => o.producer), ['other'])
  assert.equal(store.data.ledger.filter((o) => o.producer === 'mixed' && o.resolution === 'withdrawn').length, 2)
  await engine.shutdown()
})

test('includeSnoozed returns snoozes but keeps dismissals hidden; defaultAction is display metadata', async () => {
  const { engine } = fixture(); let calls = 0
  engine.registerAction({ id: 'automatic', side: 'host', async run() { calls++ } })
  const a = await engine.raise(draft('a', { kind: 'review', defaultAction: { actionId: 'automatic', input: { answer: true } } }), 'p')
  const b = await engine.raise(draft('b', { kind: 'review' }), 'p')
  await engine.dispose(a.key, 1, { kind: 'snoozed', until: new Date(Date.now() + 60000).toISOString() })
  await engine.dispose(b.key, 1, { kind: 'dismissed' })
  assert.equal(engine.list().length, 0)
  assert.deepEqual(engine.list({ includeSnoozed: true }).map((o) => o.key), [a.key])
  assert.deepEqual(engine.list({ includeSnoozed: true })[0].defaultAction, { actionId: 'automatic', input: { answer: true } })
  assert.equal(calls, 0)
  await engine.shutdown()
})

test('channel deduplicates revisions, uses AbortSignal and retracts a closed delivery once', async () => {
  const { engine } = fixture(), deliveries = [], retractions = []
  engine.registerChannel({ id: 'im', async deliver(item, signal) { deliveries.push([item.revision, signal]) }, async retract(item, resolution) { retractions.push([item.revision, resolution]) } })
  const first = await engine.raise(draft('a'), 'p'); await flush()
  engine.announce('opened', first); await engine.raise(draft('a'), 'p'); await flush()
  assert.equal(deliveries.length, 1); assert.ok(deliveries[0][1] instanceof AbortSignal)
  const second = await engine.raise(draft('a', { title: 'Updated' }), 'p'); await flush()
  assert.deepEqual(deliveries.map(([revision]) => revision), [1, 2])
  await engine.withdraw(second.key); await flush()
  engine.announce('closed', second, 'withdrawn'); await flush()
  assert.deepEqual(retractions, [[2, 'withdrawn']]); assert.ok(deliveries[1][1].aborted)
  await engine.shutdown()
})

test('channel failures retry exponentially to 60 seconds and unregister cancels the timer', async (t) => {
  const { engine } = fixture(); let attempts = 0
  t.mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const release = engine.registerChannel({ id: 'retry', async deliver() { attempts++; throw new Error('OFFLINE') } })
    await engine.raise(draft('a'), 'p'); await flush()
    assert.equal(attempts, 1)
    for (const delay of [1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000]) {
      t.mock.timers.tick(delay - 1); await flush(); const previous = attempts
      t.mock.timers.tick(1); await flush(); assert.equal(attempts, previous + 1)
    }
    const before = attempts; await release(); t.mock.timers.tick(120000); await flush()
    assert.equal(attempts, before)
  } finally { t.mock.timers.reset(); await engine.shutdown() }
})

test('actual caller unload aborts delivery and waits for asynchronous adapter cleanup', async () => {
  const f = await mounted(); let signal, cleanup, finish
  try {
    const caller = f.ctx.plugin({ name: 'channel-owner', inject: ['attention'], apply(ctx) {
      ctx.attention.registerChannel({ id: 'slow', deliver(item, abort) {
        signal = abort
        return new Promise((resolve) => abort.addEventListener('abort', () => { cleanup = true; finish = resolve }, { once: true }))
      } })
    } }); await caller
    await f.engine.raise(draft('a'), 'p'); await flush()
    let disposed = false
    const disposal = caller.dispose().then(() => { disposed = true })
    await flush(); assert.ok(signal.aborted); assert.ok(cleanup); assert.equal(disposed, false)
    finish(); await disposal; assert.equal(disposed, true)
  } finally { await f.close() }
})

test('closing an in-flight failing channel aborts, awaits settlement then retracts without retry resurrection', async (t) => {
  const { engine } = fixture(); let signal, rejectDelivery, deliveries = 0, retracted = 0
  t.mock.timers.enable({ apis: ['setTimeout'] })
  try {
    engine.registerChannel({ id: 'close', deliver(item, abort) { deliveries++; signal = abort; return new Promise((resolve, reject) => { rejectDelivery = reject }) }, async retract() { retracted++ } })
    const item = await engine.raise(draft('a'), 'p'); await flush()
    await engine.withdraw(item.key); await flush()
    assert.ok(signal.aborted); assert.equal(retracted, 0)
    rejectDelivery(new Error('aborted transport')); await flush()
    assert.equal(retracted, 1)
    t.mock.timers.tick(120000); await flush(); assert.equal(deliveries, 1)
  } finally { t.mock.timers.reset(); await engine.shutdown() }
})

test('expired external facts are durably closed by timer without a reader', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() })
  const { engine, store } = fixture()
  try {
    const item = await engine.raise(draft('a'), 'p')
    // Long timers are chunked at the platform maximum; advance both chunks.
    t.mock.timers.tick(2147483647); await flush()
    t.mock.timers.tick(30 * 86400000 - 2147483647); await flush()
    await engine.queue
    assert.equal(store.data.external[item.key], undefined)
    assert.equal(store.data.ledger.find((row) => row.key === item.key)?.resolution, 'expired')
  } finally { t.mock.timers.reset(); await engine.shutdown() }
})

test('Host actions receive a signal and reject client executors while retaining client metadata', async () => {
  const { engine } = fixture(); let signal
  engine.registerAction({ id: 'host', side: 'host', async run(item, input, abort) { signal = abort } })
  engine.registerAction({ id: 'client', side: 'client', label: 'Client action' })
  const item = await engine.raise(draft('a', { actions: ['host', 'client'] }), 'p')
  await engine.act(item.key, item.revision, 'host'); assert.ok(signal instanceof AbortSignal)
  await assert.rejects(engine.act(item.key, item.revision, 'client'), /HOST_ACTION_REQUIRED/)
  assert.equal(engine.snapshot().actions.client.side, 'client')
  await engine.shutdown()
})
