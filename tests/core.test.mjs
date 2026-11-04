import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildView,
  compareObligations,
  kindMeta,
  normalizeObligation,
  obligationsEqual,
  LIMITS,
  reconcile,
  sortWeight,
  waited,
} from '../lib/core.js'

const at = (minutes) => new Date(Date.UTC(2026, 10, 4, 6, 0, 0) + minutes * 60_000).toISOString()

const obligation = (patch) => ({
  key: `k:${patch.kind}:${patch.title ?? 'x'}`,
  revision: 1,
  producer: 'test',
  subject: { type: 'session', ref: 's1' },
  kind: patch.kind,
  blocking: patch.blocking ?? kindMeta(patch.kind).blocking,
  title: patch.title ?? 'do the thing',
  openedAt: patch.openedAt ?? at(0),
  certainty: 'exact',
  actions: [],
  ...patch,
})

test('blocking tiers order system, then agent-blocking, then decisions', () => {
  const items = [
    obligation({ kind: 'review', title: 'review' }),
    obligation({ kind: 'question', title: 'question' }),
    obligation({ kind: 'credential', title: 'credential' }),
    obligation({ kind: 'approval', title: 'approval' }),
    obligation({ kind: 'goal-blocked', title: 'goal' }),
  ]
  const view = buildView(items, { now: at(10) })
  assert.deepEqual(view.items.map((item) => item.kind), [
    'credential',
    'approval',
    'question',
    'goal-blocked',
    'review',
  ])
  assert.deepEqual(view.groups.map((group) => group.id), ['system', 'waiting', 'decide'])
})

test('the badge counts only system and agent-blocking obligations', () => {
  const view = buildView([
    obligation({ kind: 'credential' }),
    obligation({ kind: 'approval' }),
    obligation({ kind: 'question' }),
    obligation({ kind: 'goal-blocked' }),
    obligation({ kind: 'turn-failed' }),
  ], { now: at(10) })
  assert.equal(view.badge, 3)
  assert.equal(view.total, 5)
})

test('counts equal the lists they describe', () => {
  const view = buildView([
    obligation({ kind: 'approval', title: 'a' }),
    obligation({ kind: 'question', title: 'b' }),
    obligation({ kind: 'review', title: 'c' }),
  ], { now: at(10) })
  for (const group of view.groups) {
    assert.equal(view.counts[group.id], group.items.length)
  }
})

test('deadlines come before plain age inside one kind', () => {
  const early = obligation({ kind: 'question', title: 'early', openedAt: at(0), deadline: at(5) })
  const late = obligation({ kind: 'question', title: 'late', openedAt: at(-30) })
  assert.deepEqual([early, late].sort(compareObligations).map((item) => item.title), ['early', 'late'])
})

test('the longest wait comes first without a deadline', () => {
  const older = obligation({ kind: 'approval', title: 'older', openedAt: at(-20) })
  const newer = obligation({ kind: 'approval', title: 'newer', openedAt: at(-5) })
  assert.deepEqual([newer, older].sort(compareObligations).map((item) => item.title), ['older', 'newer'])
})

test('a dismissed obligation stays hidden only for the revision it dismissed', () => {
  const item = obligation({ kind: 'question', revision: 2 })
  const hidden = buildView([item], { now: at(10), dispositions: { [item.key]: { kind: 'dismissed', revision: 2 } } })
  assert.equal(hidden.total, 0)
  const returned = buildView([item], { now: at(10), dispositions: { [item.key]: { kind: 'dismissed', revision: 1 } } })
  assert.equal(returned.total, 1)
})

test('a snoozed obligation returns when its time passes', () => {
  const item = obligation({ kind: 'review' })
  const until = at(30)
  assert.equal(buildView([item], { now: at(10), dispositions: { [item.key]: { kind: 'snoozed', revision: 1, until } } }).total, 0)
  assert.equal(buildView([item], { now: at(40), dispositions: { [item.key]: { kind: 'snoozed', revision: 1, until } } }).total, 1)
})

test('an obligation needs a key, a subject, a kind and a concrete title', () => {
  assert.equal(normalizeObligation({}, 'p').code, 'invalid-key')
  assert.equal(normalizeObligation({ key: 'a', kind: 'question', title: 'x' }, 'p').code, 'invalid-subject')
  assert.equal(normalizeObligation({ key: 'a', subject: { type: 'session', ref: 's' }, title: 'x' }, 'p').code, 'invalid-kind')
  assert.equal(normalizeObligation({ key: 'a', subject: { type: 'session', ref: 's' }, kind: 'question', title: '   ' }, 'p').code, 'invalid-title')
  assert.equal(normalizeObligation({ key: 'a', subject: { type: 'session', ref: 's' }, kind: 'question', title: 'x', blocking: 'urgent' }, 'p').code, 'invalid-blocking')
})

test('a normalized obligation carries the producer prefix and the kind default', () => {
  const result = normalizeObligation({
    key: 'q1',
    subject: { type: 'work-item', ref: 'w1' },
    kind: 'question',
    title: ' keep going? ',
    options: [{ id: 'yes', label: 'Yes', recommended: true }],
  }, 'producer-x')
  assert.equal(result.ok, true)
  assert.equal(result.obligation.key, 'producer-x:work-item:w1:q1')
  assert.equal(result.obligation.title, 'keep going?')
  assert.equal(result.obligation.blocking, 'hard')
  assert.equal(result.obligation.certainty, 'exact')
})

test('reconcile keeps revisions, bumps changed ones and withdraws disappeared ones', () => {
  const previous = [
    obligation({ key: 'p:session:s:a', kind: 'question', title: 'same', revision: 3 }),
    obligation({ key: 'p:session:s:b', kind: 'question', title: 'before', revision: 1 }),
    obligation({ key: 'p:session:s:c', kind: 'question', title: 'gone', revision: 1 }),
  ]
  const drafts = [
    obligation({ key: 'p:session:s:a', kind: 'question', title: 'same' }),
    obligation({ key: 'p:session:s:b', kind: 'question', title: 'after' }),
  ]
  const result = reconcile(previous, drafts, at(1))
  assert.equal(result.open.length, 2)
  assert.equal(result.open.find((item) => item.key.endsWith('a')).revision, 3)
  assert.equal(result.open.find((item) => item.key.endsWith('b')).revision, 2)
  assert.deepEqual(result.withdrawn.map((item) => item.key), ['p:session:s:c'])
  assert.equal(result.changed.length, 1)
})

test('sortWeight separates tiers so merged lists sort without a full comparator', () => {
  assert.ok(sortWeight({ kind: 'credential' }) < sortWeight({ kind: 'approval' }))
  assert.ok(sortWeight({ kind: 'question' }) < sortWeight({ kind: 'review' }))
})

test('waited reports whole units', () => {
  assert.deepEqual(waited(at(0), at(0.2)), { value: 0, unit: 'second' })
  assert.deepEqual(waited(at(0), at(30)), { value: 30, unit: 'minute' })
  assert.deepEqual(waited(at(0), at(60 * 5)), { value: 5, unit: 'hour' })
  assert.deepEqual(waited(at(0), at(60 * 24 * 3)), { value: 3, unit: 'day' })
})

const draft = (patch = {}) => ({ key: 'local', subject: { type: 'session', ref: 's1' }, kind: 'question', title: 'Choose a branch', openedAt: at(0), ...patch })
const normalized = (patch = {}, producer = 'test') => {
  const result = normalizeObligation(draft(patch), producer)
  assert.equal(result.ok, true, result.message)
  return result.obligation
}

test('explicit blocking drives ordering, grouping, badge and weight together', () => {
  const softApproval = obligation({ kind: 'approval', blocking: 'soft' })
  const systemReview = obligation({ kind: 'review', blocking: 'system' })
  const hardCustom = obligation({ kind: 'custom', blocking: 'hard' })
  const view = buildView([softApproval, hardCustom, systemReview])
  assert.deepEqual(view.items, [systemReview, hardCustom, softApproval])
  assert.deepEqual(view.groups.map((g) => [g.id, g.items[0]]), [['system', systemReview], ['waiting', hardCustom], ['decide', softApproval]])
  assert.equal(view.badge, 2)
  assert.ok(sortWeight(systemReview) < sortWeight(hardCustom))
  assert.ok(sortWeight(hardCustom) < sortWeight(softApproval))
})

test('partial, invalid, inherited and Map kind metadata have safe defaults', () => {
  assert.deepEqual(kindMeta('x', { x: {} }), { blocking: 'soft', rank: 9, group: 'decide' })
  assert.deepEqual(kindMeta('x', { x: { blocking: 'hard', group: 'unknown', rank: NaN } }), { blocking: 'hard', rank: 9, group: 'waiting' })
  assert.deepEqual(kindMeta('x', new Map([['x', { blocking: 'system', rank: 3 }]])), { blocking: 'system', rank: 3, group: 'system' })
  assert.equal(kindMeta('constructor').blocking, 'soft')
  assert.equal(kindMeta('x', Object.create({ x: { blocking: 'system' } })).blocking, 'soft')
  assert.equal(normalizeObligation(draft({ kind: 'custom' }), 'p', { custom: { blocking: 'hard' } }).obligation.blocking, 'hard')
})

test('keys namespace colon-bearing local ids and encode each identity segment', () => {
  const first = normalized({ key: 'notice:1' }, 'one')
  const second = normalized({ key: 'notice:1' }, 'two')
  assert.equal(first.key, 'one:session:s1:notice%3A1')
  assert.notEqual(first.key, second.key)
  assert.equal(normalizeObligation(first, 'one').obligation.key, first.key)
  assert.notEqual(normalizeObligation(first, 'two').obligation.key, first.key)
  const a = normalized({ subject: { type: 'a:b', ref: 'c' } })
  const b = normalized({ subject: { type: 'a', ref: 'b:c' } })
  assert.notEqual(a.key, b.key)
  assert.equal(normalizeObligation(draft({ key: '\ud800' }), 'p').code, 'invalid-key')
})

test('normalization deeply detaches options, actions, subject and extension payload', () => {
  const source = draft({
    options: [{ id: 'a', label: 'A', recommended: true, metadata: { score: 1 } }],
    actions: ['answer'], metadata: { tags: ['initial'] }, payload: { nested: { n: 1 } },
    defaultAction: { actionId: 'answer', input: { choice: 'a' } },
  })
  const result = normalizeObligation(source, 'p')
  assert.equal(result.ok, true)
  source.options[0].metadata.score = 2
  source.metadata.tags.push('later')
  source.subject.ref = 'changed'
  source.actions.push('open')
  source.payload.nested.n = 2
  assert.equal(result.obligation.options[0].metadata.score, 1)
  assert.deepEqual(result.obligation.metadata.tags, ['initial'])
  assert.deepEqual(result.obligation.actions, ['answer'])
  assert.equal(result.obligation.subject.ref, 's1')
  assert.equal(result.obligation.payload.nested.n, 1)
  assert.deepEqual(JSON.parse(JSON.stringify(result.obligation)), result.obligation)
  assert.equal(normalizeObligation(Object.freeze(draft()), 'p').ok, true)
})

test('lossy JSON and malicious serializers/accessors are rejected without executing code', () => {
  let executed = 0
  const getter = Object.defineProperty({}, 'danger', { enumerable: true, get() { executed++; return 1 } })
  const cycle = {}; cycle.self = cycle
  const values = [undefined, NaN, Infinity, 1n, () => 1, Symbol('x'), new Date(), new Map(), cycle, [, 1], getter, { toJSON() { executed++; return {} } }]
  for (const value of values) assert.equal(normalizeObligation(draft({ payload: value }), 'p').code, 'invalid-payload')
  assert.equal(executed, 0)
  assert.equal(normalizeObligation(draft({ payload: { [Symbol('x')]: 1 } }), 'p').code, 'invalid-payload')
  const prototypePayload = JSON.parse('{"__proto__":{"danger":true}}')
  const safe = normalized({ payload: prototypePayload })
  assert.equal(Object.prototype.danger, undefined)
  assert.equal(Object.hasOwn(safe.payload, '__proto__'), true)
})

test('dates must be real ISO timestamps; explicit offset and leap days are accepted', () => {
  for (const field of ['openedAt', 'deadline', 'updatedAt', 'expiresAt']) {
    for (const value of ['yesterday', '2026-11-04', '2026-02-30T00:00:00Z', '2026-11-04T24:00:00Z', 123]) {
      assert.equal(normalizeObligation(draft({ [field]: value }), 'p').code, 'invalid-date', `${field}: ${value}`)
    }
  }
  assert.equal(normalizeObligation(draft({ deadline: '2028-02-29T12:00:00+08:00' }), 'p').ok, true)
})

test('bounded text, identities, options and actions reject bad or oversized data', () => {
  for (const patch of [{ key: ' ' }, { title: ' ' }, { title: '界'.repeat(LIMITS.title) }, { subject: { type: '', ref: 's' } }, { kind: '' }, { detail: 'x'.repeat(LIMITS.detail + 1) }, { certainty: 'guess' }, { audience: '' }]) {
    assert.equal(normalizeObligation(draft(patch), 'p').ok, false)
  }
  for (const actions of ['open', [null], [''], ['open', 'open'], Array(LIMITS.actions + 1).fill('open')]) assert.equal(normalizeObligation(draft({ actions }), 'p').code, 'invalid-actions')
  for (const options of [{}, [null], [{ id: '', label: 'X' }], [{ id: 'x', label: '' }], [{ id: 'x', label: 'X', recommended: 'yes' }], [{ id: 'x', label: 'X' }, { id: 'x', label: 'Y' }]]) assert.equal(normalizeObligation(draft({ options }), 'p').code, 'invalid-options')
  assert.equal(normalizeObligation(draft({ payload: 'x'.repeat(LIMITS.payload) }), 'p').code, 'invalid-size')
  let nested = null
  for (let i = 0; i < LIMITS.depth + 1; i++) nested = { child: nested }
  assert.equal(normalizeObligation(draft({ payload: nested }), 'p').code, 'invalid-payload')
})

test('reconcile notices every meaningful content change, retains first opening and advances revision', () => {
  const before = normalized({ metadata: { a: 1 }, options: [{ id: 'a', label: 'A' }], actions: ['answer'] })
  before.revision = 7
  const patches = [
    { options: [{ id: 'a', label: 'Updated' }] }, { options: [] }, { actions: ['open'] },
    { subject: { type: 'work-item', ref: 'w' } }, { metadata: { a: 2 } },
    { audience: 'me' }, { certainty: 'inferred' }, { payload: { n: 1 } },
    { defaultAction: { actionId: 'answer', input: { id: 'a' } } },
  ]
  for (const patch of patches) {
    const fresh = { ...before, ...patch, openedAt: at(20), revision: 1 }
    const result = reconcile([before], [fresh], at(30))
    assert.equal(result.changed.length, 1, JSON.stringify(patch))
    assert.equal(result.open[0].revision, 8)
    assert.equal(result.open[0].openedAt, at(0))
    assert.equal(result.open[0].updatedAt, at(30))
  }
})

test('reconcile ignores metadata object key ordering and lifecycle changes, not array order', () => {
  const before = normalized({ metadata: { a: 1, b: { c: 2, d: 3 } }, actions: ['a', 'b'] })
  before.revision = 4
  const same = { ...before, openedAt: at(20), revision: 1, expiresAt: at(30), metadata: { b: { d: 3, c: 2 }, a: 1 } }
  assert.equal(obligationsEqual(before, same), true)
  const result = reconcile([before], [same], at(40))
  assert.equal(result.open[0], before)
  assert.equal(result.changed.length, 0)
  assert.equal(obligationsEqual(before, { ...same, actions: ['b', 'a'] }), false)
})

test('reconcile deduplicates incoming keys and keeps host expiry when content changes', () => {
  const before = { ...normalized(), expiresAt: at(90) }
  const result = reconcile([before], [{ ...before, title: 'one' }, { ...before, title: 'two', expiresAt: undefined }], at(1))
  assert.equal(result.open.length, 1)
  assert.equal(result.open[0].title, 'two')
  assert.equal(result.open[0].expiresAt, at(90))
  assert.equal(before.title, 'Choose a branch')
})

test('ordering is total and deterministic even with missing or invalid dates', () => {
  const items = ['c', 'a', 'b'].map((key) => obligation({ key, kind: 'custom', openedAt: 'invalid', deadline: 'invalid' }))
  const sorted = [...items].sort(compareObligations)
  assert.deepEqual(sorted.map((i) => i.key), ['a', 'b', 'c'])
  assert.deepEqual([...items].reverse().sort(compareObligations), sorted)
  for (const a of items) for (const b of items) {
    const comparison = compareObligations(a, b)
    assert.equal(Number.isNaN(comparison), false)
    assert.equal(comparison === 0 ? 0 : Math.sign(comparison), compareObligations(b, a) === 0 ? 0 : -Math.sign(compareObligations(b, a)))
  }
  assert.ok(compareObligations(obligation({ kind: 'custom', deadline: at(10) }), items[0]) < 0)
  assert.deepEqual(waited('bad', at(10)), { value: 0, unit: 'second' })
  assert.deepEqual(waited(at(10), 'bad'), { value: 0, unit: 'second' })
})
