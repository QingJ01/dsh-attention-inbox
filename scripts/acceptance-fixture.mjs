// Run only against the already source-filtered, authorized structural recording.
// This script never connects to a running DSH or reads any original Session log.
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
const target = new URL('../tests/fixtures/real-session-structure.json', import.meta.url)
const fixture = JSON.parse(await readFile(target, 'utf8'))
for (const session of fixture.sessions) for (const event of session.events) {
  if (event.data?.goal) {
    const { id, revision, phase, objective } = event.data.goal
    if (objective !== '[redacted]') throw new Error('Fixture contains an unredacted objective')
    event.data.goal = { id, revision, phase, objective }
  }
}
const bytes = JSON.stringify(fixture, null, 2) + '\n'
await writeFile(target, bytes)
const summary = fixture.sessions.map((session) => ({
  id: session.id, origin: session.origin,
  eventCount: session.events.length,
  sourceKinds: [...new Set(session.events.filter((event) => event.type === 'user/message').map((event) => event.data.source?.kind).filter(Boolean))].sort(),
  turnEndKinds: [...new Set(session.events.filter((event) => event.type === 'turn/end').map((event) => event.data.reason.kind))].sort(),
  autonomousGoalRounds: session.events.filter((event) => event.type === 'user/message' && event.data.source?.kind === 'goal').length,
  goalPhases: [...new Set(session.events.filter((event) => event.type === 'goal/change').map((event) => event.data.goal?.phase).filter(Boolean))].sort(),
}))
const manifest = {
  sha256: createHash('sha256').update(bytes).digest('hex'),
  eventCount: summary.reduce((sum, session) => sum + session.eventCount, 0),
  source: fixture.provenance,
  postCaptureMinimization: 'Removed goal configuration and blocker detail: retain only anonymous id/revision/phase and fixed [redacted] objective required by projection schema.',
  replayAdapter: 'Non-goal/turn/user-message events retain original envelopes in recording; test input maps these payload-stripped events to inert acceptance/ignored for contiguous ProjectionRegistry replay.',
  sessions: summary,
}
await writeFile(new URL('../tests/fixtures/real-session-structure.manifest.json', import.meta.url), JSON.stringify(manifest, null, 2) + '\n')
console.log(JSON.stringify(manifest, null, 2))
