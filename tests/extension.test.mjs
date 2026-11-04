import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { AttentionService } from '../lib/service.js'
import { integrateHello } from '../examples/hello-producer/index.js'

const draft = (key = 'one') => ({ key, subject: { type: 'record', ref: key }, kind: 'review', title: 'Review completed record', blocking: 'soft' })
function service() {
  const warnings = []
  const store = { data: { dispositions: {}, external: {}, ledger: [], observations: {} }, async commit(next) { this.data = structuredClone(next) } }
  return { inbox: new AttentionService({ logger: { warn(...args) { warnings.push(args) } } }, store), store, warnings }
}

test('extension API rejects invalid submissions without acknowledging or changing facts', async () => {
  const { inbox, store } = service()
  const before = structuredClone(store.data)
  for (const input of [null, {}, { ...draft(), title: ' ' }, { ...draft(), blocking: 'urgent' }, { ...draft(), payload: { secret: undefined } }, { ...draft(), actions: ['same', 'same'] }]) {
    await assert.rejects(inbox.raise(input, 'extension'))
    assert.deepEqual(store.data, before)
    assert.deepEqual(inbox.list(), [])
  }
})

test('extension API enforces the per-producer 50 pending budget atomically and warns on refusal', async () => {
  const { inbox, warnings } = service()
  const results = await Promise.allSettled(Array.from({ length: 51 }, (_, i) => inbox.raise(draft(`item-${i}`), 'limited')))
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 50)
  const rejected = results.filter((result) => result.status === 'rejected')
  assert.equal(rejected.length, 1)
  assert.match(rejected[0].reason.message, /PRODUCER_LIMIT/)
  assert.ok(warnings.length > 0, '004 requires a warning when refusing producer budget overflow')
  const first = results[0].value
  await inbox.raise({ ...draft('item-0'), title: 'Changed existing obligation' }, 'limited')
  assert.equal(inbox.list().filter((item) => item.producer === 'limited').length, 50)
  await inbox.raise(draft('other-owner'), 'independent')
  await inbox.withdraw(first.key)
  await inbox.raise(draft('replacement'), 'limited')
  assert.equal(inbox.list().length, 51)
})

test('derived sources share the same producer budget across subjects and explicit submissions', async () => {
  const { inbox, warnings } = service()
  for (let i = 0; i < 49; i++) await inbox.raise(draft(`external-${i}`), 'mixed')
  inbox.registerProducer({ id: 'mixed', subjectType: 'record', derive: () => [{ key: 'ready', kind: 'review', title: 'Ready for acceptance' }] })
  inbox.invalidate('mixed', 'subject-a')
  const before = inbox.list()
  assert.throws(() => inbox.invalidate('mixed', 'subject-b'), /PRODUCER_LIMIT/)
  assert.deepEqual(inbox.list(), before, 'an overflowing derived update must preserve all prior facts')
  assert.ok(warnings.length > 0)
})

test('external obligations older than their expiry close as expired in the ledger', async () => {
  const { inbox, store } = service()
  const item = await inbox.raise(draft('expired'), 'old-producer')
  store.data.external[item.key].expiresAt = new Date(Date.now() - 1).toISOString()
  assert.deepEqual(inbox.list(), [])
  await inbox.queue
  assert.equal(store.data.external[item.key], undefined, 'expired facts must be removed, not merely hidden')
  assert.equal(store.data.ledger.find((row) => row.key === item.key)?.resolution, 'expired')
})

test('hello-producer is at most 50 lines and only raises in response to a caller fact', async () => {
  const code = await readFile(new URL('../examples/hello-producer/index.js', import.meta.url), 'utf8')
  assert.ok(code.trimEnd().split('\n').length <= 50)
  const { Context } = await import('@deepseek-ai/cordis')
  const { ContextualAttentionService } = await import('../lib/contextual.js')
  const ctx = new Context()
  const { inbox } = service(), listeners = new Set(), records = new Map()
  let acceptanceFailure = true
  const source = {
    subscribe(callback) { listeners.add(callback); return () => listeners.delete(callback) },
    async accept(id) { if (acceptanceFailure) throw new Error('SOURCE_REJECTED'); records.get(id).state = 'accepted' },
  }
  try {
  await ctx.plugin({ name: 'hello-attention-host', apply(scope) { new ContextualAttentionService(scope, inbox) } })
  const caller = ctx.plugin({ name: 'hello-real-caller', apply(scope) { integrateHello(scope, source) } })
  await caller
  assert.equal(listeners.size, 1)
  assert.equal(inbox.list().length, 0, 'mounting example cannot manufacture a business obligation')
  const record = { id: 'caller-record', title: 'Caller supplied acceptance request', state: 'ready' }
  records.set(record.id, record)
  for (const listener of listeners) await listener(record)
  const first = inbox.list()[0]
  await assert.rejects(inbox.act(first.key, first.revision, 'hello.accept'), /SOURCE_REJECTED/)
  assert.equal(inbox.list().length, 1, 'failed business action must keep obligation open')
  acceptanceFailure = false
  await inbox.act(first.key, first.revision, 'hello.accept')
  assert.equal(record.state, 'accepted')
  assert.equal(inbox.list().length, 0)
  for (const listener of listeners) await listener({ ...record, state: 'ready' })
  await caller.dispose()
  await inbox.queue
  assert.equal(listeners.size, 0)
  assert.equal(inbox.actions.size, 0)
  assert.equal(inbox.list().length, 0, 'contextual caller lifecycle withdraws owned obligations')
  } finally { await ctx.fiber.dispose() }
})

test('published API type declarations accept supported inputs and reject invalid extension code', async () => {
  const imported = process.env.DSH_TEST_TYPESCRIPT
    ? await import(pathToFileURL(process.env.DSH_TEST_TYPESCRIPT).href)
    : await import('typescript')
  const ts = imported.default ?? imported
  const filename = new URL('./fixtures/extension-contract.ts', import.meta.url).pathname
  const program = ts.createProgram([filename], { noEmit: true, strict: true, types: [], target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext })
  const diagnostics = ts.getPreEmitDiagnostics(program)
  assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCanonicalFileName: (name) => name, getCurrentDirectory: () => process.cwd(), getNewLine: () => '\n' }))
})
