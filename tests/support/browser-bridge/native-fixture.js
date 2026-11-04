import { createHash, randomUUID } from 'node:crypto'

/** Temporary acceptance support only. Import this from the local test bridge, never the product bundle.
 * Native packages are supplied by the bridge's normal module loader so Cordis class identities match.
 */
export function createNativeFixtureHarness(ctx, { defineTool, createUserMessage, askUserPlugin, planModePlugin }) {
  const kinds = new Set(['approval-allow', 'approval-reject', 'question-open', 'question-continued', 'plan-review'])
  const fixtures = new Map(), attemptedIds = new Set()
  const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
  const eventsOf = (session, count = session.seq) => typeof session.snapshotEvents === 'function'
    ? session.snapshotEvents(0, count) : (session.events ?? session.log).slice(0, count)
  const baseline = ctx.sessions.list().map((session) => ({ id: session.id, seq: session.seq,
    headerHash: hash(session.header), prefixHash: hash(eventsOf(session)) }))
  const workspaceBaseline = (ctx.get('workspaceRegistry')?.list() ?? []).map((w) => ({ id: w.id, sessionIds: [...w.sessionIds] }))
  const provenance = { model: 'fixed local stream stub', nativeAgentLoop: true, nativeApprovalAndQuestions: true,
    manualPendingObjects: 0, manualSessionAppends: 0, realProviderCalls: 0 }
  let closed = false

  function status(id) {
    const entry = fixtures.get(id)
    if (!entry) throw new Error('UNKNOWN_FIXTURE')
    const { agent } = entry.handle
    const events = eventsOf(agent.session)
    const questions = ctx.sessionProjections.stateOf(agent.session, 'userQuestions')?.questions
    const attention = ctx.get('attention')?.engine ?? ctx.get('attention')
    return { id, kind: entry.kind, callId: entry.callId, launched: entry.launched === true, running: agent.status === 'running', disposed: entry.disposed,
      approvalPolicyBeforeRequest: entry.approvalPolicyBeforeRequest ?? null, approvalPolicyAtRequest: entry.approvalPolicyAtRequest ?? null,
      approvalPolicies: events.filter((event) => event.type === 'approval/policy').map((event) => ({ seq: event.seq, ...event.data })), 
      modelStubCalls: entry.calls, toolExecuted: entry.executed || events.some((event) => event.type === 'tool/call' && event.data.callId === entry.callId), nativeOutcome: entry.outcome ?? null,
      provenance, eventTypes: events.map((event) => event.type),
      approvals: events.filter((event) => event.type === 'approval/asked' || event.type === 'approval/decided').map((event) => ({ type: event.type, seq: event.seq, ...event.data })),
      questions: questions ? { active: questions.active.map((q) => ({ callId: q.callId, state: q.state })), settled: questions.settled.map((q) => ({ callId: q.callId, answerCount: q.answers.length })) } : null,
      toolResults: events.filter((event) => event.type === 'tool/result').map((event) => ({ callId: event.data.message.toolCallId,
        isError: event.data.message.isError === true, errorCode: event.data.error?.code ?? null })),
      ...(attention ? { attention: { items: attention.raw().filter((item) => item.subject.type === 'session' && item.subject.ref === id),
        ledger: attention.store.data.ledger.filter((row) => row.subject?.ref === id), metrics: attention.snapshot().metrics } } : {}),
    }
  }

  async function start({ kind, cwd, deferLaunch = false, sessionId = `attention-acceptance-${randomUUID()}` } = {}) {
    if (closed || !kinds.has(kind)) throw new Error('INVALID_FIXTURE')
    if (!sessionId.startsWith('attention-acceptance-') || ctx.sessions.get(sessionId) || fixtures.has(sessionId)) throw new Error('INVALID_FIXTURE_ID')
    if (await ctx.get('sessionPersistence')?.stat(sessionId)) throw new Error('FIXTURE_ID_ALREADY_PERSISTED')
    attemptedIds.add(sessionId)
    cwd ??= ctx.get('workspaceRegistry')?.list()[0]?.path
    const entry = { kind, callId: `acceptance-call-${randomUUID()}`, calls: 0, executed: false, disposed: false }
    const question = { id: 'fixture-choice', question: `Acceptance ${kind}: choose a value.`, options: [{ label: 'Yes' }, { label: 'No' }] }
    let handle
    try {
      handle = await ctx.agents.create({ sessionId, agentOptions: { provider: 'acceptance-stub', model: 'fixed-stream' },
        ...(cwd ? { meta: { cwd } } : {}),
        async setup(agentCtx, agent) {
          // The fixture's driver owns this field. No shared service, model config or other agent is changed.
          const originalLoopCtx = agent.loopCtx
          if (!originalLoopCtx || typeof originalLoopCtx.llm?.prepareCall !== 'function') throw new Error('UNSUPPORTED_AGENT_LOOP')
          const toolName = kind.startsWith('approval-') ? 'attention_acceptance_approval' : kind === 'plan-review' ? 'exit_plan_mode' : 'ask_user_question'
          const args = kind.startsWith('approval-') ? {} : kind === 'plan-review'
            ? { plan: '# Acceptance plan\n\n1. Confirm this isolated fixture.\n2. End without touching user files.' }
            : { questions: [question], timeout: kind === 'question-continued' ? 1 : -1 }
          const stub = { async prepareCall(config) {
            return { config, async *stream() {
              const call = ++entry.calls
              if (call > 8) throw new Error('FIXTURE_MODEL_CALL_BUDGET')
              if (call === 1) {
                const argumentsText = JSON.stringify(args)
                yield { type: 'block-start', index: 0, blockType: 'tool-call' }
                yield { type: 'tool-call-delta', index: 0, id: entry.callId, name: toolName, argumentsDelta: argumentsText }
                yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: entry.callId, name: toolName, arguments: argumentsText } }
                yield { type: 'finish', reason: { kind: 'tool-calls' } }
              } else {
                yield { type: 'block-start', index: 0, blockType: 'text' }
                yield { type: 'text-delta', index: 0, text: 'Acceptance fixture completed.' }
                yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Acceptance fixture completed.' } }
                yield { type: 'finish', reason: { kind: 'stop' } }
              }
            } }
          } }
          agent.loopCtx = new Proxy(originalLoopCtx, { get(target, key, receiver) { return key === 'llm' ? stub : Reflect.get(target, key, receiver) } })
          agentCtx.effect(() => () => { agent.loopCtx = originalLoopCtx })
          if (kind.startsWith('approval-')) {
            agentCtx.get('approval').setPolicy(agent, 'ask')
            agentCtx.tools.register(defineTool({ name: toolName,
              description: 'Request approval for this isolated acceptance fixture.', parameters: {},
              output: { schema: { type: 'object', properties: { outcome: { type: 'string', required: true } }, additionalProperties: false },
                render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
              async execute(_args, exec) {
                entry.executed = true
                const approval = agentCtx.get('approval')
                entry.approvalPolicyBeforeRequest = approval.overrideOf(agent.session) ?? approval.config?.policy ?? null
                // Agent-created initialization can select a default after setup. Set this fixture's
                // own policy at the actual request boundary; no other Session policy is touched.
                approval.setPolicy(agent, 'ask')
                entry.approvalPolicyAtRequest = approval.overrideOf(agent.session) ?? approval.config?.policy ?? null
                entry.outcome = await approval.request({ agent, toolName, callId: exec.callId,
                  reason: `Acceptance fixture ${kind}; no file or network operation.`, signal: exec.signal })
                return { outcome: entry.outcome }
              },
            }))
          } else if (kind === 'plan-review') {
            if (!planModePlugin) throw new Error('PLAN_MODULE_REQUIRED')
            const planCtx = agentCtx.isolate('planMode')
            await planCtx.plugin(planModePlugin, { section: 'For this acceptance fixture, present the isolated plan for review.' })
            planCtx.get('planMode').set(agent, true)
          } else {
            if (!askUserPlugin?.apply) throw new Error('ASK_USER_MODULE_REQUIRED')
            await agentCtx.plugin(askUserPlugin, { mode: 'timed', timeout: 120 })
          }
        },
      })
      entry.handle = handle; fixtures.set(sessionId, entry)
      if (cwd) {
        const workspace = await ctx.get('workspaceRegistry')?.resolveByPath(cwd)
        if (workspace) { await workspace.attachSession(sessionId); entry.workspaceId = workspace.id }
      }
      if (!deferLaunch) launch(sessionId)
      return { id: sessionId, kind, callId: entry.callId, workspaceId: entry.workspaceId ?? null, launched: entry.launched === true, provenance }
    } catch (error) { await handle?.dispose(); throw error }
  }

  /** Invoke only after the browser has retained the fixture Session through its native sidebar.
   * The frontend's own pending-interaction provider remains the sole answerer.
   */
  function launch(id) {
    const entry = fixtures.get(id)
    if (!entry || entry.disposed || closed) throw new Error('UNKNOWN_FIXTURE')
    if (entry.launched) throw new Error('FIXTURE_ALREADY_LAUNCHED')
    entry.launched = true
    entry.handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: `Run isolated acceptance fixture: ${entry.kind}.` }], source: { kind: 'user' } }))
    return { id, launched: true, provenance }
  }

  async function finish(id) {
    const entry = fixtures.get(id)
    if (!entry) throw new Error('UNKNOWN_FIXTURE')
    const result = status(id)
    if (!entry.disposed) { await entry.handle.dispose(); entry.disposed = true }
    return result
  }

  async function cleanup() {
    closed = true
    const results = [], errors = []
    for (const [id] of fixtures) {
      try { results.push(await finish(id)) } catch (error) { errors.push({ id, error: String(error.message) }) }
      for (const workspace of ctx.get('workspaceRegistry')?.list() ?? []) if (workspace.sessionIds.includes(id)) {
        try { await workspace.detachSession(id) } catch (error) { errors.push({ id, error: String(error.message) }) }
      }
      const attention = ctx.get('attention')?.engine ?? ctx.get('attention')
      if (attention) {
        for (const producer of ['builtin-session', 'builtin-approval', 'builtin-question']) attention.invalidateDerived(producer, id, [])
        await attention.queue
        await attention.transact((state) => {
          state.ledger = state.ledger.filter((row) => row.subject?.ref !== id)
          for (const key of Object.keys(state.observations ?? {})) if (key.startsWith(`${id}:`)) delete state.observations[key]
          for (const key of Object.keys(state.dispositions)) if (key.includes(`:session:${encodeURIComponent(id)}:`)) delete state.dispositions[key]
        })
        attention.sessionFacts.delete(id)
      }
    }
    const originalsUnchanged = baseline.every((before) => {
      const current = ctx.sessions.get(before.id)
      return current && current.seq >= before.seq && hash(current.header) === before.headerHash && hash(eventsOf(current, before.seq)) === before.prefixHash
    })
    const workspaceOrderUnchanged = workspaceBaseline.every((before) => {
      const current = ctx.get('workspaceRegistry')?.get(before.id)
      return current && JSON.stringify(current.sessionIds.filter((id) => before.sessionIds.includes(id))) === JSON.stringify(before.sessionIds)
    })
    return { results, errors, originalsUnchanged, workspaceOrderUnchanged,
      liveFixtureIds: [...fixtures.keys()].filter((id) => ctx.sessions.get(id) || ctx.agents.get(id)),
      persistedFixtureIdsToRemove: [...attemptedIds], baseline, provenance }
  }
  return { start, launch, status, finish, cleanup, ids: () => [...fixtures.keys()], baseline, provenance }
}
