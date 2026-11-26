import { test } from 'node:test'
import assert from 'node:assert/strict'
import { digestSession, filesOfCall, plainText, ProjectsService, DIGESTS_PER_REQUEST } from '../lib/projects.js'

const T0 = Date.parse('2026-11-20T09:00:00Z')
let seq = 0
const ev = (type, data, time) => ({ seq: ++seq, type, time, data })
const text = (value) => [{ type: 'text', text: value }]
/** A small but realistic log: an injected context message, two turns, tools, a todo list and an error. */
function log(id, start = T0) {
  return [
    ev('turn/start', { turn: 1 }, start),
    ev('user/message', { content: text('<context>ignored</context>'), source: { kind: 'context' } }, start),
    ev('user/message', { content: text('把 **CI** 的环境变量迁到 OSS'), source: { kind: 'user' } }, start + 1),
    ev('assistant/message', { message: { content: [{ type: 'reasoning', text: 'thinking' }, { type: 'text', text: '先看一下配置。' }] } }, start + 2),
    ev('tool/call', { turn: 1, step: 1, callId: 'a', name: 'edit', arguments: JSON.stringify({ file_path: '/work/app/ci/env.yml', old_string: 'a', new_string: 'b' }) }, start + 3),
    ev('tool/call', { turn: 1, step: 2, callId: 'b', name: 'apply_patch', arguments: JSON.stringify({ patch: '*** Begin Patch\n*** Update File: /work/app/README.md\n@@\n-a\n+b\n*** Add File: docs/oss.md\n+x\n*** End Patch' }) }, start + 4),
    ev('tool/call', { turn: 1, step: 3, callId: 'c', name: 'bash', arguments: JSON.stringify({ command: 'npm   test' }) }, start + 5),
    ev('tool/call', { turn: 1, step: 4, callId: 'd', name: 'read', arguments: JSON.stringify({ file_path: '/work/app/secret.txt' }) }, start + 6),
    ev('assistant/message', { message: { content: text('## 结果\n已迁移，`npm test` 通过。\n```diff\n+x\n```') } }, start + 7),
    ev('todo/write', { todos: [{ status: 'completed', content: '迁移' }, { status: 'pending', content: '通知团队' }] }, start + 8),
    ev('turn/end', { turn: 1, reason: { kind: 'completed' } }, start + 9),
    ev('session/title', { title: `CI 迁移 ${id}` }, start + 10),
    ev('turn/start', { turn: 2 }, start + 3600_000),
    ev('user/message', { content: text('再部署一次'), source: { kind: 'user' } }, start + 3600_001),
    ev('turn/end', { turn: 2, reason: { kind: 'error', error: { message: 'deploy key missing' } } }, start + 3600_002),
  ]
}

test('a Session digest keeps the person\'s asks, settled conclusions, changed files and commands', () => {
  const d = digestSession({ id: 's1', createdAt: T0 }, log('s1'), '/work/app')
  assert.equal(d.title, 'CI 迁移 s1')
  assert.equal(d.turnCount, 2)
  assert.equal(d.turns[0].ask, '把 CI 的环境变量迁到 OSS', 'injected context is not an ask; markdown is flattened')
  assert.equal(d.turns[0].answer, '结果 已迁移，npm test 通过。', 'the last text-bearing message wins; code blocks and reasoning are dropped')
  assert.deepEqual(d.turns[0].files, ['ci/env.yml', 'README.md', 'docs/oss.md'], 'write tools only, relative to the project')
  assert.deepEqual(d.turns[0].commands, ['npm test'])
  assert.equal(d.turns[0].outcome, 'done')
  assert.equal(d.turns[1].outcome, 'error')
  assert.equal(d.turns[1].answer, 'deploy key missing')
  assert.deepEqual(d.todos.map((t) => t.status), ['completed', 'pending'])
  assert.equal(d.outcome, 'error')
  const running = digestSession({ id: 's2', createdAt: T0 }, log('s2').slice(0, 5), '/work/app')
  assert.equal(running.turns[0].outcome, 'running')
})

test('file and text helpers ignore what they cannot interpret', () => {
  assert.deepEqual(filesOfCall('read', JSON.stringify({ file_path: '/a' })), [])
  assert.deepEqual(filesOfCall('write', 'not json'), [])
  assert.deepEqual(filesOfCall('write', JSON.stringify({ file_path: '/a/b.js', content: '' })), ['/a/b.js'])
  assert.equal(plainText('a'.repeat(50), 10), `${'a'.repeat(9)}…`)
  assert.equal(plainText('[link](http://x) and ![img](y)', 100), 'link and')
  assert.equal(plainText('store **DEEPSEEK_API_KEY** in `env`', 100), 'store DEEPSEEK_API_KEY in env', 'identifiers keep their underscores')
})

/** A sessionQuery that throws on anything but the two read-only calls the service may use. */
function readOnlyQuery(logs, records) {
  const calls = { readSession: [], listSessions: 0 }
  const allowed = {
    async listSessions() { calls.listSessions++; return records },
    async readSession(id) {
      calls.readSession.push(id)
      if (!logs[id]) throw new Error('SESSION_QUERY_SESSION_NOT_FOUND')
      return { header: records.find((r) => r.header.id === id)?.header ?? { id, createdAt: T0 }, events: logs[id] }
    },
  }
  const query = new Proxy(allowed, { get(target, key) {
    if (key in target) return target[key]
    if (key === 'then') return undefined
    throw new Error(`not read-only: ${String(key)}`)
  } })
  return { query, calls }
}

function setup(count = 3) {
  const ids = Array.from({ length: count }, (_, i) => `s${i}`)
  const logs = Object.fromEntries(ids.map((id, i) => [id, log(id, T0 + i * 86400_000)]))
  logs.child = log('child')
  logs.other = log('other')
  logs.blank = []
  const records = [...ids, 'blank'].map((id) => ({ header: { id, createdAt: T0, cwd: '/work/app' }, live: false, persisted: true }))
  records.push({ header: { id: 'child', createdAt: T0, parentSession: 's0', origin: 'subagent' }, live: false, persisted: true })
  records.push({ header: { id: 'old', createdAt: T0 }, live: false, persisted: true, formatStatus: 'migration-required' })
  records.push({ header: { id: 'other', createdAt: T0, cwd: '/work/other' }, live: false, persisted: true })
  const { query, calls } = readOnlyQuery(logs, records)
  const workspaces = [
    { id: 'w1', title: 'app', path: '/work/app', sessionIds: [...ids, 'blank', 'child', 'old'] },
    { id: 'w2', title: 'other', path: '/work/other', sessionIds: ['other'] },
    { id: 'w3', title: 'gone', path: '/work/gone', sessionIds: [], archived: true },
  ]
  const service = new ProjectsService({ workspaces: () => workspaces, archived: () => ['s2'], sessionQuery: () => query })
  return { service, calls, ids }
}

test('a project lists only its own Sessions, newest turns first, and counts subagents under their parent', async () => {
  const { service, calls } = setup()
  assert.deepEqual(service.list().map((w) => w.id), ['w1', 'w2'], 'archived workspaces are not offered')
  const facts = [{ id: 's0', updatedAt: 10 }, { id: 's1', updatedAt: 20, running: true }]
  const p = await service.project('w1', facts)
  assert.equal(p.pending, 0)
  assert.deepEqual(p.sessions.map((s) => s.id), ['s2', 's1', 's0'])
  assert.ok(!calls.readSession.includes('other'), 'another project\'s Session is never read')
  assert.ok(!calls.readSession.includes('child'), 'subagents are not separate rows')
  assert.ok(!calls.readSession.includes('old'), 'a log that needs migration is not read')
  assert.deepEqual(p.skipped, [{ id: 'old', reason: 'migration' }])
  assert.equal(p.sessions.find((s) => s.id === 's0').subagents, 1)
  assert.equal(p.sessions.find((s) => s.id === 's1').running, true)
  assert.equal(p.sessions.find((s) => s.id === 's2').archived, true)
  assert.ok(p.timeline.every((e, i, all) => i === 0 || all[i - 1].at >= e.at), 'newest first')
  assert.equal(p.stats.turns, 6); assert.equal(p.stats.sessions, 3); assert.equal(p.stats.activeDays, 3)
  assert.deepEqual(p.hotFiles.slice(0, 3).map((f) => [f.path, f.count]), [['ci/env.yml', 3], ['docs/oss.md', 3], ['README.md', 3]], 'ties sort by path')
  // Unchanged Sessions are not read again; a changed one is.
  const before = calls.readSession.length
  await service.project('w1', facts)
  assert.equal(calls.readSession.length, before)
  await service.project('w1', [{ id: 's0', updatedAt: 11 }, facts[1]])
  assert.deepEqual(calls.readSession.slice(before), ['s0'])
})

test('large projects fill in a few Sessions per request', async () => {
  const { service, ids } = setup(DIGESTS_PER_REQUEST + 4)
  const facts = ids.map((id, i) => ({ id, updatedAt: i + 1 }))
  const first = await service.project('w1', facts)
  assert.equal(first.pending, 4 + 1, 'the blank session is digested too, then hidden')
  assert.equal(first.sessions[0].id, ids.at(-1), 'the most recently updated come first')
  let next = first
  while (next.pending) next = await service.project('w1', facts)
  assert.equal(next.sessions.length, ids.length)
})

test('session detail stays inside the project and the route rejects bad input', async () => {
  const { service } = setup()
  const detail = await service.session('w1', 's0')
  assert.equal(detail.session.turns.length, 2)
  await assert.rejects(service.session('w1', 'other'), /NOT_IN_WORKSPACE/)
  await assert.rejects(service.project('nope', []), /UNKNOWN_WORKSPACE/)
  const route = (body) => service.handleRoute(new Request('http://x/api/attention-projects', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }))
  assert.equal((await route('{')).status, 400)
  assert.equal((await route({ op: 'nope' })).status, 400)
  assert.equal((await route({ op: 'project', workspaceId: 'w1', sessions: 'x' })).status, 400)
  assert.equal((await route({ op: 'session', workspaceId: 'w1', sessionId: 'other' })).status, 409)
  const ok = await (await route({ op: 'list' })).json()
  assert.equal(ok.workspaces.length, 2)
})
