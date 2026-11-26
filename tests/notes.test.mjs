import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NotesService, openNotesStore, MAX_NOTES, parseNextSteps } from '../lib/notes.js'
import { parseHints, plan, tasksOf, addDays } from '../lib/schedule.js'

const TODAY = '2026-11-25' // a Wednesday
const fixture = (data, options = {}) => {
  const store = { data: data ?? { notes: {}, settings: undefined }, fail: false,
    async commit(next) { if (this.fail) throw new Error('DISK_FULL'); this.data = structuredClone(next) }, async close() {} }
  let clock = Date.parse('2026-11-25T09:00:00Z')
  const service = new NotesService(store, { now: () => new Date(clock += 1000), workspaces: () => [{ id: 'w1', title: 'dsh', path: '/p', sessionIds: [] }, { id: 'w2', title: 'old', archived: true }], ...options })
  service.setClock = (value) => { clock = value }
  return { service, store }
}
const call = async (service, body) => (await service.handleRoute(new Request('http://localhost/api/attention-notes', { method: 'POST', body: JSON.stringify({ today: TODAY, ...body }) }))).json()
const note = (id, patch = {}) => ({ id, day: TODAY, parentId: null, order: 1, text: id, kind: 'note', state: 'open', createdAt: '2026-11-25T00:00:00Z', updatedAt: '2026-11-25T00:00:00Z', ...patch })

test('parses dates, deadlines, estimates and priority relative to today', () => {
  assert.deepEqual(parseHints('明天 写周报 ~2h !!', TODAY), { date: '2026-11-26', estimateMin: 120, priority: 2 })
  assert.deepEqual(parseHints('周五前 提交 PR 45m', TODAY), { deadline: '2026-11-27', estimateMin: 45 })
  assert.equal(parseHints('下周一 复盘', TODAY).date, '2026-11-30')
  assert.equal(parseHints('周一 复盘', TODAY).date, '2026-11-30')
  assert.equal(parseHints('fix tests by fri', TODAY).deadline, '2026-11-27')
  assert.equal(parseHints('review 12月3日', TODAY).date, '2026-12-03')
  assert.equal(parseHints('ship @2027-01-05', TODAY).date, '2027-01-05')
  assert.equal(parseHints('kickoff 1/4', TODAY).date, '2027-01-04', 'a month-day far in the past rolls to next year')
  assert.equal(parseHints('半小时 整理笔记', TODAY).estimateMin, 30)
  assert.equal(parseHints('紧急 修线上 bug', TODAY).priority, 2)
  assert.deepEqual(parseHints('version 2.0 release notes', TODAY), {})
  assert.deepEqual(parseHints('', TODAY), {})
})

test('tasks are unfinished leaves or linked notes, never nested inside another task', () => {
  const notes = [
    note('header', { text: 'Today 相关' }), note('a', { parentId: 'header', order: 1 }), note('b', { parentId: 'header', order: 2, state: 'done' }),
    note('linked', { order: 2, sessionId: 's1' }), note('detail', { parentId: 'linked' }), note('blank', { order: 3, text: '  ' }),
  ]
  assert.deepEqual(tasksOf(notes).map((n) => n.id), ['a', 'linked'])
})

test('planner fills capacity in order, honours deadlines, fixed dates, pins and rolls overdue work forward', () => {
  const notes = [
    note('big', { text: 'refactor ~3h', createdAt: '1' }),
    note('urgent', { text: 'hotfix !! 2h', createdAt: '2' }),
    note('due', { text: '周四前 写文档 1h', createdAt: '3' }),
    note('fixed', { text: '后天 开会 1h' }),
    note('pinned', { text: 'pinned', plan: { date: '2026-11-29', estimateMin: 60 } }),
    note('parked', { text: 'parked', plan: { date: 'later' } }),
    note('overdue', { text: 'overdue', plan: { date: '2026-11-20' } }),
  ]
  const result = plan(notes, { today: TODAY, capacityMin: 240, horizonDays: 7 })
  const where = Object.fromEntries([...result.days.flatMap((d) => d.items.map((i) => [i.id, d.date])), ...result.later.map((i) => [i.id, 'later'])])
  assert.equal(where.due, TODAY, 'deadline work is placed first')
  assert.equal(where.urgent, TODAY)
  assert.equal(where.big, '2026-11-26', 'no room today, flows to tomorrow')
  assert.equal(where.fixed, '2026-11-27')
  assert.equal(where.pinned, '2026-11-29')
  assert.equal(where.parked, 'later')
  assert.equal(where.overdue, TODAY)
  const today = result.days[0]
  assert.equal(today.items.find((i) => i.id === 'overdue').rolledFrom, '2026-11-20')
  assert.equal(today.usedMin, 60 + 120 + 30)
  assert.equal(today.items[0].id, 'urgent', 'priority sorts first within a day')
})

test('planner overbooks a deadline day rather than missing it, and spills undated work to later', () => {
  const notes = Array.from({ length: 4 }, (_, i) => note(`d${i}`, { text: `明天前 task ${i} 2h`, createdAt: String(i) }))
  notes.push(note('free', { text: 'someday 8h' }))
  const result = plan(notes, { today: TODAY, capacityMin: 240, horizonDays: 3 })
  assert.equal(result.days[0].items.length, 2)
  assert.equal(result.days[1].items.length, 2)
  assert.equal(result.days[2].items.length, 0)
  assert.deepEqual(result.later.map((i) => i.id), ['free'], 'work larger than any day goes to later')
  const tight = plan(notes.slice(0, 4), { today: TODAY, capacityMin: 120, horizonDays: 3 })
  assert.ok(tight.days[1].overbooked)
  assert.ok(tight.days[1].items.some((i) => i.overbooked))
})

test('skipWeekends leaves weekend days empty except today', () => {
  const notes = Array.from({ length: 12 }, (_, i) => note(`n${i}`, { text: `task ${i} 2h`, createdAt: String(i) }))
  const result = plan(notes, { today: TODAY, capacityMin: 240, horizonDays: 7, skipWeekends: true })
  for (const day of result.days.slice(1)) if (day.weekend) assert.equal(day.items.length, 0, day.date)
  assert.equal(addDays(TODAY, 3), '2026-11-28')
})

test('notes route: create, edit, indent, link, schedule, delete subtree, settings', async () => {
  const { service } = fixture()
  let state = await call(service, { op: 'upsert', note: { id: 'n1', text: '想法 A' } })
  assert.equal(state.ok, true)
  assert.equal(state.notes[0].day, TODAY)
  assert.deepEqual(state.workspaces, [{ id: 'w1', title: 'dsh', path: '/p' }])
  state = await call(service, { op: 'upsert', note: { id: 'n2', text: '细节', parentId: 'n1' } })
  assert.equal(state.notes.find((n) => n.id === 'n2').parentId, 'n1')
  const cycle = await call(service, { op: 'upsert', note: { id: 'n1', parentId: 'n2' } })
  assert.equal(cycle.code, 'CYCLE')
  state = await call(service, { op: 'link', id: 'n1', sessionId: 'session-1', mode: 'explore' })
  assert.equal(state.notes.find((n) => n.id === 'n1').sessionId, 'session-1')
  assert.deepEqual(state.timeline.days[0].items.map((i) => i.id), ['n1'], 'a linked note is one task with its details')
  state = await call(service, { op: 'upsert', note: { id: 'n1', plan: { date: '2026-11-27' } } })
  assert.equal(state.timeline.days[2].items[0].id, 'n1')
  state = await call(service, { op: 'upsert', note: { id: 'n1', plan: null } })
  assert.equal(state.notes.find((n) => n.id === 'n1').plan, undefined)
  state = await call(service, { op: 'upsert', note: { id: 'n1', state: 'done' } })
  assert.ok(state.notes.find((n) => n.id === 'n1').closedAt)
  assert.equal(state.timeline.days[0].items.length, 0)
  state = await call(service, { op: 'unlink', id: 'n1' })
  assert.equal(state.notes.find((n) => n.id === 'n1').sessionId, undefined)
  state = await call(service, { op: 'upsert', note: { id: 'n1', day: '2026-11-24' } })
  assert.ok(state.notes.every((n) => n.day === '2026-11-24'), 'children follow their root to another day')
  state = await call(service, { op: 'delete', id: 'n1' })
  assert.equal(state.notes.length, 0)
  state = await call(service, { op: 'settings', patch: { capacityMin: 120, skipWeekends: true } })
  assert.equal(state.settings.capacityMin, 120)
  assert.equal((await call(service, { op: 'settings', patch: { capacityMin: 5 } })).code, 'INVALID_INPUT')
  assert.equal((await call(service, { op: 'upsert', note: { id: 'x', parentId: 'missing' } })).code, 'UNKNOWN_PARENT')
  assert.equal((await call(service, { op: 'upsert', note: { id: '../bad' } })).code, 'INVALID_INPUT')
  assert.equal((await call(service, { op: 'nope' })).code, 'UNKNOWN_OPERATION')
})

test('failed persistence does not change notes; capacity is bounded', async () => {
  const { service, store } = fixture()
  store.fail = true
  await assert.rejects(service.upsert({ id: 'a', text: 'x' }, TODAY), /DISK_FULL/)
  assert.equal(service.list().length, 0)
  store.fail = false
  store.data.notes = Object.fromEntries(Array.from({ length: MAX_NOTES }, (_, i) => [`n${i}`, note(`n${i}`)]))
  await assert.rejects(service.upsert({ id: 'one-more', text: 'x' }, TODAY), /NOTES_FULL/)
  await service.upsert({ id: 'n1', text: 'edits still work' }, TODAY)
})

test('notes store opens its own domain and validates persisted data', async () => {
  let spec, saved
  const store = await openNotesStore({ storageDomain: { async open(value) { spec = value; saved = structuredClone(value.global.initial); return { global: { get: () => saved, set: async (next) => { saved = next } }, async close() {} } } } })
  assert.equal(spec.name, 'attention_notes')
  assert.deepEqual(store.data.notes, {})
  assert.equal(store.data.settings.capacityMin, 240)
})

test('two lanes: agent work costs only review time and a dispatch slot; in-flight work stays on today', () => {
  const notes = [
    note('mine', { text: 'write report 3h', createdAt: '1' }),
    note('a1', { text: 'agent one 4h', createdAt: '2', plan: { lane: 'agent' } }),
    note('a2', { text: 'agent two', createdAt: '3', plan: { lane: 'agent' } }),
    note('a3', { text: 'agent three', createdAt: '4', plan: { lane: 'agent' } }),
    note('flying', { text: 'running already', sessionId: 's1', day: '2026-11-20' }),
  ]
  const result = plan(notes, { today: TODAY, capacityMin: 240, reviewCostMin: 15, agentSlots: 2, horizonDays: 3 })
  const today = result.days[0]
  assert.deepEqual(today.items.map((i) => i.id).sort(), ['a1', 'flying', 'mine'])
  assert.equal(today.usedMin, 180 + 15 + 15, 'an agent task costs review time, not its 4h estimate')
  assert.equal(today.agentUsed, 2)
  assert.deepEqual(result.days[1].items.map((i) => i.id), ['a2', 'a3'], 'dispatch slots spill to the next day')
  assert.equal(today.items.find((i) => i.id === 'flying').source, 'in-flight')
  assert.deepEqual(tasksOf([...notes, note('sugg', { kind: 'suggestion', parentId: 'mine' })]).map((n) => n.id).includes('sugg'), false)
})

test('rollovers count once per missed day and survive re-reads', async () => {
  const { service } = fixture()
  await call(service, { op: 'upsert', note: { id: 'r', text: 'stubborn task' } })
  assert.equal(service.list()[0].plannedFor, TODAY)
  const tomorrow = '2026-11-26'
  await call(service, { op: 'state', today: tomorrow })
  await call(service, { op: 'state', today: tomorrow })
  let r = service.list()[0]
  assert.equal(r.rollovers, 1); assert.equal(r.plannedFor, tomorrow)
  const state = await call(service, { op: 'state', today: '2026-11-28' })
  r = service.list()[0]
  assert.equal(r.rollovers, 2)
  assert.equal(state.timeline.days[0].items[0].rollovers, 2)
  assert.equal(state.review.yesterday.rolled, 1)
})

test('harvest writes back the latest result and explore next-steps as dismissible suggestions', async () => {
  const docs = [
    { text: '```json\n{"tool":1}\n```' },
    { text: '调研完成：现有存储可直接复用，建议分两步实现。\n```next-steps\n- 实现存储层 ~1h\n- [ ] 写 Client 页面 2h\n```' },
  ]
  let reads = 0
  const query = { async filterEvents(sessionId) { reads++; assert.equal(sessionId, 'sess'); return docs } }
  const { service } = fixture(undefined, { sessionQuery: () => query })
  await call(service, { op: 'upsert', note: { id: 'idea', text: '大纲笔记' } })
  await call(service, { op: 'link', id: 'idea', sessionId: 'sess', mode: 'explore', workspaceId: 'w1' })
  let state = await call(service, { op: 'state', sessions: [{ id: 'sess', updatedAt: 10, running: true }] })
  assert.equal(reads, 0, 'a running Session is not read')
  state = await call(service, { op: 'state', sessions: [{ id: 'sess', updatedAt: 10, running: false }] })
  const idea = state.notes.find((n) => n.id === 'idea')
  assert.equal(idea.result.text, '调研完成：现有存储可直接复用，建议分两步实现。')
  assert.equal(idea.workspaceId, 'w1')
  const suggestions = state.notes.filter((n) => n.kind === 'suggestion')
  assert.deepEqual(suggestions.map((n) => n.text), ['实现存储层 ~1h', '写 Client 页面 2h'])
  assert.equal(state.timeline.days.flatMap((d) => d.items).some((i) => suggestions.some((s) => s.id === i.id)), false, 'suggestions are not scheduled')
  await call(service, { op: 'state', sessions: [{ id: 'sess', updatedAt: 10, running: false }] })
  assert.equal(reads, 1, 'an unchanged Session is not read again')
  assert.equal((await call(service, { op: 'upsert', note: { id: suggestions[0].id, text: 'edit' } })).code, 'SUGGESTION_READ_ONLY')
  state = await call(service, { op: 'accept', id: suggestions[0].id })
  assert.equal(state.notes.find((n) => n.id === suggestions[0].id).kind, 'note')
  state = await call(service, { op: 'dismiss', id: suggestions[1].id })
  assert.equal(state.notes.some((n) => n.id === suggestions[1].id), false)
  state = await call(service, { op: 'state', sessions: [{ id: 'sess', updatedAt: 20, running: false }] })
  assert.equal(state.notes.filter((n) => n.kind === 'suggestion').length, 0, 'accepted and dismissed steps are not re-added')
  state = await call(service, { op: 'unlink', id: 'idea' })
  assert.equal(state.notes.find((n) => n.id === 'idea').result, undefined)
})

test('next-steps parsing reads only the explicit block', () => {
  assert.deepEqual(parseNextSteps('no block\n- not a step'), [])
  assert.deepEqual(parseNextSteps('```next-steps\n1. one\n2) two\n* [x] three\n\n```'), ['one', 'two', 'three'])
  assert.equal(parseNextSteps('```next-steps\n' + Array.from({ length: 20 }, (_, i) => `- step ${i}`).join('\n') + '\n```').length, 8)
})

test('review counts yesterday from facts and reports conversion and speed', async () => {
  const { service } = fixture(undefined, { inboxActed: (day) => day === '2026-11-24' ? 4 : 0 })
  const store = service.store
  store.data.notes = {
    a: note('a', { createdAt: '2026-11-23T10:00:00Z', linkedAt: '2026-11-24T10:00:00Z', sessionId: 's', state: 'done', closedAt: '2026-11-24T14:00:00Z' }),
    b: note('b', { createdAt: '2026-11-24T08:00:00Z', state: 'dropped', closedAt: '2026-11-24T09:00:00Z' }),
    c: note('c', { createdAt: '2026-11-24T08:00:00Z' }),
  }
  const { review } = service.state(TODAY)
  assert.deepEqual({ ...review.yesterday, empty: undefined }, { date: '2026-11-24', done: 1, dropped: 1, dispatched: 1, reviewed: 1, rolled: 0, inboxActed: 4, empty: undefined })
  assert.equal(review.metrics.captured, 3)
  assert.equal(review.metrics.conversionRate, 1 / 3)
  assert.equal(review.metrics.startMedianMs, 86400_000)
  assert.equal(review.metrics.finishMedianMs, 4 * 3600_000)
})
