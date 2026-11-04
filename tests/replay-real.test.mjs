import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { applyEvent, initialState, obligationsOf, projection } from '../lib/projection.js'
import * as plugin from '../index.js'
import { AttentionService } from '../lib/service.js'

const fixtureNames = ['real-session-structure', 'controlled-native-structure']
const runtime = process.env.DSH_TEST_RUNTIME
const load = (name) => import(pathToFileURL(`${runtime}/${name}/lib/index.js`).href)
const fixture = async () => ({ sessions: (await Promise.all(fixtureNames.map(async (name) =>
  JSON.parse(await readFile(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'))))).flatMap((data) => data.sessions) })
const relevantTypes = new Set(['goal/change', 'turn/start', 'turn/end', 'user/message'])
// All original envelopes remain in the fixture. Only the replay input maps
// unrelated payload-stripped types to an inert marker; no event is invented.
const eventsOf = (session) => session.events.map((event) => relevantTypes.has(event.type)
  ? event : { ...event, type: 'acceptance/ignored', data: {} })
const sourceKind = (event) => event.data?.source?.kind

// This is a structural recording. Body text and payloads are never reconstructed.
// Count completed turns with positive source evidence; metadata messages do not
// create turns, and any human input in a turn excludes autonomous attribution.
const autonomousSources = new Set(['goal', 'schedule', 'agent-message', 'subagent-settled', 'tool-jobs'])
function audit(events) {
  let state = initialState(), autonomousTurns = 0, human = false, automatic = false
  const reviews = new Set()
  for (const event of events) {
    if (event.type === 'turn/start') { human = false; automatic = false }
    if (event.type === 'user/message') {
      if (sourceKind(event) === 'user') human = true
      if (autonomousSources.has(sourceKind(event))) automatic = true
    }
    if (event.type === 'turn/end' && event.data.reason?.kind === 'completed' && automatic && !human) autonomousTurns++
    state = applyEvent(state, event)
    for (const item of obligationsOf('anonymous-session', state, event.time)) {
      if (item.kind === 'review') reviews.add(item.key)
    }
  }
  return { state, autonomousTurns, reviews: reviews.size }
}

test('recorded structural fixture has an independently verifiable SHA-256 and no content payloads', async () => {
  for (const name of fixtureNames) {
    const bytes = await readFile(new URL(`./fixtures/${name}.json`, import.meta.url))
    const manifest = JSON.parse(await readFile(new URL(`./fixtures/${name}.manifest.json`, import.meta.url), 'utf8'))
    assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.sha256)
    const data = JSON.parse(bytes)
    assert.ok(data.sessions.length > 0)
    let count = 0
    for (const session of data.sessions) for (const event of session.events) {
      count++
      assert.deepEqual(Object.keys(event).sort(), ['data', 'seq', 'time', 'type'])
      assert.ok(Number.isSafeInteger(event.seq) && Number.isFinite(event.time))
      for (const key of Object.keys(event.data)) assert.ok(['turn', 'source', 'reason', 'goal'].includes(key), `unexpected payload key: ${key}`)
      if (event.data.source) assert.deepEqual(Object.keys(event.data.source), ['kind'])
      if (event.data.reason) assert.deepEqual(Object.keys(event.data.reason), ['kind'])
      if (event.data.goal) {
        assert.equal(event.data.goal.objective, '[redacted]')
        assert.match(event.data.goal.id, /^g\d+$/)
        assert.ok(Object.keys(event.data.goal).every((key) => ['id', 'revision', 'phase', 'objective'].includes(key)))
      }
    }
    assert.equal(count, manifest.eventCount)
  }
})

test('real recording: unique review obligations do not exceed source-proven autonomous completed turns', async (t) => {
  const data = await fixture()
  let rounds = 0, reviews = 0
  for (const session of data.sessions) {
    const result = audit(eventsOf(session))
    rounds += result.autonomousTurns; reviews += result.reviews
    if (session.id === 'controlled-s1') {
      assert.equal(result.autonomousTurns, 1, 'native driver must record one completed autonomous turn')
      assert.equal(result.reviews, 1, 'controlled positive recording must produce a review')
    }
    t.diagnostic(`${session.id}: source-proven autonomous completed turns=${result.autonomousTurns}; unique reviews=${result.reviews}`)
    assert.ok(result.reviews <= result.autonomousTurns,
      `${session.id}: ${result.reviews} reviews exceed ${result.autonomousTurns} autonomous goal rounds`)
  }
  t.diagnostic(`recorded sessions=${data.sessions.length}; autonomous completed turns=${rounds}; unique reviews=${reviews}`)
  if (rounds === 0 || reviews === 0) t.diagnostic('Coverage limitation: zero autonomous rounds or zero reviews; this recording cannot establish non-vacuous positive review acceptance.')
})

test('actual runtime restores every recorded prefix exactly like incremental projection, including checkpoint tail replay', { skip: !runtime && 'set DSH_TEST_RUNTIME to real DSH runtime' }, async () => {
  const { Context } = await load('cordis')
  const { default: SessionStore } = await load('dsh-session')
  const { default: Registry } = await load('dsh-session-projection')
  const data = await fixture()
  const ctx = new Context()
  try {
    await ctx.plugin(SessionStore); await ctx.plugin(Registry)
    ctx.sessionProjections.register(projection)
    for (const session of data.sessions) {
      const events = eventsOf(session)
      const header = { id: session.id, version: 4, createdAt: events[0]?.time ?? 0, isSeeded: false }
      let incremental = initialState()
      for (let index = 0; index < events.length; index++) {
        const event = events[index]
        // The recording must preserve all envelopes, even payloads irrelevant to this projection.
        assert.equal(event.seq, index)
        incremental = applyEvent(incremental, event)
        const cold = ctx.sessionProjections.restore({}, events.slice(0, index + 1), 0, header, 0)
        assert.deepEqual(cold.snapshot.values.attentionInbox, incremental, `${session.id} at seq ${event.seq}`)
      }
      const split = Math.floor(events.length / 2)
      const before = ctx.sessionProjections.restore({}, events.slice(0, split), 0, header, 0)
      const after = ctx.sessionProjections.restore(before.checkpoint, events.slice(split), split, header, 0)
      assert.deepEqual(after.snapshot.values.attentionInbox, incremental)
    }
  } finally { await ctx.fiber.dispose() }
})

test('real recording: actual Host cold backfill obligations equal live derivation', { skip: !runtime && 'set DSH_TEST_RUNTIME to real DSH runtime' }, async () => {
  const { Context } = await load('cordis')
  const { default: SessionStore } = await load('dsh-session')
  const { default: Registry } = await load('dsh-session-projection')
  const data = await fixture()
  for (const session of data.sessions) {
    const events = eventsOf(session), ctx = new Context()
    let persisted, route
    ctx.provide('storageDomain', { async open(spec) {
      persisted = structuredClone(spec.global.initial)
      return { global: { get: () => structuredClone(persisted), async set(next) { persisted = spec.global.schema.parse(next) } }, async close() {} }
    } })
    ctx.provide('connection', { fetch: { register(definition) { route = definition; return () => {} } } })
    try {
      await ctx.plugin(SessionStore); await ctx.plugin(Registry)
      ctx.sessionProjections.register(projection)
      const header = { id: session.id, version: 4, createdAt: Date.now(), isSeeded: false }
      const restored = ctx.sessionProjections.restore({}, events, 0, header, 0)
      // Adapter replaces only the persistence transport; cold derivation below is
      // the actual plugin path with real runtime Registry wire state.
      ctx.provide('sessionQuery', {
        async listSessions() { return [{ header, live: false, persisted: true }] },
        async observeSession() { return { projections: restored.snapshot, [Symbol.dispose]() {} } },
      })
      await ctx.plugin(plugin)
      const snapshot = async () => (await route.fetch(new Request('http://localhost/api/attention-inbox', { method: 'POST', body: '{"op":"state"}' }))).json()
      let view = await snapshot()
      for (let tries = 0; view.health.backfill === 'pending' && tries < 100; tries++) {
        await new Promise(setImmediate)
        view = await snapshot()
      }
      assert.equal(view.health.backfill, 'ready')
      const live = new AttentionService({}, { data: persisted, async commit() {} })
      let state = initialState()
      for (const event of events) {
        state = applyEvent(state, event)
        live.invalidateDerived('builtin-session', session.id, obligationsOf(session.id, state))
      }
      await live.queue
      assert.deepEqual(ctx.attention.list(), live.list(), `${session.id}: actual cold Host and live obligations differ`)
      await live.shutdown()
    } finally { await ctx.fiber.dispose() }
  }
})
