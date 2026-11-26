// Opt-in npm-registry smoke test. Authoring/checking this file does not run it.
// This is M0/S7 installation evidence only; it cannot establish M4 market acceptance.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile, realpath, access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { createHash } from 'node:crypto'
import { createServer } from 'node:net'
import { resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { connectInspector } from './cdp.mjs'
import { dismissNativeStartup, performIsolatedInput } from './browser-actions.mjs'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const PROFILE = 'npm-acceptance', SPEC = 'dsh-attention-inbox@1.0.0', VERSION = '1.0.0'
const WEB_PORT = 54082, INSPECTOR_PORT = 19232
const WEB = `http://127.0.0.1:${WEB_PORT}`, INSPECTOR = `http://127.0.0.1:${INSPECTOR_PORT}`
const GATE_MS = 60000, TOTAL_MS = 240000, began = Date.now()
const PROOF = resolve(ROOT, '.acceptance/npm-install-proof.json')
const originalTestEnv = Object.fromEntries(['DSH_TEST_HOME', 'DSH_TEST_WEB_ORIGIN', 'DSH_TEST_INSPECTOR', 'DSH_TEST_WORKSPACE'].map(key => [key, process.env[key]]))
const inheritedWeb = process.env.DSH_WEB_URL
const report = { passed: false, gate: 'M0/S7 real npm registry installation to actionable native obligation',
  spec: SPEC, expectedVersion: VERSION, profile: PROFILE, ports: { web: WEB_PORT, inspector: INSPECTOR_PORT },
  startedAt: new Date(began).toISOString(), marketAcceptance: { passed: false, assessed: false, reason: 'M4 market installation has a separate external prerequisite; npm CLI installation is not market evidence.' },
  instrumentation: ['artifacts/attention-acceptance-bridge-v8-0.0.5.tgz', 'SDK dsh-experimental-inspector-profile'],
  noProductConfiguration: true, model: 'fixed local fixture stream through native agent/approval services', cleanup: {} }
let stage = 'preflight', ownServer, inspector, browser, ownerAuthURL, fixtureId, runDir, childEnv, cli, gateStarted
let interrupted
const onSignal = signal => { interrupted = new Error(`Interrupted by ${signal}`) }
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, onSignal)
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const remaining = () => Math.max(0, TOTAL_MS - (Date.now() - began))
const gateRemaining = () => Math.max(0, GATE_MS - (Date.now() - gateStarted))
function safeError(error) {
  let text = String(error?.stack ?? error)
  if (ownerAuthURL) text = text.replaceAll(ownerAuthURL, '[owner-authenticated URL]')
  return text.replace(/https?:\/\/[^\s<>"')]+/g, value => { try { const url = new URL(value); return url.origin + url.pathname } catch { return '[URL]' } })
    .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]').replace(/\b(token|secret|authorization)=([^\s&]+)/gi, '$1=[redacted]').slice(0, 5000)
}
async function bounded(promise, ms, label, teardown = false) {
  const timeout = teardown ? ms : Math.min(ms, remaining())
  if (timeout <= 0) throw new Error(`Deadline exceeded: ${label}`)
  let timer
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), timeout) })]) }
  finally { clearTimeout(timer) }
}
function requireActive() { if (interrupted) throw interrupted; if (!remaining()) throw new Error('Overall acceptance deadline exceeded') }
async function waitFor(read, predicate, label, ms = 10000) {
  const deadline = Date.now() + Math.min(ms, remaining())
  while (Date.now() < deadline) {
    requireActive()
    const result = await bounded(read(), Math.max(1, deadline - Date.now()), label)
    if (predicate(result)) return result
    await delay(Math.min(100, Math.max(0, deadline - Date.now())))
  }
  throw new Error(`Timed out: ${label}`)
}
async function freePort(port) {
  const probe = createServer()
  try {
    await bounded(new Promise((resolve, reject) => { probe.once('error', reject); probe.listen({ host: '127.0.0.1', port, exclusive: true }, resolve) }), 2000, `reserve test port ${port}`)
  } finally { if (probe.listening) await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve())) }
}
function startChild(args) {
  requireActive()
  const child = spawn(process.execPath, [cli, ...args], { cwd: ROOT, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] })
  const handle = { child, bytes: 0, output: [], exited: false, outputOverflow: false }
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => {
    handle.bytes += chunk.length
    if (handle.bytes <= 2 * 1024 * 1024) handle.output.push(chunk)
    else { handle.outputOverflow = true; child.kill('SIGTERM') }
  })
  handle.exit = new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code, signal) => { handle.exited = true; resolve({ code, signal }) })
  })
  void handle.exit.catch(() => {})
  return handle
}
async function stopChild(handle) {
  if (!handle || handle.exited) return
  handle.child.kill('SIGTERM')
  try { await bounded(handle.exit, 7000, 'stop own server/CLI child', true) }
  catch { handle.child.kill('SIGKILL'); await bounded(handle.exit, 3000, 'reap own child after SIGKILL', true) }
}
async function runCli(args, ms = 45000) {
  const handle = startChild(args)
  try {
    const result = await bounded(handle.exit, ms, 'isolated CLI')
    if (handle.outputOverflow) throw new Error('Isolated CLI output exceeded its bounded capture')
    if (result.code !== 0) throw new Error(`Isolated CLI failed (exit ${result.code}, signal ${result.signal ?? 'none'}); captured output deliberately omitted`)
    // Seed/dump and package-manager output may contain owner URLs: retain only in memory.
    return Buffer.concat(handle.output).toString('utf8')
  } finally { await stopChild(handle); handle.output.length = 0 }
}
const pluginAdd = spec => ['plugin', '--profile', PROFILE, 'add', spec, '--ignore-scripts']
async function boot(ms = 20000) {
  ownServer = startChild(['--profile', PROFILE, '--host', '127.0.0.1', '--port', String(WEB_PORT), '--no-open'])
  const deadline = Date.now() + Math.min(ms, remaining())
  await waitFor(async () => {
    if (ownServer.exited) throw new Error('Own isolated server exited before readiness')
    try { const response = await fetch(`${INSPECTOR}/json/list`, { signal: AbortSignal.timeout(400) }); return response.ok && (await response.json()).length > 0 }
    catch { return false }
  }, Boolean, 'own Inspector listener', Math.max(1, deadline - Date.now()))
  const connecting = connectInspector(INSPECTOR)
  try { inspector = await bounded(connecting, Math.max(1, deadline - Date.now()), 'guarded own Inspector identity') }
  catch (error) { void connecting.then(connection => connection.close()).catch(() => {}); throw error }
}
async function stopServer() {
  inspector?.close(); inspector = undefined
  const handle = ownServer; ownServer = undefined
  await stopChild(handle)
}
// Root functions serialize their own source and receive every value as an argument.
// They never depend on a Node-side lexical closure or use the current GUI's Context.
function rootCall(fn, argument) {
  assert.ok(inspector, 'Own guarded Inspector is required')
  return inspector.rootCall(`async function(){return await (${fn.toString()}).call(this,${JSON.stringify(argument ?? null)})}`)
}
const invoke = (service, method, argument) => rootCall(async function (payload) { return await this.get(payload.service)[payload.method](payload.argument) }, { service, method, argument })
async function registryEvidence(profileDir) {
  const packagePath = resolve(profileDir, 'node_modules/dsh-attention-inbox/package.json')
  const packageRealpath = await realpath(packagePath)
  assert.ok(packageRealpath.startsWith((await realpath(runDir)) + sep), 'Installed package must resolve inside the new own home')
  const installed = JSON.parse(await readFile(packagePath, 'utf8'))
  assert.equal(installed.name, 'dsh-attention-inbox'); assert.equal(installed.version, VERSION)
  const lockPath = resolve(profileDir, 'pnpm-lock.yaml'), lock = await readFile(lockPath, 'utf8')
  const lines = lock.split('\n'), entries = []
  for (let i = 0; i < lines.length; i++) if (/^  ['"]?dsh-attention-inbox@1\.0\.0(?:['"]?:|\()/.test(lines[i])) {
    const block = [lines[i]]
    for (let j = i + 1; j < lines.length && (lines[j].trim() === '' || /^\s{4}/.test(lines[j])); j++) block.push(lines[j])
    const text = block.join('\n'), integrity = text.match(/integrity:\s*['"]?([^\s,'"}]+)/)?.[1]
    entries.push({ key: lines[i].trim(), ...(integrity ? { integrity } : {}) })
  }
  assert.ok(entries.some(entry => entry.integrity?.startsWith('sha512-')), 'Registry lock must record a published package integrity')
  assert.match(lock, /specifier:\s*['"]?[~^]?1\.0\.0['"]?(?:\s|$)/, 'Registry dependency must request release 1.0.0')
  const profile = JSON.parse(await readFile(resolve(profileDir, 'package.json'), 'utf8'))
  assert.match(profile.dependencies?.['dsh-attention-inbox'] ?? '', /^[~^]?1\.0\.0$/, 'Product must be a registry version, never a file/tarball/link dependency')
  return { installedVersion: installed.version, packagePath, packageRealpath, lockPath,
    lockSha256: createHash('sha256').update(lock).digest('hex'), lockfileVersion: lock.match(/^lockfileVersion:\s*(.+)$/m)?.[1],
    dependencySpecifier: profile.dependencies['dsh-attention-inbox'], registryEntries: entries }
}

try {
  const runtime = process.env.DSH_TEST_RUNTIME
  assert.ok(runtime, 'Set DSH_TEST_RUNTIME to the read-only SDK @deepseek-ai package directory')
  assert.equal(await realpath(process.cwd()), await realpath(ROOT), 'Run this script from the project root so Inspector sandbox guards use the same root')
  cli = resolve(runtime, 'dsh/lib/bin.js'); await access(cli)
  assert.notEqual(inheritedWeb && new URL(inheritedWeb).origin, WEB, 'Fixed test port must not be the current DSH GUI')
  const acceptanceDir = resolve(ROOT, '.acceptance')
  await mkdir(acceptanceDir, { recursive: true })
  assert.ok((await realpath(acceptanceDir)).startsWith((await realpath(ROOT)) + sep), 'Acceptance sandbox must stay inside this project')
  runDir = await mkdtemp(resolve(acceptanceDir, 'npm-smoke-'))
  const home = resolve(runDir, 'home'), agents = resolve(runDir, 'agents'), workspace = resolve(runDir, 'workspace'), browserProfile = resolve(runDir, 'browser')
  for (const directory of [home, agents, workspace, browserProfile]) await mkdir(directory)
  report.directories = { run: runDir, home, agents, workspace, browser: browserProfile }
  childEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('DSH_')))
  Object.assign(childEnv, { DSH_HOME: home, DSH_AGENTS_HOME: agents }) // HOME is inherited unchanged.
  Object.assign(process.env, { DSH_TEST_HOME: home, DSH_TEST_WEB_ORIGIN: WEB, DSH_TEST_INSPECTOR: INSPECTOR, DSH_TEST_WORKSPACE: workspace })
  report.isolation = { freshHome: true, freshAgents: true, freshWorkspace: true, freshBrowserProfile: true,
    inheritedDshVariablesRemovedFromChildren: true, homeEnvironmentUnchanged: childEnv.HOME === process.env.HOME, existingUserDataDeleted: false }
  const chrome = process.env.DSH_TEST_CHROME
  assert.ok(chrome, 'Set DSH_TEST_CHROME to the installed System Google Chrome executable')
  assert.equal(chrome, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', 'Use the installed System Google Chrome, not a downloaded browser')
  await access(chrome, constants.X_OK)
  const { chromium } = await import(pathToFileURL(resolve(acceptanceDir, 'browser-tools/node_modules/playwright-core/index.mjs')).href)
  const bridge = resolve(ROOT, 'artifacts/attention-acceptance-bridge-v8-0.0.5.tgz'), diagnosticBundle = resolve(runtime, 'dsh-experimental-inspector-profile')
  await access(bridge); await access(resolve(diagnosticBundle, 'package.json'))
  await freePort(WEB_PORT); await freePort(INSPECTOR_PORT)

  stage = 'seed-independent-profile'
  await runCli(['--profile', PROFILE, '--from-default-profile', 'web', '--dump-config'])
  stage = 'install-test-instrumentation'
  await runCli(pluginAdd(bridge))
  await runCli(pluginAdd(diagnosticBundle))
  const profileDir = resolve(home, 'profiles', PROFILE)
  const patchPath = resolve(profileDir, 'cordis.patch.yml'), existingPatch = await readFile(patchPath, 'utf8')
  assert.ok(!/\bdsh-attention-inbox\b/.test(existingPatch), 'Seeded profile must not configure the product')
  // The only authored override is test diagnostics: leave product defaults untouched.
  await writeFile(patchPath, existingPatch.trimEnd() + '\n- id: experimental-inspector\n  config:\n    port: 19232\n')
  const diagnosticPatch = await readFile(patchPath, 'utf8')
  report.diagnosticOverride = { path: patchPath, entry: 'experimental-inspector', port: INSPECTOR_PORT }

  stage = 'prepare-native-workspace'
  await boot()
  const workspaceRecord = await bounded(rootCall(async function (payload) {
    const workspace = await this.get('workspaceRegistry').create(payload.path, 'npm installation acceptance')
    return { id: workspace.id, path: workspace.path }
  }, { path: workspace }), 10000, 'create own native Workspace')
  assert.equal(workspaceRecord.path, workspace)
  report.workspace = workspaceRecord
  assert.equal(await rootCall(function () { return Boolean(this.get('attention')) }), false, 'Product cannot already be present before the measured registry install')
  await stopServer()

  stage = 'install-registry-release'
  gateStarted = Date.now(); report.installStartedAt = new Date(gateStarted).toISOString()
  await runCli(pluginAdd(SPEC), gateRemaining())
  report.registry = await registryEvidence(profileDir)
  assert.equal(await readFile(patchPath, 'utf8'), diagnosticPatch, 'Product installation must not require hand-editing plugin configuration')
  stage = 'start-installed-release'
  await boot(gateRemaining())
  const settings = await waitFor(() => rootCall(function () { return this.get('attention')?.getSettings() }), Boolean, 'read actual product defaults', gateRemaining())
  assert.equal(settings.reviewEnabled, true); assert.equal(settings.ledgerRetentionDays, 90)
  report.defaults = settings
  ownerAuthURL = await bounded(rootCall(function () { return this.get('connection').authenticatedUrl(this.get('webApp').getAdvertisedUrl()) }), gateRemaining(), 'create own owner URL')
  assert.equal(new URL(ownerAuthURL).origin, WEB)
  stage = 'open-own-native-ui'
  browser = await chromium.launchPersistentContext(browserProfile, { executablePath: chrome, headless: true, viewport: { width: 1280, height: 900 }, timeout: Math.max(1, gateRemaining()) })
  const page = browser.pages()[0] ?? await browser.newPage()
  const pageErrors = []; page.on('pageerror', error => pageErrors.push(safeError(error)))
  await page.goto(ownerAuthURL, { waitUntil: 'domcontentloaded', timeout: Math.max(1, gateRemaining()) })
  assert.equal(new URL(page.url()).origin, WEB)
  await waitFor(() => invoke('attentionAcceptanceBridge', 'status'), value => value.polls > 0 && value.origin === WEB && value.lastSeen >= gateStarted, 'own browser adapter attached', gateRemaining())
  await bounded(dismissNativeStartup(page), gateRemaining(), 'normal Continue/Close native onboarding')

  stage = 'retain-and-launch-native-approval'
  const fixture = await bounded(invoke('attentionAcceptanceFixtures', 'start', { kind: 'approval-allow', cwd: workspace, deferLaunch: true }), gateRemaining(), 'create deferred native fixture')
  fixtureId = fixture.id
  assert.equal(fixture.provenance.nativeAgentLoop, true); assert.equal(fixture.provenance.nativeApprovalAndQuestions, true)
  assert.equal(fixture.provenance.manualPendingObjects, 0); assert.equal(fixture.provenance.manualSessionAppends, 0); assert.equal(fixture.provenance.realProviderCalls, 0)
  const snapshot = () => invoke('attentionAcceptanceBridge', 'command', { op: 'snapshot', sessionIds: [fixtureId] })
  await waitFor(snapshot, value => value.knownSessions?.includes(fixtureId), 'native sidebar Session retention', gateRemaining())
  await bounded(invoke('attentionAcceptanceFixtures', 'launch', fixtureId), gateRemaining(), 'launch genuine native approval')
  await bounded(invoke('attentionAcceptanceBridge', 'command', { op: 'panel', panelId: 'attention-inbox' }), gateRemaining(), 'select Inbox')
  stage = 'first-actionable-native-obligation'
  const ready = await waitFor(snapshot, value => value.cards?.some(card => card.key.includes(fixtureId) && card.buttons.some(button => button.id === 'approval.allow-once' && !button.disabled)), 'native approval card', gateRemaining())
  const cards = ready.cards.filter(card => card.key.includes(fixtureId)); assert.equal(cards.length, 1)
  const native = ready.native.find(row => row.sessionId === fixtureId && row.kind)
  assert.ok(native, 'Approval must come from the native pending interaction provider'); assert.equal(native.mainView, 0)
  const selector = `[data-attention-key=${JSON.stringify(cards[0].key)}] [data-action-id="approval.allow-once"]`
  const button = page.locator('[data-attention-inbox="page"]').locator(selector)
  await bounded(dismissNativeStartup(page), gateRemaining(), 'dismiss only native startup dialogs')
  await button.waitFor({ state: 'visible', timeout: Math.max(1, gateRemaining()) })
  assert.equal(await button.isEnabled(), true)
  await button.click({ trial: true, timeout: Math.max(1, gateRemaining()) }) // Real browser hit testing: overlays must not intercept input.
  report.elapsedMs = Date.now() - gateStarted
  assert.ok(report.elapsedMs <= GATE_MS, `Actionable obligation took ${report.elapsedMs}ms; limit is ${GATE_MS}ms`)
  report.firstActionable = { nativeApproval: true, visible: true, enabled: true, unobstructedTrialClick: true, sessionId: fixtureId, nativeMainViewRetainers: native.mainView }

  stage = 'pointer-allow-and-native-ledger-confirmation'
  await bounded(performIsolatedInput(page, { op: 'click', selector }), 10000, 'real pointer allow once')
  const settled = await waitFor(() => invoke('attentionAcceptanceFixtures', 'status', fixtureId), value => !value.running && value.toolResults?.length > 0 && value.attention?.ledger.some(row => row.resolution === 'acted' && row.via === 'inbox' && row.nativeConfirmed === true), 'native tool completion and confirmed Host ledger', 20000)
  assert.equal(settled.nativeOutcome, 'allowed-once'); assert.equal(settled.modelStubCalls, 2)
  assert.ok(settled.toolResults.every(result => !result.isError))
  assert.equal(settled.provenance.realProviderCalls, 0); assert.equal(settled.provenance.manualPendingObjects, 0); assert.equal(settled.provenance.manualSessionAppends, 0)
  await waitFor(snapshot, value => !value.cards?.some(card => card.key.includes(fixtureId)) && !value.native?.some(row => row.kind), 'native and Inbox closure', 10000)
  assert.deepEqual(pageErrors, [])
  report.functionality = { genuineNativeApproval: true, realPointerAllowOnce: true, nativeOutcome: settled.nativeOutcome,
    paidModelCalls: settled.provenance.realProviderCalls, fixedStreamCalls: settled.modelStubCalls,
    manualPendingObjects: 0, manualSessionAppends: 0, nativeToolSucceeded: true, inboxAndNativeClosed: true,
    ledger: settled.attention.ledger.map(row => ({ kind: row.kind, resolution: row.resolution, via: row.via, nativeConfirmed: row.nativeConfirmed })), pageErrors }
  requireActive(); report.passed = true; stage = 'complete'
} catch (error) {
  report.passed = false; report.failure = { stage, error: safeError(error) }
  if (gateStarted && report.elapsedMs === undefined) report.elapsedMs = Date.now() - gateStarted
  process.exitCode = 1
} finally {
  if (inspector) {
    try {
      const cleanup = await bounded(invoke('attentionAcceptanceFixtures', 'cleanup'), 15000, 'cleanup own native fixtures', true)
      report.cleanup.fixtures = { errors: cleanup.errors, originalsUnchanged: cleanup.originalsUnchanged, workspaceOrderUnchanged: cleanup.workspaceOrderUnchanged, liveFixtureIds: cleanup.liveFixtureIds }
      assert.deepEqual(cleanup.errors, []); assert.deepEqual(cleanup.liveFixtureIds, [])
    } catch (error) { report.cleanup.fixtureError = safeError(error); report.passed = false; process.exitCode = 1 }
  }
  try { if (browser) await bounded(browser.close(), 10000, 'close own temporary browser', true); report.cleanup.browserClosed = true }
  catch (error) { report.cleanup.browserError = safeError(error); report.passed = false; process.exitCode = 1 }
  try { await stopServer(); report.cleanup.ownServerStoppedAndAwaited = true }
  catch (error) { report.cleanup.serverError = safeError(error); report.passed = false; process.exitCode = 1 }
  for (const [key, value] of Object.entries(originalTestEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
  for (const signal of ['SIGINT', 'SIGTERM']) process.removeListener(signal, onSignal)
  if (!report.passed && !report.failure) {
    const error = report.cleanup.fixtureError ?? report.cleanup.browserError ?? report.cleanup.serverError ?? 'Acceptance did not complete'
    report.failure = { stage: 'cleanup', error }
  }
  report.stage = report.failure?.stage ?? stage; report.finishedAt = new Date().toISOString(); report.totalElapsedMs = Date.now() - began
  report.cleanup.ownDirectoriesRetainedForInspection = true
  await mkdir(resolve(ROOT, '.acceptance'), { recursive: true })
  await writeFile(PROOF, JSON.stringify(report, null, 2) + '\n')
  console.log(report.passed ? 'npm registry acceptance passed; M4 market acceptance remains separate.' : `npm registry acceptance failed at ${report.failure?.stage ?? stage}; see .acceptance/npm-install-proof.json`)
}
