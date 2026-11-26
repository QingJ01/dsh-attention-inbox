import { AttentionService, openStore } from './lib/service.js'
import { ContextualAttentionService } from './lib/contextual.js'
import { NotesService, openNotesStore, NOTES_ROUTE } from './lib/notes.js'
import { isoDate } from './lib/schedule.js'
import { ProjectsService, PROJECTS_ROUTE } from './lib/projects.js'
import { PROJECTION_KEY, projection, obligationsOf, approvalsOf, questionsOf, plansOf } from './lib/projection.js'
export { AttentionService, openStore, NotesService, openNotesStore, NOTES_ROUTE, ProjectsService, PROJECTS_ROUTE }
export const ROUTE = '/api/attention-inbox'
export const inject = ['storageDomain', 'sessionProjections', 'sessions', 'connection']

export async function apply(ctx) {
  // Both stores open before any registration, so every listener below is installed synchronously as before.
  const [store, notesStore] = await Promise.all([openStore(ctx), openNotesStore(ctx)])
  const service = new AttentionService(ctx, store)
  ctx.effect(() => () => service.shutdown(), 'attention-inbox: lifecycle')
  new ContextualAttentionService(ctx, service)
  ctx.inject(['workspaceRegistry'], (scope) => { service.workspaceRegistry = scope.workspaceRegistry; scope.effect(() => () => { service.workspaceRegistry = undefined }) })
  // Daily notes share the inbox lifecycle but keep their own storage domain and route.
  const notes = new NotesService(notesStore, {
    workspaces: () => service.workspaceRegistry?.list(),
    sessionQuery: () => service.sessionQuery,
    inboxActed: (day) => service.store.data.ledger.filter((row) => row.resolution === 'acted' && row.via === 'inbox' && row.closedAt && isoDate(new Date(row.closedAt)) === day).length,
    warn: (error) => service.warn(error),
  })
  ctx.effect(() => () => notes.shutdown(), 'attention-inbox: notes lifecycle')
  // Project timelines only read Session logs; they keep no storage of their own.
  const projects = new ProjectsService({
    workspaces: () => service.workspaceRegistry?.list(),
    archived: () => service.workspaceRegistry?.archivedSessionIds,
    sessionQuery: () => service.sessionQuery,
    warn: (error) => service.warn(error),
  })
  ctx.effect(() => () => projects.shutdown(), 'attention-inbox: projects lifecycle')
  ctx.connection.fetch.register({ path: PROJECTS_ROUTE, methods: ['POST'], requestBody: 'buffered', fetch: (request) => projects.handleRoute(request) })
  ctx.connection.fetch.register({ path: NOTES_ROUTE, methods: ['POST'], requestBody: 'buffered', fetch: (request) => notes.handleRoute(request) })
  ctx.connection.fetch.register({ path: ROUTE, methods: ['POST'], requestBody: 'buffered', fetch: (request) => service.handleRoute(request) })
  ctx.sessionProjections.register(projection)
  // Native tools/result retains the typed value; the later Session log stores rendered content.
  // Only the exact successful plan approval confirms acted. Cancellation returns approved:false.
  ctx.on('tools/result', (exec, result) => {
    if (exec.name !== 'exit_plan_mode' || !exec.agent || exec.signal?.aborted || result.isError !== false || result.value?.approved !== true) return
    const session = ctx.sessions.get(exec.agent.id)
    if (session !== exec.agent.session || !service.raw().some((item) => item.producer === 'builtin-plan' && item.subject.ref === session.id && item.native?.callId === exec.callId)) return
    service.confirmNative(session.id, 'plan-review', exec.callId)
  })
  const update = (session, state, liveApprovals = true) => {
    if (!state) return
    service.observeCounts(session.id, state.counts)
    if (session.header.origin === 'subagent') return
    service.observeSession(session.header)
    for (const id of state.decisions ?? []) service.confirmNative(session.id, 'approval', id)
    service.invalidateDerived('builtin-session', session.id, obligationsOf(session.id, state).filter((item) => item.kind !== 'review' || !service.suppressVisibleReview(session.id, item)))
    service.invalidateDerived('builtin-approval', session.id, liveApprovals ? approvalsOf(session.id, state) : [])
    service.invalidateDerived('builtin-plan', session.id, liveApprovals ? plansOf(session.id, state) : [])
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
    service.sessionQuery = scope.sessionQuery
    void service.refreshActivities().catch((error) => service.warn(error))
    scope.effect(() => () => { service.sessionQuery = undefined })
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
