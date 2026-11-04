import { defineTool } from '@deepseek-ai/dsh-tools'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import * as askUserPlugin from '@deepseek-ai/dsh-tool-ask-user'
import planModePlugin from '@deepseek-ai/dsh-plan-mode'
import { createNativeFixtureHarness } from './native-fixture.js'
/** Temporary, owner-authenticated acceptance adapter; excluded from the product package. */
export const inject = ['connection', 'agents', 'tools', 'approval', 'userQuestions', 'sessions', 'sessionProjections', 'systemPrompt', 'workspaceRegistry', 'attention', 'sessionPersistence']
export function apply(ctx) {
  const fixtures = createNativeFixtureHarness(ctx, { defineTool, createUserMessage, askUserPlugin, planModePlugin })
  ctx.provide('attentionAcceptanceFixtures', fixtures)
  ctx.effect(() => () => fixtures.cleanup())
  const state = { attached: false, origin: null, error: null }, queued = [], pending = new Map()
  let waiter, serial = 0
  ctx.provide('attentionAcceptanceBridge', {
    status: () => ({ ...state }),
    command(command) {
      return new Promise((resolve, reject) => {
        const id = ++serial, timer = setTimeout(() => { pending.delete(id); reject(new Error('Browser acceptance command timed out')) }, 15000)
        pending.set(id, { resolve, reject, timer }); queued.push({ id, ...command }); waiter?.()
      })
    },
  })
  ctx.effect(() => () => { waiter?.(); for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('Acceptance adapter unloaded')) } pending.clear() })
  ctx.connection.fetch.register({ path: '/api/attentionAcceptance', methods: ['POST'], requestBody: 'buffered', async fetch(request) {
    const envelope = await request.json(), { op, ...payload } = envelope.payload
    let value = true
    if (op === 'hello') { state.origin = payload.origin; state.attached = true }
    else if (op === 'poll') {
      const report = payload.result
      if (report && pending.has(report.id)) { const item = pending.get(report.id); pending.delete(report.id); clearTimeout(item.timer); report.error ? item.reject(new Error(report.error)) : item.resolve(report.value) }
      if (!queued.length && !request.signal.aborted) await new Promise((resolve) => {
        const finish = () => { clearTimeout(timer); request.signal.removeEventListener('abort', finish); if (waiter === finish) waiter = undefined; resolve() }
        const timer = setTimeout(finish, 10000); waiter = finish; request.signal.addEventListener('abort', finish, { once: true })
      })
      value = queued.shift() ?? null
    } else throw new Error('Unknown operation')
    return Response.json({ type: 'server-response', rpcId: envelope.rpcId, result: { ok: true, value } })
  } })
}
