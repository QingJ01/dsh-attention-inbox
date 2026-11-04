import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import * as plugin from '../index.js'

const runtime = process.env.DSH_TEST_RUNTIME

test('actual Cordis + SessionStore + ProjectionRegistry: mount, replay, route, teardown', { skip: !runtime && 'set DSH_TEST_RUNTIME to an installed/extracted DSH node_modules/@deepseek-ai directory' }, async () => {
  const load = (name) => import(pathToFileURL(`${runtime}/${name}/lib/index.js`).href)
  const { Context } = await load('cordis')
  const { default: SessionStore } = await load('dsh-session')
  const { default: Registry } = await load('dsh-session-projection')
  const ctx = new Context(); let route, global, closed = false
  ctx.provide('storageDomain', { async open(spec) {
    global ??= structuredClone(spec.global.initial)
    return { global: { get: () => structuredClone(global), async set(value) { global = spec.global.schema.parse(value) } }, async close() { closed = true } }
  } })
  ctx.provide('connection', { fetch: { register(def) { route = def; return ctx.effect(() => () => { route = undefined }) } } })
  try {
    await ctx.plugin(SessionStore)
    await ctx.plugin(Registry)
    const fiber = ctx.plugin(plugin)
    await fiber
    assert.equal(fiber.state, 2, 'ACTIVE')
    assert.equal(ctx.get('attention').apiVersion, 1)
    assert.equal(route.path, '/api/attention-inbox')
    const session = ctx.sessions.create('test-attention', { meta: { cwd: '/tmp' } })
    session.append('goal/change', { goal: { id: 'goal-test', revision: 1, phase: 'blocked', objective: 'Test recovery', blockedReason: { code: 'test', message: 'Human needed' } } })
    const view = ctx.get('attention').snapshot()
    assert.equal(view.items.length, 1)
    assert.equal(view.items[0].detail, 'Human needed')
    const response = await route.fetch(new Request('http://localhost/api/attention-inbox', { method: 'POST', body: '{"op":"state"}' }))
    assert.equal((await response.json()).items.length, 1)
    await fiber.dispose()
    assert.equal(ctx.get('attention'), undefined)
    assert.equal(closed, true)
  } finally { await ctx.fiber.dispose() }
})
