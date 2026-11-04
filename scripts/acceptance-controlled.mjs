// Generate an isolated native-runtime recording. No profile, network, server,
// original user Session, or real model is used. Only the model stream is a stub.
import { pathToFileURL } from 'node:url'
import { writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
const runtime = process.env.DSH_TEST_RUNTIME
if (!runtime) throw new Error('Set DSH_TEST_RUNTIME to an existing native DSH runtime')
const load = (name) => import(pathToFileURL(`${runtime}/${name}/lib/index.js`).href)
const { Context } = await load('cordis')
const ctx = new Context()
let agent, calls = 0
try {
  for (const name of ['dsh-session', 'dsh-session-projection', 'dsh-agent', 'dsh-system-prompt', 'dsh-tools', 'dsh-goal']) {
    const { default: Plugin } = await load(name)
    await ctx.plugin(Plugin, {})
  }
  ctx.provide('llm', { async prepareCall(config) {
    return { config, async *stream() {
      calls++
      const goal = ctx.goals.get(agent)
      ctx.goals.complete(agent, { id: goal.id, revision: goal.revision })
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'Controlled acceptance completed.' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Controlled acceptance completed.' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    } }
  } })
  const { default: Loop } = await load('dsh-agent-loop')
  await ctx.plugin(Loop, { agents: [], maxParallelToolCalls: 1 })
  const Driver = await load('dsh-goal-round-driver')
  await ctx.plugin(Driver)
  agent = await ctx.agentLoop.create('controlled-acceptance', { provider: 'acceptance-stub', model: 'fixed-stream' })
  ctx.goals.create(agent, { objective: 'Controlled native runtime acceptance', maxGoalRounds: 1 })
  // Native driver asynchronously admits its own goal continuation.
  for (let tries = 0; tries < 1000; tries++) {
    await new Promise(setImmediate)
    if (calls && agent.status === 'idle') break
  }
  if (calls !== 1 || agent.status !== 'idle') throw new Error(`Native goal round did not finish: calls=${calls}, status=${agent.status}`)
  const raw = agent.session.events ?? agent.session.log
  if (!Array.isArray(raw)) throw new Error('Native Session log access contract unavailable')
  const goalIds = new Map()
  const events = raw.map((event) => {
    const data = {}
    if (event.type === 'turn/start' || event.type === 'turn/end') data.turn = event.data.turn
    if (event.type === 'turn/end') data.reason = { kind: event.data.reason.kind }
    if (event.type === 'user/message') data.source = { kind: event.data.source.kind }
    if (event.type === 'goal/change') {
      const goal = event.data.goal
      if (goal) {
        if (!goalIds.has(goal.id)) goalIds.set(goal.id, `g${goalIds.size + 1}`)
        data.goal = { id: goalIds.get(goal.id), revision: goal.revision, phase: goal.phase, objective: '[redacted]' }
      } else data.goal = null
    }
    return { type: event.type, seq: event.seq, time: event.time, data }
  })
  if (!events.some((event) => event.type === 'user/message' && event.data.source?.kind === 'goal')) throw new Error('Native driver did not emit a goal-sourced user message')
  const fixture = { provenance: {
    capturedAt: new Date().toISOString(), capture: 'controlled-native-runtime; actual AgentLoop + goal-round-driver; deterministic model stream stub',
    runtime, modelCalls: calls, manualSessionAppends: 0,
    redactions: ['all content/arguments/results removed at source; goal identity anonymized and objective replaced with fixed [redacted]'],
  }, sessions: [{ id: 'controlled-s1', origin: 'user', events }] }
  const bytes = JSON.stringify(fixture, null, 2) + '\n'
  await writeFile(new URL('../tests/fixtures/controlled-native-structure.json', import.meta.url), bytes)
  const manifest = { sha256: createHash('sha256').update(bytes).digest('hex'), eventCount: events.length, provenance: fixture.provenance }
  await writeFile(new URL('../tests/fixtures/controlled-native-structure.manifest.json', import.meta.url), JSON.stringify(manifest, null, 2) + '\n')
  console.log(JSON.stringify(manifest, null, 2))
} finally { await ctx.fiber.dispose() }
