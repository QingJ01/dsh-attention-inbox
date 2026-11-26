import { connectInspector } from './cdp.mjs'
import { createHash, randomUUID } from 'node:crypto'
import { readFile, realpath, stat, lstat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

// This script is intentionally not run by npm test. The Lead runs it against an
// explicitly configured project-owned test server, with the test browser closed.
const phase = process.argv[2]
if (!['before', 'after', 'm1'].includes(phase) || process.argv.length !== 3) {
  throw new Error('Usage: node scripts/acceptance-runtime-snapshot.mjs before|after|m1')
}
const project = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const acceptance = await realpath(resolve(project, '.acceptance'))
const inside = (path, root) => path !== root && path.startsWith(root + sep)
if (!inside(acceptance, await realpath(project))) throw new Error('The acceptance directory must physically belong to this project')
process.chdir(project) // The imported CDP guard resolves its allowlist from the project cwd.

// Only literal assignments from this one reviewed file are accepted; never source
// a shell or allow inherited DSH_TEST_* values to redirect an acceptance run.
const envFile = await realpath(resolve(acceptance, 'test-env.sh'))
if (!inside(envFile, acceptance)) throw new Error('Test environment file escaped the project sandbox')
const configured = {}
for (const [index, line] of (await readFile(envFile, 'utf8')).split(/\r?\n/).entries()) {
  if (!line.trim() || line.trimStart().startsWith('#')) continue
  const match = /^export (DSH_TEST_[A-Z0-9_]+)='([^']*)'\s*$/.exec(line)
  if (!match || Object.hasOwn(configured, match[1])) throw new Error(`Unsupported or duplicate test environment assignment at line ${index + 1}`)
  configured[match[1]] = match[2]
}
for (const key of ['DSH_TEST_RUNTIME', 'DSH_TEST_INSPECTOR', 'DSH_TEST_HOME', 'DSH_TEST_WEB_ORIGIN', 'DSH_TEST_WORKSPACE']) {
  if (!configured[key]) throw new Error(`Missing explicit ${key} in .acceptance/test-env.sh`)
}
for (const key of Object.keys(process.env)) if (key.startsWith('DSH_TEST_')) delete process.env[key]
Object.assign(process.env, configured)
const home = await realpath(configured.DSH_TEST_HOME), workspace = await realpath(configured.DSH_TEST_WORKSPACE)
if (!inside(home, acceptance) || !inside(workspace, acceptance)) throw new Error('Test home and workspace must physically remain in this project .acceptance directory')
if (!isAbsolute(configured.DSH_TEST_RUNTIME) || !(await stat(configured.DSH_TEST_RUNTIME)).isDirectory()) throw new Error('The read-only native SDK directory must be explicit and exist')
const inspector = new URL(configured.DSH_TEST_INSPECTOR), web = new URL(configured.DSH_TEST_WEB_ORIGIN)
if (inspector.hostname !== '127.0.0.1' || inspector.protocol !== 'http:' || !inspector.port || inspector.port === '9230'
  || web.hostname !== '127.0.0.1' || web.protocol !== 'http:' || !web.port) throw new Error('Only explicit isolated loopback test ports are allowed')

const baselinePath = await realpath(resolve(acceptance, 'baseline.json'))
if (!inside(baselinePath, acceptance)) throw new Error('Baseline manifest escaped the project sandbox')
const baseline = JSON.parse(await readFile(baselinePath, 'utf8'))
if (typeof baseline.id !== 'string' || !baseline.id.startsWith('attention-baseline-') || typeof baseline.location?.path !== 'string') throw new Error('Expected the independently created acceptance baseline Session manifest')
const baselineFile = await realpath(baseline.location.path)
if (!inside(baselineFile, home) || !(await stat(baselineFile)).isFile()) throw new Error('Baseline Session file must physically belong to the isolated test home')
const hashFile = async (path) => createHash('sha256').update(await readFile(path)).digest('hex')
const baselineHash = await hashFile(baselineFile)
const report = {
  phase, capturedAt: new Date().toISOString(), environmentFile: relative(project, envFile),
  testHome: home, testWorkspace: workspace, inspector: inspector.origin, webOrigin: web.origin,
  scope: phase === 'm1' ? 'Same temporary native Agent/scope; assemble, dispose only the isolated attention-inbox Host Loader fiber, then reassemble. Leaves that isolated Host service unloaded.'
    : 'A separate before/after uninstall window with the test browser closed; not the earlier GUI interaction window.',
  baseline: { sessionId: baseline.id, file: relative(project, baselineFile), sha256: baselineHash },
  provenance: { guardedInspector: true, sdkReadOnly: true, userHomeRead: false,
    originalBaselineModified: null, followupInvocations: 0, realModelRequestsAllowed: false },
}
const snapshotId = `attention-snapshot-${randomUUID()}`
let connection
try {
  connection = await connectInspector(configured.DSH_TEST_INSPECTOR)
  // A serialized function keeps all temporary native objects inside this one
  // checked Host. No import, eval, external model or synthetic prompt is used.
  async function capture(options) {
    const ctx = this
    if (process.env.DSH_HOME !== options.configuredHome) throw new Error('Host test home changed after the connection guard')
    if (typeof process.env.DSH_AGENTS_HOME !== 'string' || !process.env.DSH_AGENTS_HOME.startsWith(options.acceptanceRoot + '/')) throw new Error('Host agent resources must use an explicitly isolated project-local DSH_AGENTS_HOME')
    if (process.env.DSH_PROFILE_DIR && !process.env.DSH_PROFILE_DIR.startsWith(options.configuredHome + '/')) throw new Error('Host profile directory escaped the isolated test home')
    if (!options.sessionId.startsWith('attention-snapshot-') || options.sessionId === options.baselineId) throw new Error('Invalid temporary snapshot identity')
    const canonical = (value) => {
      const ancestors = new Set()
      const visit = (item) => {
        if (item === undefined) return { $type: 'undefined' }
        if (typeof item === 'function') return { $type: 'function', source: Function.prototype.toString.call(item) }
        if (typeof item === 'symbol') return { $type: 'symbol', description: item.description ?? '' }
        if (typeof item === 'bigint') return { $type: 'bigint', value: String(item) }
        if (typeof item === 'number' && !Number.isFinite(item)) return { $type: 'number', value: String(item) }
        if (!item || typeof item !== 'object') return item
        if (ancestors.has(item)) throw new Error('Cannot canonically fingerprint cyclic runtime options')
        ancestors.add(item)
        let result
        if (Array.isArray(item)) result = item.map(visit)
        else {
          const descriptors = Object.getOwnPropertyDescriptors(item)
          result = Object.fromEntries(Object.keys(descriptors).sort().map((key) => {
            const descriptor = descriptors[key]
            if (!descriptor.enumerable) return null
            if (!Object.hasOwn(descriptor, 'value')) throw new Error(`Cannot fingerprint accessor option ${key} without executing it`)
            return [key, visit(descriptor.value)]
          }).filter(Boolean))
        }
        ancestors.delete(item)
        return result
      }
      return JSON.stringify(visit(value))
    }
    const hash = async (value) => Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value)))).toString('hex')
    const loader = ctx.get('loader')
    if (!loader || typeof loader.entries !== 'function') throw new Error('Native Loader entry directory unavailable')
    const loaderSnapshot = async () => {
      const entries = [...loader.entries()]
      const relevantNames = ['@deepseek-ai/dsh-agent-preset', '@deepseek-ai/dsh-agent-preset-registry', '@deepseek-ai/dsh-agent-loop']
      const selected = entries.filter((entry) => relevantNames.includes(entry.options?.name))
      if (!selected.some((entry) => entry.options.name === '@deepseek-ai/dsh-agent-loop')) throw new Error('No native agent-loop Loader row found; cannot establish its option fingerprint')
      const canonicalRows = selected.map((entry) => ({ id: entry.options.id ?? null, name: entry.options.name, options: entry.options }))
        .sort((a, b) => canonical(a).localeCompare(canonical(b)))
      const groups = {}
      for (const name of relevantNames) {
        const rows = canonicalRows.filter((row) => row.name === name)
        groups[name] = { rowCount: rows.length, canonicalOptionsHash: await hash(rows) }
      }
      return { totalLoaderRowCount: entries.length, selectedRowCount: canonicalRows.length,
        canonicalOptionsHash: await hash(canonicalRows), groups,
        rows: await Promise.all(canonicalRows.map(async (row) => ({ id: row.id, name: row.name, optionsHash: await hash(row.options) }))) }
    }
    const serializeError = (error) => ({ name: error?.name ?? 'Error', code: typeof error?.code === 'string' ? error.code : null, message: String(error?.message ?? error) })
    const result = { loader: await loaderSnapshot(), modelVisible: { ok: false }, snapshotAgent: { id: options.sessionId, cwd: options.workspace,
      followupInvocations: 0, blockedModelAttempts: 0, disposed: false, persistentArtifact: null }, cleanupErrors: [] }
    const baselineSession = ctx.get('sessions')?.get(options.baselineId)
    const baselineSeq = baselineSession?.seq ?? null
    let handle, stage = 'resolve-default-preset'
    try {
      const presets = ctx.get('agentPresets')
      let preset
      if (presets) {
        preset = await presets.resolve()
        result.snapshotAgent.presetId = preset.id
        if (preset.broken) throw new Error(`Default preset unavailable: ${preset.broken}`)
      } else result.snapshotAgent.presetId = null
      stage = 'create-isolated-snapshot-agent'
      handle = await ctx.get('agents').create({ sessionId: options.sessionId,
        meta: { cwd: options.workspace, ...(preset ? { agentPreset: preset.id } : {}) },
        agentOptions: { provider: 'acceptance-stub', model: 'snapshot-no-model-call' },
        async setup(agentCtx, agent) {
          const original = agent.loopCtx
          if (!original) throw new Error('Native AgentLoop dependency context unavailable')
          const denyModelCall = () => { result.snapshotAgent.blockedModelAttempts++; throw new Error('SNAPSHOT_MODEL_REQUEST_FORBIDDEN') }
          agent.loopCtx = new Proxy(original, { get(target, key, receiver) {
            if (key === 'llm') return { prepareCall: denyModelCall, stream: denyModelCall }
            return Reflect.get(target, key, receiver)
          } })
          agentCtx.effect(() => () => { agent.loopCtx = original })
          if (preset) { stage = 'mount-default-preset'; await presets.mount(agentCtx, preset.id) }
        },
      })
      stage = 'assemble-native-model-visible-context'
      const agent = handle.agent
      if (agent.status !== 'idle') throw new Error('Snapshot Agent unexpectedly acquired work; assembly refused')
      const assemble = async () => {
        const assembly = await agent.loopCtx.systemPrompt.assemble({ agent, scope: agent })
        if (!Array.isArray(assembly.tools) || !Array.isArray(assembly.sections) || !Array.isArray(assembly.contexts)) throw new Error('Unexpected native SystemPromptAssembly shape')
        return { ok: true, sectionCount: assembly.sections.length, contextCount: assembly.contexts.length, toolCount: assembly.tools.length,
          toolsHash: await hash(assembly.tools), sectionsHash: await hash(assembly.sections), contextsHash: await hash(assembly.contexts), variablesHash: await hash(assembly.variables),
          toolNames: assembly.tools.map((tool) => tool.name), sectionNames: assembly.sections.map((section) => section.name),
          contexts: await Promise.all(assembly.contexts.map(async (context) => ({ name: context.name, hash: await hash(context) }))),
          contextHashNote: 'Exact native values are hashed. Clock-, session- or provider-dependent contexts can differ and are not normalized into equality.' }
      }
      if (options.phase === 'm1') {
        stage = 'm1-validate-isolated-product-entry'
        const candidates = [...loader.entries()].filter((entry) => entry.options?.id === 'attention-inbox' && entry.options?.name === 'dsh-attention-inbox')
        if (candidates.length !== 1 || !candidates[0].fiber || candidates[0].fiber.state !== 2 || !ctx.get('attention')) throw new Error('M1 requires exactly the active isolated attention-inbox product Loader entry and service')
        const hmr = ctx.get('hmr')
        if (typeof hmr?.runExclusive !== 'function') throw new Error('M1 requires the native HMR exclusive mutation boundary; no unload was attempted')
        await hmr.runExclusive(async () => {
          stage = 'm1-before-assemble-same-agent'
          const before = await assemble()
          result.m1 = { sameAgentId: agent.id, before, unload: { entryId: 'attention-inbox', package: 'dsh-attention-inbox', attempted: false, serviceAbsentAfterDispose: false } }
          stage = 'm1-dispose-isolated-product-host-fiber'
          result.m1.unload.attempted = true
          await candidates[0].fiber.dispose()
          result.m1.unload.serviceAbsentAfterDispose = ctx.get('attention') === undefined
          if (!result.m1.unload.serviceAbsentAfterDispose) throw new Error('Attention Host service still exists after disposing its isolated Loader fiber')
          if (agent.status !== 'idle') throw new Error('Snapshot Agent acquired work during product unload')
          stage = 'm1-after-assemble-same-agent'
          const after = await assemble()
          result.m1.after = after
          result.m1.comparison = { toolsUnchanged: before.toolsHash === after.toolsHash && before.toolCount === after.toolCount,
            sectionsUnchanged: before.sectionsHash === after.sectionsHash && before.sectionCount === after.sectionCount,
            contextsUnchanged: before.contextsHash === after.contextsHash && before.contextCount === after.contextCount,
            variablesUnchanged: before.variablesHash === after.variablesHash,
            changedContexts: [...new Set([...before.contexts.map((row) => row.name), ...after.contexts.map((row) => row.name)])]
              .filter((name) => before.contexts.find((row) => row.name === name)?.hash !== after.contexts.find((row) => row.name === name)?.hash) }
          result.modelVisible = after
        })
      } else result.modelVisible = await assemble()
      const persistence = ctx.get('sessionPersistence')
      if (typeof persistence?.locate === 'function') result.snapshotAgent.persistentArtifact = persistence.locate(agent.session.header)
    } catch (error) { result.modelVisible = { ok: false, stage, error: serializeError(error) } }
    finally {
      if (handle) {
        try { await handle.dispose(); result.snapshotAgent.disposed = true } catch (error) { result.cleanupErrors.push(serializeError(error)) }
        for (const workspace of ctx.get('workspaceRegistry')?.list() ?? []) if (workspace.sessionIds.includes(options.sessionId)) {
          try { await workspace.detachSession(options.sessionId) } catch (error) { result.cleanupErrors.push(serializeError(error)) }
        }
      }
      result.snapshotAgent.stillLive = Boolean(ctx.get('sessions')?.get(options.sessionId) || ctx.get('agents')?.get(options.sessionId))
      result.baselineLiveSeqBefore = baselineSeq
      result.baselineLiveSeqAfter = ctx.get('sessions')?.get(options.baselineId)?.seq ?? null
      result.baselineLiveSeqUnchanged = result.baselineLiveSeqAfter === baselineSeq
      result.loaderAfterSnapshotCleanup = await loaderSnapshot()
      result.snapshotPreservedLoaderOptions = result.loader.canonicalOptionsHash === result.loaderAfterSnapshotCleanup.canonicalOptionsHash
        && result.loader.selectedRowCount === result.loaderAfterSnapshotCleanup.selectedRowCount
    }
    return result
  }
  report.runtime = await connection.rootCall(`async function(){return await (${capture.toString()}).call(this, ${JSON.stringify({ phase, acceptanceRoot: acceptance, configuredHome: configured.DSH_TEST_HOME, workspace, sessionId: snapshotId, baselineId: baseline.id })})}`)
} catch (error) { report.error = { name: error.name, message: error.message } }
finally { connection?.close() }
report.baseline.sha256AfterSnapshot = await hashFile(baselineFile)
report.baseline.unchangedBySnapshot = report.baseline.sha256AfterSnapshot === baselineHash
report.provenance.originalBaselineModified = !report.baseline.unchangedBySnapshot || report.runtime?.baselineLiveSeqUnchanged === false
if (phase === 'after') {
  const beforePath = await realpath(resolve(acceptance, 'runtime-before.json'))
  if (!inside(beforePath, acceptance)) throw new Error('Before snapshot escaped the acceptance directory')
  const before = JSON.parse(await readFile(beforePath, 'utf8'))
  if (before.testHome !== home || before.testWorkspace !== workspace || before.baseline?.sessionId !== baseline.id || before.webOrigin !== web.origin) throw new Error('Before snapshot belongs to another isolated test environment')
  const a = before.runtime?.modelVisible, b = report.runtime?.modelVisible
  const comparable = a?.ok === true && b?.ok === true
  report.comparison = {
    baselineSessionFileUnchangedAcrossUninstall: before.baseline?.sha256AfterSnapshot === report.baseline.sha256,
    presetAndLoopOptionsUnchangedAcrossUninstall: Boolean(before.runtime?.loader && report.runtime?.loader)
      && before.runtime.loader.canonicalOptionsHash === report.runtime.loader.canonicalOptionsHash
      && before.runtime.loader.selectedRowCount === report.runtime.loader.selectedRowCount,
    modelVisibleComparable: comparable,
    toolsUnchanged: comparable ? a.toolsHash === b.toolsHash && a.toolCount === b.toolCount : null,
    sectionsUnchanged: comparable ? a.sectionsHash === b.sectionsHash && a.sectionCount === b.sectionCount : null,
    exactContextsUnchanged: comparable ? a.contextsHash === b.contextsHash : null,
    exactVariablesUnchanged: comparable ? a.variablesHash === b.variablesHash : null,
    changedContexts: comparable ? [...new Set([...a.contexts.map((row) => row.name), ...b.contexts.map((row) => row.name)])]
      .filter((name) => a.contexts.find((row) => row.name === name)?.hash !== b.contexts.find((row) => row.name === name)?.hash) : null,
    qualification: 'This comparison establishes only this explicit before/after window. An assemble failure leaves prompt/tool acceptance unverified; dynamic context differences require review.' }
}
const output = resolve(acceptance, `runtime-${phase}.json`)
try { if ((await lstat(output)).isSymbolicLink()) throw new Error('Refusing to overwrite a symlink report destination') } catch (error) { if (error.code !== 'ENOENT') throw error }
await writeFile(output, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ phase, report: relative(project, output), baselineUnchangedBySnapshot: report.baseline.unchangedBySnapshot,
  modelVisible: report.runtime?.modelVisible?.ok ?? false, error: report.error ?? report.runtime?.modelVisible?.error ?? null,
  comparison: report.comparison ?? report.runtime?.m1?.comparison ?? null }, null, 2))
if (report.error || !report.baseline.unchangedBySnapshot || report.runtime?.snapshotAgent?.stillLive
  || report.runtime?.snapshotAgent?.blockedModelAttempts || report.runtime?.cleanupErrors?.length
  || report.runtime?.baselineLiveSeqUnchanged === false || report.runtime?.snapshotPreservedLoaderOptions === false
  || report.runtime?.modelVisible?.ok !== true) process.exitCode = 1
if (phase === 'after' && (report.comparison.baselineSessionFileUnchangedAcrossUninstall !== true
  || report.comparison.presetAndLoopOptionsUnchangedAcrossUninstall !== true
  || report.comparison.toolsUnchanged !== true || report.comparison.sectionsUnchanged !== true)) process.exitCode = 1
if (phase === 'm1' && (report.runtime?.m1?.unload?.serviceAbsentAfterDispose !== true
  || report.runtime?.m1?.comparison?.toolsUnchanged !== true || report.runtime?.m1?.comparison?.sectionsUnchanged !== true
  || report.runtime?.m1?.comparison?.contextsUnchanged !== true || report.runtime?.m1?.comparison?.variablesUnchanged !== true)) process.exitCode = 1
