import { z } from 'zod'
import { buildView, KINDS, normalizeObligation, reconcile } from './core.js'
const clone = (value) => structuredClone(value)
export const DEFAULT_SETTINGS = { reviewEnabled: true, ledgerRetentionDays: 90 }
const settingsSchema = z.object({ reviewEnabled: z.boolean(), ledgerRetentionDays: z.number().int().min(1).max(3650) }).strict()
const stateSchema = z.object({ dispositions: z.record(z.string(), z.json()), external: z.record(z.string(), z.json()), ledger: z.array(z.json()),
  settings: settingsSchema.default(DEFAULT_SETTINGS), muteRules: z.array(z.object({ scope: z.enum(['session', 'workspace']), ref: z.string().min(1) })).default([]),
  observations: z.record(z.string(), z.json()).default({}) })
const empty = () => ({ dispositions: {}, external: {}, ledger: [], settings: { ...DEFAULT_SETTINGS }, muteRules: [], observations: {} })
export async function openStore(ctx) {
  const domain = await ctx.storageDomain.open({ name: 'attention_inbox', version: 1, tables: {}, layout: 'single', global: { schema: stateSchema, initial: empty() } })
  return { data: stateSchema.parse(domain.global.get()), async commit(next) { await domain.global.set(next); this.data = next }, close: () => domain.close() }
}

/** All mutations share one serialized durability boundary. Session-derived obligations remain reconstructible. */
export class AttentionService {
  constructor(ctx, store) {
    this.ctx = ctx; this.store = store; this.apiVersion = 1
    this.producers = new Map(); this.derived = new Map(); this.subjectTypes = new Map()
    this.kinds = new Map(); this.actions = new Map(); this.channels = new Map(); this.filters = new Map()
    this.listeners = new Set(); this.queue = Promise.resolve(); this.closed = false; this.inflight = new Set()
    this.health = { backfill: 'pending', errors: 0 }
    this.producerOwners = new Map(); this.externalOwners = new Map(); this.channelStates = new Map()
    this.expiryTimer = undefined; this.scheduleExpiry()
    this.nativeAttempts = new Map(); this.nativeFacts = new Map(); this.sessionFacts = new Map(); this.clientViews = new Map(); this.suppressedReviews = new Set()
  }
  warn(error) { this.ctx.logger?.warn?.('attention-inbox', error) }
  transact(change, afterCommit) {
    const task = this.queue.then(async () => {
      if (this.closed) throw new Error('CLOSED')
      const next = clone(this.store.data), value = await change(next)
      next.settings ??= { ...DEFAULT_SETTINGS }; next.muteRules ??= []; next.observations ??= {}
      const floor = Date.now() - next.settings.ledgerRetentionDays * 86400_000
      next.ledger = next.ledger.filter((row) => Date.parse(row.closedAt) > floor)
      for (const [key, row] of Object.entries(next.observations)) if (Date.parse(row.at) < floor) delete next.observations[key]
      await this.store.commit(next)
      afterCommit?.()
      return value
    })
    this.queue = task.catch(() => {})
    return task
  }
  async shutdown() {
    this.stopping = true
    clearTimeout(this.expiryTimer)
    await Promise.all([...this.channelStates.values()].map((state) => state.release()))
    await this.queue; this.closed = true; this.emitChange(); this.listeners.clear(); await this.store.close?.()
  }
  ownerOf(producer) { return this.producerOwners.get(producer) ?? producer }
  assertBudget(owner, external = this.store.data.external, replacementScope, replacement = [], externalKey) {
    const keys = new Set(Object.values(external).filter((item) => item.key === externalKey || (this.externalOwners.get(item.key) ?? this.ownerOf(item.producer)) === owner).map((item) => item.key))
    for (const [scope, items] of this.derived) if (scope !== replacementScope) for (const item of items) if (this.ownerOf(item.producer) === owner) keys.add(item.key)
    for (const item of replacement) keys.add(item.key)
    if (keys.size > 50) { const error = new Error('PRODUCER_LIMIT'); this.warn(error); throw error }
  }
  async withdrawProducer(id, owner = this.ownerOf(id)) {
    for (const item of Object.values(this.store.data.external)) if (item.producer === id && (this.externalOwners.get(item.key) ?? this.ownerOf(id)) === owner) await this.withdraw(item.key)
  }
  scheduleExpiry() {
    clearTimeout(this.expiryTimer)
    if (this.closed || this.stopping) return
    const times = Object.values(this.store.data.external).map((item) => Date.parse(item.expiresAt)).filter(Number.isFinite)
    if (!times.length) return
    this.expiryTimer = setTimeout(() => { void this.expireExternal().catch((error) => this.warn(error)) }, Math.min(2147483647, Math.max(0, Math.min(...times) - Date.now())))
    this.expiryTimer.unref?.()
  }
  expireExternal() {
    const due = Object.values(this.store.data.external).some((item) => Date.parse(item.expiresAt) <= Date.now())
    if (this.closed) return Promise.resolve()
    if (!due) { this.scheduleExpiry(); return Promise.resolve() }
    const expired = []
    return this.transact((state) => {
      for (const item of Object.values(state.external)) if (Date.parse(item.expiresAt) <= Date.now()) {
        delete state.external[item.key]; this.record(state, item, 'expired', 'fact'); expired.push(item)
      }
      return expired
    }, () => { for (const item of expired) this.externalOwners.delete(item.key) }).then((items) => { items.forEach((item) => this.announce('closed', item, 'expired')); this.scheduleExpiry(); if (items.length) this.emitChange() })
  }
  register(map, key, value) {
    if (typeof key !== 'string' || !key || map.has(key)) throw new Error('DUPLICATE_OR_INVALID_REGISTRATION')
    map.set(key, value)
    return () => { if (map.get(key) === value) map.delete(key) }
  }
  registerProducer(def, owner = def.id) {
    if (typeof def?.derive !== 'function' || !def.subjectType) throw new Error('INVALID_PRODUCER')
    const release = this.register(this.producers, def.id, def)
    this.producerOwners.set(def.id, owner)
    let released = false
    return async () => {
      if (released) return
      released = true; release()
      for (const [scope, items] of this.derived) if (scope.startsWith(`${def.id}\0`)) {
        this.derived.delete(scope); items.forEach((item) => this.closedItem(item, 'withdrawn'))
      }
      await this.withdrawProducer(def.id, owner)
      if (!this.producers.has(def.id) && this.producerOwners.get(def.id) === owner) this.producerOwners.delete(def.id)
      await this.queue; this.emitChange()
    }
  }
  registerSubjectType(def) { return this.register(this.subjectTypes, def.type, def) }
  registerKind(def) {
    if (!['hard', 'soft', 'system'].includes(def.blocking)) throw new Error('INVALID_KIND')
    return this.register(this.kinds, def.id, def)
  }
  registerAction(def) {
    if (!['host', 'client'].includes(def.side) || (def.side === 'host' && typeof def.run !== 'function')) throw new Error('HOST_ACTION_REQUIRED')
    return this.register(this.actions, def.id, def)
  }
  registerChannel(def) {
    if (typeof def.deliver !== 'function') throw new Error('INVALID_CHANNEL')
    const unregister = this.register(this.channels, def.id, def)
    const state = { def, active: true, jobs: new Map(), tasks: new Set() }
    state.release = async () => {
      state.active = false; unregister()
      if (this.channelStates.get(def.id) === state) this.channelStates.delete(def.id)
      for (const job of state.jobs.values()) this.stopDelivery(job)
      await Promise.allSettled([...state.tasks])
      state.jobs.clear()
    }
    this.channelStates.set(def.id, state)
    return state.release
  }
  stopDelivery(job) {
    job.stopped = true; clearTimeout(job.timer); job.abort.abort()
  }
  channelTask(state, task) {
    state.tasks.add(task)
    void task.finally(() => state.tasks.delete(task)).catch(() => {})
    return task
  }
  deliverChannel(state, item) {
    const prior = state.jobs.get(item.key)
    if (prior?.revision === item.revision && !prior.closing) return
    if (prior) this.stopDelivery(prior)
    const job = { revision: item.revision, item: clone(item), abort: new AbortController(), attempts: 0, stopped: false }
    state.jobs.set(item.key, job)
    const attempt = () => {
      if (!state.active || job.stopped || this.closed) return
      job.task = this.channelTask(state, Promise.resolve().then(() => {
        if (!state.active || job.stopped) return
        return state.def.deliver(clone(job.item), job.abort.signal)
      }).catch((error) => {
        if (!state.active || job.stopped) return
        this.warn(error)
        const delay = Math.min(60000, 1000 * 2 ** Math.min(job.attempts++, 6))
        job.timer = setTimeout(attempt, delay); job.timer.unref?.()
      }))
    }
    attempt()
  }
  closeChannel(state, item, resolution) {
    const job = state.jobs.get(item.key)
    if (job?.closing) return
    if (job) { job.closing = true; this.stopDelivery(job) }
    if (!state.def.retract) return
    this.channelTask(state, Promise.resolve(job?.task).then(() => {
      if (state.active) return state.def.retract(clone(item), resolution)
    }).catch((error) => this.warn(error)))
  }
  registerFilter(def) { if (typeof def.apply !== 'function') throw new Error('INVALID_FILTER'); return this.register(this.filters, def.id, def) }
  invalidate(id, ref) {
    const producer = this.producers.get(id)
    if (!producer) return
    this.invalidateDerived(id, ref, producer.derive(ref).map((draft) => ({ ...draft, subject: { type: producer.subjectType, ref } })))
  }
  getSettings() { return clone(this.store.data.settings ?? DEFAULT_SETTINGS) }
  async updateSettings(patch) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('INVALID_SETTINGS')
    await this.transact((state) => {
      const parsed = settingsSchema.safeParse({ ...(state.settings ?? DEFAULT_SETTINGS), ...patch })
      if (!parsed.success) throw new Error('INVALID_SETTINGS')
      state.settings = parsed.data
    }); this.emitChange(); return this.getSettings()
  }
  async mute(scope, ref, remove = false) {
    if (!['session', 'workspace'].includes(scope) || typeof ref !== 'string' || !ref.trim()) throw new Error('INVALID_MUTE')
    if (!remove && (scope === 'session' ? !this.sessionFacts.has(ref) : !this.workspaceRegistry?.get(ref))) throw new Error('UNKNOWN_MUTE_TARGET')
    await this.transact((state) => {
      state.muteRules = (state.muteRules ?? []).filter((rule) => rule.scope !== scope || rule.ref !== ref)
      if (!remove) state.muteRules.push({ scope, ref })
    }); this.emitChange()
  }
  observeSession(header) { this.sessionFacts.set(header.id, header) }
  suppressVisibleReview(ref, item) {
    const id = `visible-review:${item.key}`
    if (this.isSessionVisible(ref)) {
      this.suppressedReviews.add(`${ref}:${id}`)
      this.observeCounts(ref, { [id]: { at: item.openedAt, layer: 'visible-review', count: 1 } })
    }
    return this.suppressedReviews.has(`${ref}:${id}`) || Boolean(this.store.data.observations?.[`${ref}:${id}`])
  }
  isSessionVisible(ref) {
    for (const [id, row] of this.clientViews) if (row.at < Date.now() - 15000) this.clientViews.delete(id)
    return [...this.clientViews.values()].some((row) => row.ids.includes(ref))
  }
  observeCounts(ref, counts) {
    const entries = Object.entries(counts ?? {}).filter(([, row]) => Date.parse(row.at) > Date.now() - this.getSettings().ledgerRetentionDays * 86400_000)
    if (!entries.some(([key, row]) => { const old = this.store.data.observations?.[`${ref}:${key}`]; return !old || old.count !== row.count || old.layer !== row.layer })) return
    void this.transact((state) => {
      state.observations ??= {}
      for (const [key, row] of entries) {
        const id = `${ref}:${key}`, old = state.observations[id]
        if (!old || old.count !== row.count || old.layer !== row.layer) state.observations[id] = { ...row, at: old?.at ?? row.at }
      }
    }).then(() => this.emitChange()).catch((error) => this.warn(error))
  }
  nativeIdentity(item) { return `${item.subject.ref}\u0000${item.kind}\u0000${item.native?.requestId ?? item.native?.callId ?? ''}` }
  async nativeAction(body) {
    if (!['attempt', 'accepted', 'failed'].includes(body.phase) || !['approval.allow-once', 'approval.reject', 'question.answer', 'plan.approve', 'plan-review.approve'].includes(body.actionId)) throw new Error('INVALID_NATIVE_ACTION')
    const item = this.find(body.key) ?? this.raw().find((o) => o.subject.ref === body.sessionId && (!body.kind || o.kind === body.kind) && (o.kind === 'approval' && body.requestId ? o.native?.requestId === body.requestId : body.callId && o.native?.callId === body.callId))
    const identity = item ? this.nativeIdentity(item) : [...this.nativeAttempts].find(([, attempt]) => (attempt.key === body.key || attempt.clientKey === body.key) && (attempt.revision === body.revision || attempt.clientRevision === body.revision))?.[0] ?? `${body.sessionId}\u0000${body.kind}\u0000${body.kind === 'approval' ? body.requestId ?? body.callId ?? '' : body.callId ?? body.requestId ?? ''}`
    const prior = this.nativeAttempts.get(identity)
    if (body.phase === 'attempt') {
      if (!item || (body.key === item.key && item.revision !== body.revision)) throw new Error('STALE')
      this.nativeAttempts.set(identity, { key: item.key, revision: item.revision, clientKey: body.key, clientRevision: body.revision, actionId: body.actionId, accepted: false }); return
    }
    if (!prior || prior.actionId !== body.actionId) throw new Error('NO_NATIVE_ATTEMPT')
    if (body.phase === 'failed') { this.nativeAttempts.delete(identity); return }
    prior.accepted = true
    await this.transact((state) => { for (const row of state.ledger) if (row.key === prior.key && row.revision === prior.revision && row.resolution === 'acted' && row.nativeConfirmed) row.via = 'inbox' })
    this.emitChange()
  }
  confirmNative(ref, kind, nativeId) {
    const identity = `${ref}\u0000${kind}\u0000${nativeId}`
    if (this.nativeFacts.has(identity)) return
    this.nativeFacts.set(identity, true)
  }
  invalidateDerived(id, ref, drafts) {
    if (this.closed) return
    const normalized = drafts.map((draft) => {
      const result = normalizeObligation(draft, id, Object.fromEntries(this.kinds))
      if (!result.ok) throw new Error(result.message)
      return result.obligation
    })
    const scope = `${id}\0${ref}`, previous = this.derived.get(scope) ?? []
    const result = reconcile(previous, normalized, new Date().toISOString())
    this.assertBudget(this.ownerOf(id), this.store.data.external, scope, result.open)
    this.derived.set(scope, result.open)
    if (result.changed.length || normalized.length > new Set(normalized.map((item) => item.key)).size) this.observeCounts(ref, Object.fromEntries([
      ...result.changed.map((item) => [`shown:${item.key}:${item.revision}`, { at: item.openedAt, layer: 'shown', count: 1 }]),
      ...(normalized.length > result.open.length ? [[`merge:${id}`, { at: new Date().toISOString(), layer: 'l2', count: normalized.length - result.open.length }]] : []),
    ]))
    result.changed.forEach((item) => this.announce(previous.some((before) => before.key === item.key) ? 'updated' : 'opened', item))
    result.withdrawn.forEach((item) => this.closedItem(item, 'withdrawn'))
    this.emitChange()
  }
  async raise(input, producer = input?.producer ?? 'external', owner = this.ownerOf(producer)) {
    const parsed = normalizeObligation(input, producer, Object.fromEntries(this.kinds))
    if (!parsed.ok) throw new Error(parsed.message)
    let before, next
    await this.transact((state) => {
      before = state.external[parsed.obligation.key]
      this.assertBudget(owner, { ...state.external, [parsed.obligation.key]: parsed.obligation }, undefined, [], parsed.obligation.key)
      next = reconcile(before ? [before] : [], [parsed.obligation], new Date().toISOString()).open[0]
      next = { ...next, expiresAt: new Date(Date.now() + 30 * 86400_000).toISOString() }
      state.external[next.key] = next
      if (!before || before.revision !== next.revision) {
        state.observations ??= {}
        state.observations[`shown:${next.key}:${next.revision}`] = { at: new Date().toISOString(), layer: 'shown', count: 1 }
      }
    }, () => this.externalOwners.set(next.key, owner))
    this.scheduleExpiry()
    if (!before || before.revision !== next.revision) this.announce(before ? 'updated' : 'opened', next)
    this.emitChange(); return clone(next)
  }
  async withdraw(key, resolution = 'withdrawn') {
    if (!['withdrawn', 'expired', 'superseded', 'acted'].includes(resolution)) throw new Error('INVALID_RESOLUTION')
    let item
    await this.transact((state) => { item = state.external[key]; if (item) { delete state.external[key]; this.record(state, item, resolution, 'fact') } }, () => { if (item) this.externalOwners.delete(key) })
    if (item) this.announce('closed', item, resolution)
    this.scheduleExpiry(); this.emitChange()
  }
  raw() { return [...this.derived.values()].flat().concat(Object.values(this.store.data.external)) }
  find(key) { return this.raw().find((item) => item.key === key) }
  list(query = {}) {
    void this.expireExternal().catch((error) => this.warn(error))
    const items = this.raw().filter((item) => {
      if (item.expiresAt && Date.parse(item.expiresAt) <= Date.now()) return false
      if (query.kinds && !query.kinds.includes(item.kind)) return false
      if (query.subjectType && query.subjectType !== item.subject.type) return false
      if (item.blocking === 'soft') {
        if (item.kind === 'review' && !this.getSettings().reviewEnabled) return false
        const workspace = this.workspaceRegistry?.list().find((w) => w.sessionIds.includes(item.subject.ref))?.id
        if ((this.store.data.muteRules ?? []).some((rule) => rule.scope === 'session' ? item.subject.type === 'session' && rule.ref === item.subject.ref : item.subject.type === 'session' && rule.ref === workspace)) return false
      }
      return item.blocking !== 'soft' || [...this.filters.values()].every((filter) => {
        try { return filter.apply(clone(item), { now: new Date().toISOString() }) !== 'drop' }
        catch (error) { this.warn(error); return true }
      })
    })
    const dispositions = query.includeSnoozed ? Object.fromEntries(Object.entries(this.store.data.dispositions).filter(([, row]) => row.kind !== 'snoozed')) : this.store.data.dispositions
    return clone(buildView(items, { registry: Object.fromEntries(this.kinds), dispositions }).items)
  }
  record(state, item, resolution, via) {
    if (state.ledger.some((row) => row.key === item.key && row.revision === item.revision)) return
    const identity = this.nativeIdentity(item), nativeConfirmed = this.nativeFacts.has(identity)
    if (nativeConfirmed) { resolution = 'acted'; via = this.nativeAttempts.get(identity)?.accepted ? 'inbox' : 'fact' }
    state.ledger.push({ key: item.key, revision: item.revision, kind: item.kind, blocking: item.blocking,
      producer: item.producer, subject: item.subject, openedAt: item.openedAt,
      closedAt: new Date().toISOString(), resolution, via, nativeConfirmed })
  }
  closedItem(item, resolution) {
    if (this.nativeFacts.has(this.nativeIdentity(item))) resolution = 'acted'
    void this.transact((state) => this.record(state, item, resolution, 'fact')).catch((error) => this.warn(error))
    this.announce('closed', item, resolution)
  }
  async dispose(key, revision, disposition) {
    const item = this.find(key)
    if (!item || item.revision !== revision) throw new Error('STALE')
    if (item.blocking !== 'soft') throw new Error('BLOCKER_CANNOT_BE_HIDDEN')
    if (!['dismissed', 'snoozed'].includes(disposition.kind)) throw new Error('INVALID_DISPOSITION')
    if (disposition.kind === 'snoozed' && !(Date.parse(disposition.until) > Date.now())) throw new Error('INVALID_SNOOZE_TIME')
    await this.transact((state) => {
      const current = this.find(key)
      if (!current || current.revision !== revision) throw new Error('STALE')
      const before = state.dispositions[key]
      if (before?.revision === revision && before.kind === disposition.kind && before.until === disposition.until) return
      state.dispositions[key] = { ...disposition, revision }
      if (disposition.kind === 'dismissed') this.record(state, item, 'dismissed', 'inbox')
    })
    this.emitChange()
  }
  async act(key, revision, actionId, input, via = 'inbox', signal) {
    const item = this.find(key), action = this.actions.get(actionId)
    if (!item || item.revision !== revision) throw new Error('STALE')
    if (!item.actions.includes(actionId) || !action) throw new Error('ACTION_NOT_AVAILABLE')
    if (action.side !== 'host') throw new Error('HOST_ACTION_REQUIRED')
    signal ??= new AbortController().signal
    if (this.inflight.has(key)) throw new Error('ACTION_IN_PROGRESS')
    this.inflight.add(key)
    try { await action.run(clone(item), input, signal); return { accepted: true } }
    finally { this.inflight.delete(key) }
  }
  announce(type, item, resolution) {
    try { this.ctx.emit?.(`attention/${type}`, type === 'closed' ? { obligation: clone(item), resolution } : clone(item)) } catch (error) { this.warn(error) }
    for (const state of this.channelStates.values()) {
      if (type === 'closed' && state.jobs.has(item.key)) { this.closeChannel(state, item, resolution); continue }
      let selected
      try { selected = state.def.select ? state.def.select(clone(item)) : item.blocking !== 'soft' }
      catch (error) { this.warn(error); continue }
      if (!selected) {
        const prior = state.jobs.get(item.key)
        if (prior && prior.revision !== item.revision) this.stopDelivery(prior)
        continue
      }
      if (type === 'closed') this.closeChannel(state, item, resolution)
      else this.deliverChannel(state, item)
    }
  }
  emitChange() { for (const listener of this.listeners) listener() }
  async *watch(signal) {
    let wake
    const notify = () => wake?.()
    this.listeners.add(notify); signal?.addEventListener('abort', notify)
    try {
      while (!this.closed && !signal?.aborted) {
        const changed = new Promise((resolve) => { wake = resolve })
        yield this.snapshot(); await changed
      }
    } finally { this.listeners.delete(notify); signal?.removeEventListener('abort', notify) }
  }
  snapshot() {
    const kinds = { ...KINDS, ...Object.fromEntries(this.kinds) }
    const view = buildView(this.list(), { registry: kinds }), subjects = {}
    for (const item of view.items) {
      const def = this.subjectTypes.get(item.subject.type)
      const workspace = item.subject.type === 'session' ? this.workspaceRegistry?.list().find((w) => w.sessionIds.includes(item.subject.ref)) : undefined
      if (!def && !workspace) continue
      try { const desc = def?.describe?.(item.subject.ref) ?? {}; const open = def?.open?.(item.subject.ref); subjects[item.key] = { ...desc, ...(workspace ? { workspace: { id: workspace.id, title: workspace.title } } : {}), ...(open ? { open } : {}) } } catch (error) { this.warn(error) }
    }
    const rows = this.store.data.ledger
    const hard = rows.filter((row) => row.blocking === 'hard' && row.resolution === 'acted' && row.nativeConfirmed)
    const times = hard.map((row) => Math.max(0, Date.parse(row.closedAt) - Date.parse(row.openedAt))).filter(Number.isFinite).sort((a,b) => a-b)
    const median = times.length ? (times[Math.floor((times.length - 1) / 2)] + times[Math.floor(times.length / 2)]) / 2 : null
    const inboxHardActed = hard.filter((row) => row.via === 'inbox').length
    const sources = {}
    for (const row of rows) {
      const source = row.producer ?? 'unknown', key = `${source}:${row.kind}`
      const metric = sources[key] ??= { source, kind: row.kind, closed: 0, dismissed: 0 }
      metric.closed++; if (row.resolution === 'dismissed') metric.dismissed++
    }
    const noiseBySource = Object.values(sources).map((row) => ({ ...row, noiseRate: row.dismissed / row.closed, suggestRuleChange: row.closed >= 5 && row.dismissed / row.closed > 0.2 }))
    const today = new Date().toISOString().slice(0, 10)
    const observations = Object.values(this.store.data.observations ?? {}).filter((row) => row.at?.slice(0, 10) === today)
    const count = (layer) => observations.filter((row) => row.layer === layer).reduce((sum, row) => sum + row.count, 0)
    const funnel = { l1DroppedToday: count('l1'), l2DroppedToday: count('l2'), shownToday: count('shown') }
    funnel.droppedToday = funnel.l1DroppedToday + funnel.l2DroppedToday
    const autonomousTurns = observations.filter((row) => row.layer === 'autonomous').reduce((sum, row) => sum + row.count, 0)
    return { ok: true, apiVersion: 1, ...view, dispositions: clone(this.store.data.dispositions), kinds,
      actions: Object.fromEntries([...this.actions].map(([id, def]) => [id, { label: def.label ?? id, side: def.side, confirm: def.confirm ?? 'none' }])),
      subjects, settings: this.getSettings(), muteRules: clone(this.store.data.muteRules ?? []), funnel, health: { ...this.health }, metrics: {
        resolved: rows.filter((row) => row.resolution === 'acted').length, dismissed: rows.filter((row) => row.resolution === 'dismissed').length,
        medianResponseMs: median, hardResponseMedianMs: median, hardActed: hard.length, inboxHardActed,
        hardInPlaceRate: hard.length ? inboxHardActed / hard.length : null, noiseBySource, autonomousTurns,
        goalCompleteReviews: this.raw().filter((item) => item.reviewOrigin === 'goal-complete').length } }
  }
  async handleRoute(request) {
    try {
      const text = await request.text()
      if (text.length > 64 * 1024) return Response.json({ ok: false, code: 'TOO_LARGE' }, { status: 413 })
      const body = JSON.parse(text)
      switch (body.op) {
        case 'state': return Response.json(this.snapshot(), { headers: { 'cache-control': 'no-store' } })
        case 'settings': if (body.patch) await this.updateSettings(body.patch); return Response.json({ ok: true, settings: this.getSettings() })
        case 'settings-update': return Response.json({ ok: true, settings: await this.updateSettings(body.settings ?? body.patch) })
        case 'mute': await this.mute(body.scope, body.ref); break
        case 'unmute': await this.mute(body.scope, body.ref, true); break
        case 'native-action': await this.nativeAction({ ...body, requestId: body.requestId ?? body.nativeKey }); break
        case 'telemetry': {
          if (!Array.isArray(body.visibleSessionIds) || body.visibleSessionIds.length > 100 || body.visibleSessionIds.some((id) => typeof id !== 'string')) throw new Error('INVALID_SESSIONS')
          if (body.clientId !== undefined && (typeof body.clientId !== 'string' || !body.clientId || body.clientId.length > 200)) throw new Error('INVALID_CLIENT')
          this.clientViews.set(body.clientId ?? 'legacy', { at: Date.now(), ids: body.visibleSessionIds }); break
        }
        case 'dispose': await this.dispose(body.key, body.revision, { kind: body.kind, ...(body.until ? { until: body.until } : {}) }); break
        case 'act': return Response.json({ ok: true, ...await this.act(body.key, body.revision, body.actionId, body.input, 'inbox', request.signal) })
        case 'viewed': {
          if (!Array.isArray(body.sessionIds) || body.sessionIds.length > 100) throw new Error('INVALID_SESSIONS')
          await this.transact((state) => {
            for (const item of this.list()) if (item.kind === 'review' && item.subject.type === 'session' && body.sessionIds.includes(item.subject.ref)) {
              state.dispositions[item.key] = { kind: 'dismissed', revision: item.revision }
              this.record(state, item, 'acted', 'inbox')
            }
          })
          this.emitChange()
          break
        }
        default: return Response.json({ ok: false, code: 'UNKNOWN_OPERATION' }, { status: 400 })
      }
      return Response.json({ ok: true })
    } catch (error) {
      return Response.json({ ok: false, code: error instanceof SyntaxError ? 'BAD_JSON' : String(error.message) }, { status: error instanceof SyntaxError ? 400 : 409 })
    }
  }
}
