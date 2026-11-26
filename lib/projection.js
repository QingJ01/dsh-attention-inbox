import { z } from 'zod'

export const PROJECTION_KEY = 'attentionInbox'
const goalSchema = z.object({ id: z.string(), revision: z.number(), phase: z.string(), objective: z.string(), blockedReason: z.object({ code: z.string(), message: z.string() }).optional() }).passthrough()
const approvalSchema = z.object({ id: z.string(), toolName: z.string(), callId: z.string().optional(), reason: z.string().optional(), at: z.string() })
export const stateSchema = z.object({
  approvals: z.array(approvalSchema), goal: goalSchema.nullable(), goalAt: z.string().nullable(), title: z.string(),
  failure: z.object({ seq: z.number(), at: z.string(), message: z.string(), kind: z.string() }).nullable(),
  trigger: z.string().nullable(), turnSource: z.string().nullable(), review: z.object({ seq: z.number(), at: z.string() }).nullable(),
  counts: z.record(z.string(), z.object({ at: z.string(), layer: z.string(), count: z.number() })),
  decisions: z.array(z.string()), excluded: z.boolean(),
  plans: z.array(z.object({ callId: z.string(), plan: z.string(), at: z.string() })),
})
export const initialState = (header = {}) => ({ approvals: [], goal: null, goalAt: null, title: '', failure: null, trigger: null, turnSource: null, review: null, counts: {}, decisions: [], plans: [], excluded: header.origin === 'subagent' })
const autonomous = new Set(['goal', 'schedule', 'agent-message', 'subagent-settled', 'tool-jobs'])
/** Count identified source events once by stable seq, so replay and repeated reads agree. */
export function applyEvent(state, event) {
  const at = () => new Date(event.time ?? Date.now()).toISOString()
  const count = (layer, n = 1) => ({ ...state, counts: { ...state.counts, [event.seq]: { at: at(), layer, count: n } } })
  switch (event.type) {
    case 'approval/asked': return { ...state, approvals: [...state.approvals.filter((a) => a.id !== event.data.id), { ...event.data, at: at() }] }
    case 'approval/decided': return { ...state, approvals: state.approvals.filter((item) => item.id !== event.data.id), decisions: [...state.decisions, event.data.id] }
    case 'goal/change': {
      const parsed = goalSchema.safeParse(event.data.goal)
      return { ...state, goal: parsed.success ? parsed.data : null, goalAt: at() }
    }
    case 'session/title': return { ...state, title: event.data.title ?? state.title }
    case 'user/message': return { ...state, trigger: event.data.source?.kind ?? null, turnSource: state.turnSource === 'user' ? 'user' : event.data.source?.kind ?? null, review: null }
    case 'turn/start': return { ...state, turnSource: state.trigger, trigger: null, approvals: [], plans: [], failure: null, review: null }
    case 'assistant/message':
      return event.data.message?.channel === 'commentary' ? count('l1') : state
    case 'tool/call': {
      if (event.data.name !== 'exit_plan_mode') return ['todo_write', 'update_plan'].includes(event.data.name) ? count('l1') : state
      let args
      try { args = JSON.parse(event.data.arguments) } catch { return state }
      if (typeof event.data.callId !== 'string' || typeof args?.plan !== 'string' || !/^#\s+\S/.test(args.plan.trim())) return state
      return { ...state, plans: [...state.plans.filter((plan) => plan.callId !== event.data.callId), { callId: event.data.callId, plan: args.plan, at: at() }] }
    }
    case 'tool/result': {
      const next = event.data.error || event.data.message?.isError ? count('l1') : state
      const plans = state.plans.filter((plan) => plan.callId !== event.data.message?.toolCallId)
      return plans.length === state.plans.length ? next : { ...next, plans }
    }
    case 'turn/end': {
      if (state.excluded) return { ...count('l1'), approvals: [], plans: [], review: null, failure: null }
      const reason = event.data.reason
      const closed = state.approvals.length || state.plans.length ? { ...state, approvals: [], plans: [] } : state
      if (reason.kind === 'aborted') return { ...count('l1'), approvals: [], plans: [] }
      if (reason.kind === 'completed' && autonomous.has(state.turnSource)) return {
        ...closed, turnSource: null, trigger: null, review: { seq: event.seq, at: at() },
        counts: { ...state.counts, [`autonomous:${event.seq}`]: { at: at(), layer: 'autonomous', count: 1 } },
      }
      if (!['error', 'max-tokens', 'interrupted', 'blocked'].includes(reason.kind)) return closed
      return { ...closed, failure: { seq: event.seq, at: at(), kind: reason.kind, message: reason.error?.message ?? reason.kind } }
    }
    default: return state
  }
}
export function approvalsOf(sessionId, state) {
  return state.approvals.map((item) => ({
    key: item.id, subject: { type: 'session', ref: sessionId }, kind: 'approval', blocking: 'hard',
    title: item.reason ? `${item.toolName}: ${item.reason}` : item.toolName, openedAt: item.at, actions: ['subject.open'],
    native: { requestId: item.id, callId: item.callId ?? '', toolName: item.toolName },
  }))
}
export function questionsOf(sessionId, view) {
  return (view?.active ?? []).map((item) => ({
    key: item.callId, subject: { type: 'session', ref: sessionId },
    kind: item.questions.some((q) => q.intent?.kind === 'plan-review') ? 'plan-review' : 'question',
    blocking: 'hard', title: item.questions.map((q) => q.question).join('\n'),
    questions: structuredClone(item.questions),
    actions: ['subject.open'], native: { callId: item.callId, state: item.state },
  }))
}
export function plansOf(sessionId, state) {
  return state.plans.map((item) => {
    const detail = item.plan.length > 15000 ? `${item.plan.slice(0, 15000)}\n…` : item.plan
    return { key: item.callId, subject: { type: 'session', ref: sessionId }, kind: 'plan-review', blocking: 'hard',
      title: (item.plan.trim().split('\n')[0].replace(/^#\s+/, '') || 'Plan review').slice(0, 160),
      detail, openedAt: item.at, actions: ['subject.open'], native: { callId: item.callId, state: 'open' },
      questions: [{ id: 'plan-review', question: 'Approve this plan and leave plan mode?', detail,
        options: [{ label: 'Approve' }, { label: 'Keep planning' }], intent: { kind: 'plan-review', approve: 'Approve', callId: item.callId } }],
    }
  })
}
export const projection = { key: PROJECTION_KEY, stateVersion: 5, stateSchema, init: initialState, apply: applyEvent, wire: { viewSchema: stateSchema, view: (state) => state } }

/** Completed goals are explicitly separate from source-proven autonomous turn reviews. */
export function obligationsOf(sessionId, state, now = Date.now()) {
  const items = [], goal = state.goal
  if (goal && (goal.phase === 'blocked' || (goal.phase === 'complete' && state.review))) items.push({
    key: goal.phase === 'complete' ? `review-${state.review.seq}` : `goal-${goal.id}-${goal.revision}`, subject: { type: 'session', ref: sessionId },
    kind: goal.phase === 'blocked' ? 'goal-blocked' : 'review', blocking: 'soft',
    title: goal.objective, ...(goal.blockedReason ? { detail: goal.blockedReason.message } : {}),
    ...(goal.phase === 'complete' ? { reviewOrigin: 'goal-complete', detail: 'Goal completed; separate from autonomous turn review counts.' } : {}),
    openedAt: state.goalAt, actions: ['subject.open'],
  })
  if (state.review && goal?.phase !== 'complete') items.push({
    key: `review-${state.review.seq}`, subject: { type: 'session', ref: sessionId }, kind: 'review', blocking: 'soft',
    title: state.title || '自主运行已完成，待验收 / Autonomous turn ready for review', reviewOrigin: 'autonomous-turn',
    openedAt: state.review.at, actions: ['subject.open'],
  })
  if (state.failure && now - Date.parse(state.failure.at) < 48 * 3600_000) items.push({
    key: `failure-${state.failure.seq}`, subject: { type: 'session', ref: sessionId }, kind: 'turn-failed', blocking: 'soft',
    title: state.failure.message, openedAt: state.failure.at, actions: ['subject.open'],
  })
  return items
}
