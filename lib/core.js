/** Pure attention domain rules. No I/O or framework dependencies. */
export const KINDS = {
  credential: { blocking: 'system', rank: 0, group: 'system' },
  approval: { blocking: 'hard', rank: 0, group: 'waiting' },
  'plan-review': { blocking: 'hard', rank: 1, group: 'waiting' },
  question: { blocking: 'hard', rank: 2, group: 'waiting' },
  'goal-blocked': { blocking: 'soft', rank: 0, group: 'decide' },
  'turn-failed': { blocking: 'soft', rank: 1, group: 'decide' },
  review: { blocking: 'soft', rank: 2, group: 'decide' },
}
export const GROUPS = [
  { id: 'system', blocking: 'system' },
  { id: 'waiting', blocking: 'hard' },
  { id: 'decide', blocking: 'soft' },
]
export const BADGE_BLOCKING = new Set(['system', 'hard'])
export const SILENCEABLE_BLOCKING = new Set(['soft'])
const tiers = ['system', 'hard', 'soft']
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key)
const tier = (value) => tiers.includes(value)

/** Partial custom definitions default to soft / rank 9 and a matching group. */
export function kindMeta(kind, registry = {}) {
  const raw = own(KINDS, kind) ? KINDS[kind] : (registry instanceof Map ? registry.get(kind) : (registry && own(registry, kind) ? registry[kind] : undefined))
  const blocking = tier(raw?.blocking) ? raw.blocking : 'soft'
  return { blocking, rank: Number.isFinite(raw?.rank) && raw.rank >= 0 ? raw.rank : 9, group: GROUPS.find((g) => g.blocking === blocking).id }
}
function blockingOf(item, registry) {
  return tier(item.blocking) ? item.blocking : kindMeta(item.kind, registry).blocking
}
function timestamp(value, fallback = Infinity) {
  if (typeof value !== 'string') return fallback
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : fallback
}
function compareNumber(a, b) { return a === b ? 0 : a < b ? -1 : 1 }
function compareText(a, b) { return compareNumber(String(a ?? ''), String(b ?? '')) }

/** Explicit blocking wins over kind metadata. Invalid dates sort as absent. */
export function compareObligations(a, b, registry = {}) {
  return compareNumber(tiers.indexOf(blockingOf(a, registry)), tiers.indexOf(blockingOf(b, registry)))
    || compareNumber(kindMeta(a.kind, registry).rank, kindMeta(b.kind, registry).rank)
    || compareNumber(timestamp(a.deadline), timestamp(b.deadline))
    || compareNumber(timestamp(a.openedAt), timestamp(b.openedAt))
    || compareText(a.key, b.key)
    || compareText(a.producer, b.producer)
    || compareText(a.kind, b.kind)
    || compareText(a.title, b.title)
}

/** Coarse tier/rank weight; use compareObligations for dates and tie-breaking. */
export function sortWeight(item, registry = {}) {
  const rank = kindMeta(item.kind, registry).rank
  return tiers.indexOf(blockingOf(item, registry)) * 1000 + Math.min(rank, 99) * 10
}

export function buildView(obligations, options = {}) {
  const { now = new Date().toISOString(), registry = {}, dispositions = {}, funnel } = options
  const nowMs = timestamp(now, 0)
  const visible = obligations.filter((item) => {
    const disposition = own(dispositions, item.key) ? dispositions[item.key] : undefined
    if (!disposition || disposition.revision !== item.revision) return true
    if (disposition.kind === 'dismissed') return false
    return !(disposition.kind === 'snoozed' && timestamp(disposition.until, 0) > nowMs)
  }).sort((a, b) => compareObligations(a, b, registry))
  const groups = GROUPS.map((group) => ({ id: group.id, items: visible.filter((item) => blockingOf(item, registry) === group.blocking) })).filter((group) => group.items.length)
  return {
    groups, items: visible,
    counts: Object.fromEntries(groups.map((group) => [group.id, group.items.length])),
    total: visible.length,
    badge: visible.filter((item) => BADGE_BLOCKING.has(blockingOf(item, registry))).length,
    funnel: funnel ?? { droppedToday: 0, shownToday: visible.length },
  }
}

/** Limits are UTF-8 bytes for text/payload, item counts for lists. */
export const LIMITS = Object.freeze({ id: 1024, title: 1024, detail: 65536, payload: 131072, options: 50, actions: 50, depth: 32 })
const byteLength = (value) => new TextEncoder().encode(value).length
const text = (value, limit) => typeof value === 'string' && value.trim().length > 0 && byteLength(value) <= limit
function validDate(value) {
  if (typeof value !== 'string' || value.length > 64) return false
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.exec(value)
  if (!match || !Number.isFinite(Date.parse(value))) return false
  const [, y, m, d, hour, minute, second] = match.map(Number)
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return m >= 1 && m <= 12 && d >= 1 && d <= days[m - 1] && hour < 24 && minute < 60 && second < 60
}
/** Reject lossy JSON values, accessors, cycles and exotic objects; never invoke toJSON. */
function cloneJSON(value, ancestors = new Set(), depth = 0) {
  if (depth > LIMITS.depth) throw new Error('payload nesting is too deep')
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'object') throw new Error('payload must contain only JSON values')
  if (ancestors.has(value)) throw new Error('payload must not contain cycles')
  const array = Array.isArray(value)
  if (!array && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new Error('payload must contain plain objects')
  if (Reflect.ownKeys(value).some((key) => typeof key === 'symbol')) throw new Error('symbol keys are not JSON-safe')
  ancestors.add(value)
  const result = array ? [] : {}
  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!own(descriptor, 'value')) throw new Error('payload accessors are not supported')
    Object.defineProperty(result, key, { value: cloneJSON(descriptor.value, ancestors, depth + 1), enumerable: true, writable: true, configurable: true })
  }
  if (array && (Object.keys(value).length !== value.length || Object.keys(value).some((key, i) => key !== String(i)))) throw new Error('payload arrays must be dense without extra properties')
  ancestors.delete(value)
  return result
}
function refuse(code, message) { return { ok: false, code, message } }

/**
 * Detached, lossless JSON normalizer. Does not mutate input or freeze output (Host
 * may add expiresAt). Keys are encoded producer:type:ref:localKey. A canonical own
 * prefix is accepted unchanged for resubmission; arbitrary colons never escape
 * the producer namespace. Existing simple keys retain their previous spelling.
 * Optional third argument supplies custom kind metadata (object or Map).
 */
export function normalizeObligation(input, producer, registry = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return refuse('invalid-input', 'obligation is not an object')
  let data
  try {
    data = cloneJSON(input)
    if (byteLength(JSON.stringify(data)) > LIMITS.payload) return refuse('invalid-size', 'obligation exceeds payload size limit')
  } catch (error) { return refuse('invalid-payload', error.message) }
  const { key, subject, kind, blocking, title } = data
  if (!text(key, LIMITS.id)) return refuse('invalid-key', 'key is required and must fit the size limit')
  if (!text(producer, LIMITS.id)) return refuse('invalid-producer', 'producer is required')
  if (!subject || Array.isArray(subject) || !text(subject.type, LIMITS.id) || !text(subject.ref, LIMITS.id)) return refuse('invalid-subject', 'subject needs a nonempty type and ref')
  if (!text(kind, LIMITS.id)) return refuse('invalid-kind', 'kind is required')
  if (!text(title, LIMITS.title)) return refuse('invalid-title', 'title is required and must fit the size limit')
  if (blocking !== undefined && !tier(blocking)) return refuse('invalid-blocking', 'unknown blocking tier')
  if (data.certainty !== undefined && !['exact', 'inferred'].includes(data.certainty)) return refuse('invalid-certainty', 'unknown certainty')
  for (const field of ['openedAt', 'deadline', 'updatedAt', 'expiresAt']) {
    if (data[field] !== undefined && !validDate(data[field])) return refuse('invalid-date', `${field} must be an ISO timestamp with a time zone`)
  }
  if (data.detail !== undefined && (typeof data.detail !== 'string' || byteLength(data.detail) > LIMITS.detail)) return refuse('invalid-detail', 'detail must be bounded text')
  if (data.audience !== undefined && !text(data.audience, LIMITS.id)) return refuse('invalid-audience', 'audience must be nonempty text')
  if (data.actions !== undefined && (!Array.isArray(data.actions) || data.actions.length > LIMITS.actions || data.actions.some((a) => !text(a, LIMITS.id)) || new Set(data.actions).size !== data.actions.length)) return refuse('invalid-actions', 'actions must be a bounded list of unique nonempty ids')
  if (data.options !== undefined) {
    if (!Array.isArray(data.options) || data.options.length > LIMITS.options || data.options.some((option) => !option || Array.isArray(option) || !text(option.id, LIMITS.id) || !text(option.label, LIMITS.title) || (option.recommended !== undefined && typeof option.recommended !== 'boolean')) || new Set(data.options.map((o) => o.id)).size !== data.options.length) return refuse('invalid-options', 'options need unique ids, labels and optional boolean recommended')
  }
  if (data.defaultAction !== undefined && (!data.defaultAction || Array.isArray(data.defaultAction) || !text(data.defaultAction.actionId, LIMITS.id))) return refuse('invalid-actions', 'defaultAction needs an actionId')
  let fullKey
  try {
    const prefix = [producer, subject.type, subject.ref].map(encodeURIComponent).join(':') + ':'
    const suffix = key.slice(prefix.length)
    const canonical = key.startsWith(prefix) && suffix.length > 0 && encodeURIComponent(decodeURIComponent(suffix)) === suffix
    fullKey = canonical ? key : prefix + encodeURIComponent(key)
  } catch { return refuse('invalid-key', 'key and namespace must contain valid Unicode and URI escapes') }
  return { ok: true, obligation: {
    ...data, key: fullKey, revision: 1, producer,
    blocking: blocking ?? kindMeta(kind, registry).blocking,
    title: title.trim(), openedAt: data.openedAt ?? new Date().toISOString(),
    certainty: data.certainty ?? 'exact', actions: data.actions ?? [],
  } }
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]))
  return value
}
/** Compare every content field, including extension metadata; lifecycle fields are not content. */
export function obligationsEqual(a, b) {
  const content = (item) => Object.fromEntries(Object.entries(item).filter(([key]) => !['revision', 'openedAt', 'updatedAt', 'expiresAt'].includes(key)))
  return JSON.stringify(stable(content(a))) === JSON.stringify(stable(content(b)))
}

/** Preserve first-open time and previous revision on no-op updates. Last duplicate draft wins. */
export function reconcile(previous, drafts, at) {
  const open = [], changed = []
  const beforeByKey = new Map(previous.map((item) => [item.key, item]))
  const byKey = new Map(drafts.map((item) => [item.key, item]))
  for (const draft of byKey.values()) {
    const before = beforeByKey.get(draft.key)
    if (before === undefined) { open.push(draft); changed.push(draft); continue }
    if (obligationsEqual(before, draft)) { open.push(before); continue }
    const next = { ...draft, openedAt: before.openedAt, revision: before.revision + 1 }
    // Retain Host-managed expiry across fresh derived drafts.
    if (draft.expiresAt === undefined && before.expiresAt !== undefined) next.expiresAt = before.expiresAt
    if (validDate(at)) next.updatedAt = at
    open.push(next); changed.push(next)
  }
  return { open, changed, withdrawn: previous.filter((item) => !byKey.has(item.key)) }
}

/** Invalid or future timestamps report zero rather than NaN/negative waits. */
export function waited(openedAt, now = new Date().toISOString()) {
  const minutes = Math.floor(Math.max(0, timestamp(now, 0) - timestamp(openedAt, 0)) / 60000)
  if (!Number.isFinite(timestamp(openedAt)) || !Number.isFinite(timestamp(now)) || minutes < 1) return { value: 0, unit: 'second' }
  if (minutes < 60) return { value: minutes, unit: 'minute' }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return { value: hours, unit: 'hour' }
  return { value: Math.floor(hours / 24), unit: 'day' }
}
