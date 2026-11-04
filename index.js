import { AttentionService, openStore } from './lib/service.js'
import { ContextualAttentionService } from './lib/contextual.js'
import { PROJECTION_KEY, projection, obligationsOf, approvalsOf, questionsOf } from './lib/projection.js'
export { AttentionService, openStore }
export const ROUTE = '/api/attention-inbox'
export const inject = ['storageDomain', 'sessionProjections', 'sessions', 'connection']

export async function apply(ctx) {
  const store = await openStore(ctx)
  const service = new AttentionService(ctx, store)
  ctx.effect(() => () => service.shutdown(), 'attention-inbox: lifecycle')
  new ContextualAttentionService(ctx, service)
  ctx.inject(['workspaceRegistry'], (scope) => { service.workspaceRegistry = scope.workspaceRegistry; scope.effect(() => () => { service.workspaceRegistry = undefined }) })
  ctx.connection.fetch.register({ path: ROUTE, methods: ['POST'], requestBody: 'buffered', fetch: (request) => service.handleRoute(request) })
  ctx.sessionProjections.register(projection)
  const update = (session, state, liveApprovals = true) => {
    if (!state) return
    service.observeCounts(session.id, state.counts)
    if (session.header.origin === 'subagent') return
    service.observeSession(session.header)
    for (const id of state.decisions ?? []) service.confirmNative(session.id, 'approval', id)
    service.invalidateDerived('builtin-session', session.id, obligationsOf(session.id, state).filter((item) => item.kind !== 'review' || !service.suppressVisibleReview(session.id, item)))
    service.invalidateDerived('builtin-approval', session.id, liveApprovals ? approvalsOf(session.id, state) : [])
  }
  const updateQuestions = (session, view) => {
    if (session.header.origin === 'subagent') return
    service.observeSession(session.header)
    for (const item of view?.settled ?? []) {
      service.confirmNative(session.id, 'question', item.callId)
      service.confirmNative(session.id, 'plan-review', item.callId)
    }
    service.observeCounts(session.id, Object.fromEntries((view?.active ?? []).filter((item) => item.questions.length > 1).map((item) => [`question-merge:${item.callId}`, { at: new Date().toISOString(), layer: 'l2', count: item.questions.length - 1 }])))
    service.invalidateDerived('builtin-question', session.id, questionsOf(session.id, view))
  }
  ctx.sessionProjections.onChanged((session, key, value) => {
    if (key === PROJECTION_KEY) update(session, value)
    if (key === 'userQuestions') updateQuestions(session, value)
  })
  const refreshSession = (session) => {
    update(session, ctx.sessionProjections.stateOf(session, PROJECTION_KEY))
    updateQuestions(session, ctx.sessionProjections.stateOf(session, 'userQuestions')?.questions)
  }
  ctx.on('session/created', refreshSession)
  for (const session of ctx.sessions.list()) refreshSession(session)

  // Credential recovery follows the account owner; unrelated authorization never clears it.
  ctx.inject(['deepseekAccount'], (scope) => {
    const abort = new AbortController()
    let key = service.raw().find((item) => item.producer === 'builtin-account')?.key
    const raise = async () => {
      const item = await service.raise({ key: 'sign-in', subject: { type: 'system', ref: 'account' },
        kind: 'credential', blocking: 'system', title: 'DeepSeek 登录已失效 / Sign-in required', actions: [] }, 'builtin-account')
      key = item.key
    }
    scope.on('deepseek-account/model-sign-in-required', () => { void raise().catch((e) => service.warn(e)) })
    scope.on('deepseek-account/session-expired', () => { void raise().catch((e) => service.warn(e)) })
    scope.effect(() => {
      const task = (async () => {
        for await (const state of scope.deepseekAccount.watch(abort.signal)) {
          if (state.status === 'credential-stored' && key) await service.withdraw(key, 'acted')
        }
      })().catch((error) => { if (!abort.signal.aborted) service.warn(error) })
      return async () => { abort.abort(); await task }
    })
  })
  // Read-only observations use the registry's projected state and never activate agents.
  ctx.inject(['sessionQuery'], (scope) => {
    const abort = new AbortController()
    const task = (async () => {
      const records = await scope.sessionQuery.listSessions(abort.signal)
      for (const record of records) {
        if (abort.signal.aborted) return
        if (record.live || record.formatStatus === 'migration-required') continue
        let observation
        try {
          observation = await scope.sessionQuery.observeSession(record.header.id, { signal: abort.signal })
          if (scope.sessions.get(record.header.id)) continue
          const recentAt = observation.events?.at(-1)?.time ?? record.header.createdAt
          if (recentAt < Date.now() - 7 * 86400_000) continue
          const values = observation.projections?.values ?? {}
          const state = values[PROJECTION_KEY]
          const session = { id: record.header.id, header: record.header }
          // A prepared Session has no surviving in-process approval waiter.
          if (state) update(session, state, false)
          updateQuestions(session, { ...values.userQuestions, active: (values.userQuestions?.active ?? []).filter((item) => item.state === 'continued') })
        } catch (error) { if (!abort.signal.aborted) { service.health.errors++; service.warn(error) } }
        finally { observation?.[Symbol.dispose]() }
      }
      service.health.backfill = service.health.errors ? 'partial' : 'ready'
    })().catch((error) => { if (!abort.signal.aborted) { service.health.backfill = 'partial'; service.warn(error) } })
    scope.effect(() => async () => { abort.abort(); await task })
  })
}
