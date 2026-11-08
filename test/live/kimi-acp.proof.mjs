/** Opt-in ACP proof. Live access is confined to the authorized, owned exercise below. */
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync, renameSync, openSync, closeSync, unlinkSync } from 'node:fs'
import { mkdir, readFile, realpath, writeFile, readdir, lstat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { StringDecoder } from 'node:string_decoder'
import {
  createScriptedModelServer,
  SCRIPTED_MODEL,
  FIXTURE_CREDENTIAL,
  WRITE_CONTENT,
} from '../fixtures/fake-kimi-model-server.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '../..')
const fake = resolve(here, '../fixtures/fake-kimi-acp.mjs')
const liveCapability = Symbol('verified live exercise')
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const idKey = (id) => `${typeof id}:${id}`
const validId = (id) =>
  typeof id === 'string' || (typeof id === 'number' && Number.isSafeInteger(id))
const contains = (root, path) => {
  const r = relative(root, path)
  return r === '' || (!r.startsWith('..') && !isAbsolute(r))
}

// Reuse the existing Windows job/settlement helpers without generating app build
// output or changing global require hooks. These are the only two TS modules loaded.
let ownership
function processOwnership() {
  if (ownership) return ownership
  const require = createRequire(import.meta.url)
  const ts = require('typescript')
  const load = (name, dependencies = {}) => {
    const source = readFileSync(join(repo, 'src/main/agent', `${name}.ts`), 'utf8')
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    })
    const module = { exports: {} }
    const scopedRequire = (id) => dependencies[id] ?? require(id)
    new Function('require', 'module', 'exports', outputText)(scopedRequire, module, module.exports)
    return module.exports
  }
  ownership = load('ownedProcess', { './windowsProcessJob': load('windowsProcessJob') })
  return ownership
}

/** Keep normal system locations unchanged; exclude inherited credentials/config overrides. */
export function isolatedEnvironment(state) {
  if (!isAbsolute(state)) throw Error('An absolute isolated state directory is required.')
  const env = {}
  for (const [name, value] of Object.entries(process.env))
    if (
      /^(systemroot|windir|comspec|path|pathext|temp|tmp|userprofile|appdata|localappdata|homedrive|homepath|home)$/i.test(
        name,
      )
    )
      env[name] = value
  env.KIMI_CODE_HOME = state
  env.KIMI_DISABLE_TELEMETRY = '1'
  return env
}

class AcpProbe {
  #child
  #stop
  #fixture
  #cwd
  #pending = new Map()
  #permissions = new Map()
  #seenRequests = new Set()
  #sessions = new Set()
  #turns = new Map()
  #next = 0
  #buffer = ''
  #decoder = new StringDecoder('utf8')
  #dead = false
  #closing
  #timeout
  #permissionTimeout
  #events = []
  #bytes = 0
  #stderrBytes = 0
  #exit = null
  #cleanup = 'not_requested'
  #live

  constructor(child, stop, fixture, timeoutMs, permissionTimeoutMs, cwd, live) {
    this.#child = child
    this.#stop = stop
    this.#fixture = fixture
    this.#cwd = cwd
    this.#timeout = timeoutMs
    this.#permissionTimeout = permissionTimeoutMs
    this.#live = live
    this.record('process_started', { launcherPid: child.pid })
    child.stdout.on('data', (chunk) => {
      this.#bytes += chunk.length
      if (this.#bytes > 4 * 1024 * 1024) return this.fail('Output limit exceeded')
      this.#buffer += this.#decoder.write(chunk)
      this.consume()
    })
    child.stdout.on('end', () => {
      this.#buffer += this.#decoder.end()
      this.consume(true)
      this.fail('EOF before further outcomes could be observed')
    })
    child.stderr.on('data', (chunk) => {
      // Do not persist arbitrary provider log text, prompts or credentials.
      this.#stderrBytes += chunk.length
      if (this.#stderrBytes > 1024 * 1024) this.fail('Stderr limit exceeded')
    })
    child.once('exit', (code, signal) => {
      this.#exit = { code, signal }
      this.record('process_exited', this.#exit)
    })
    child.once('close', () => this.fail('Process output closed'))
    child.once('error', () => this.fail('Process launch/transport error'))
    child.stdin.on('error', () => this.fail('Input transport error'))
  }

  record(kind, details = {}) {
    if (this.#events.length >= 2000) return
    this.#events.push({
      sequence: this.#events.length + 1,
      at: new Date().toISOString(),
      kind,
      ...details,
    })
  }

  consume(final = false) {
    if (this.#dead) return
    if (Buffer.byteLength(this.#buffer) > 1024 * 1024) return this.fail('Frame limit exceeded')
    let end
    while ((end = this.#buffer.indexOf('\n')) !== -1) {
      const line = this.#buffer.slice(0, end).trim()
      this.#buffer = this.#buffer.slice(end + 1)
      if (line) this.receiveLine(line)
      if (this.#dead) return
    }
    if (final && this.#buffer.trim()) {
      this.receiveLine(this.#buffer.trim())
      this.#buffer = ''
    }
  }

  receiveLine(line) {
    try {
      const msg = JSON.parse(line)
      if (!object(msg) || msg.jsonrpc !== '2.0') throw Error('Invalid JSON-RPC envelope')
      if (typeof msg.method === 'string') {
        if ('id' in msg) {
          if (!validId(msg.id)) throw Error('Invalid request ID')
          this.reverseRequest(msg)
        } else if (msg.method === 'session/update') {
          if (!object(msg.params) || !this.#sessions.has(msg.params.sessionId)) {
            this.record('foreign_session_event')
            return
          }
          this.record('session_update', {
            sessionId: msg.params.sessionId,
            update: msg.params.update?.sessionUpdate ?? 'unknown',
          })
          this.#live?.update?.(msg.params)
        }
        return
      }
      if (!validId(msg.id) || 'result' in msg === 'error' in msg) throw Error('Invalid response')
      const pending = this.#pending.get(idKey(msg.id))
      if (!pending) {
        this.record('late_or_duplicate_response', { id: msg.id })
        return
      }
      this.#pending.delete(idKey(msg.id))
      clearTimeout(pending.timer)
      if ('error' in msg) {
        this.record('request_error', {
          id: msg.id,
          method: pending.method,
          code: msg.error?.code ?? null,
        })
        this.#live?.rpcError?.(pending.method, msg.error)
        pending.resolve({ status: 'error', code: msg.error?.code ?? null })
      } else {
        this.record('response', { id: msg.id, method: pending.method })
        pending.resolve({ status: 'observed', result: msg.result })
      }
    } catch {
      this.fail('Malformed protocol frame')
    }
  }

  send(message) {
    if (this.#dead) throw Error('Transport is closed; reconcile before retrying.')
    this.#child.stdin.write(`${JSON.stringify(message)}\n`)
  }

  #request(method, params) {
    if (this.#dead) return Promise.resolve({ status: 'uncertain', reason: 'Transport closed' })
    const id = ++this.#next
    return new Promise((resolveResult) => {
      const timer = setTimeout(() => this.fail(`Timeout waiting for ${method}`), this.#timeout)
      this.#pending.set(idKey(id), { method, resolve: resolveResult, timer })
      this.record('request', {
        id,
        method,
        ...(params.sessionId ? { sessionId: params.sessionId } : {}),
      })
      try {
        this.send({ jsonrpc: '2.0', id, method, params })
      } catch {
        this.fail('Send outcome uncertain')
      }
    })
  }

  initialize() {
    return this.#request('initialize', {
      protocolVersion: 1,
      clientInfo: { name: 'threadlight-phase1a-probe', version: '0.1.0' },
      clientCapabilities: {},
    })
  }

  async fixtureSession() {
    this.assertFixture()
    return (await this.session(liveCapability)).sessionId
  }

  async session(capability, sessionId) {
    if (capability !== liveCapability) throw Error('Missing session capability')
    if (sessionId) this.#sessions.add(sessionId) // History notifications arrive during load.
    const response = await this.#request(sessionId ? 'session/load' : 'session/new', {
      cwd: this.#cwd,
      mcpServers: [],
      ...(sessionId ? { sessionId } : {}),
    })
    const id = sessionId ?? response.result?.sessionId
    if (response.status !== 'observed' || typeof id !== 'string' || !id)
      throw Error('Session outcome unresolved; do not retry automatically')
    this.#sessions.add(id)
    return { ...response.result, sessionId: id }
  }

  async configure(capability, sessionId, configId, value) {
    if (capability !== liveCapability || !this.#sessions.has(sessionId))
      throw Error('Unowned session')
    return this.#request('session/set_config_option', { sessionId, configId, value })
  }

  /* Only the fixed fixture or the gated controller can reach model operations. */
  async prompt(capability, sessionId, text) {
    if (capability !== liveCapability) throw Error('Missing prompt capability')
    if (!this.#sessions.has(sessionId)) throw Error('Unknown session')
    if (this.#turns.has(sessionId) && this.#turns.get(sessionId).state !== 'terminal')
      throw Error('A turn already owns this session or needs reconciliation')
    const turn = { state: 'pending', cancelRequested: false, terminal: null }
    this.#turns.set(sessionId, turn)
    const response = await this.#request('session/prompt', {
      sessionId,
      prompt: [{ type: 'text', text }],
    })
    const reason = response.result?.stopReason
    if (response.status === 'observed' && typeof reason === 'string') {
      turn.state = 'terminal'
      turn.terminal = reason
      this.record('terminal_observed', { sessionId, stopReason: reason })
    } else {
      turn.state = 'uncertain'
      this.record('turn_unresolved', { sessionId })
    }
    this.revokePermissions(sessionId)
    return { ...response, turn: { ...turn } }
  }

  assertFixture() {
    if (!this.#fixture) throw Error('Fixture operations cannot target a real runtime')
  }

  fixturePrompt(sessionId, text) {
    this.assertFixture()
    return this.prompt(liveCapability, sessionId, text)
  }

  cancel(sessionId) {
    if (!this.#fixture && !this.#live) throw Error('Cancellation is not enabled')
    const turn = this.#turns.get(sessionId)
    if (!turn || turn.state !== 'pending' || turn.cancelRequested || this.#dead) return false
    turn.cancelRequested = true
    this.revokePermissions(sessionId)
    this.record('cancel_requested', { sessionId })
    this.send({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId } })
    return true
  }

  fixtureControl(action, params = {}) {
    this.assertFixture()
    if (
      ![
        'settle',
        'stats',
        'disconnect',
        'malformed',
        'echo',
        'flush',
        'hang',
        'descendant',
      ].includes(action)
    )
      throw Error('Unknown fixture control')
    return this.#request(`test/${action}`, params)
  }

  reverseRequest(msg) {
    const key = idKey(msg.id)
    if (this.#seenRequests.has(key)) {
      this.record('duplicate_reverse_request', { id: msg.id })
      return
    }
    if (this.#seenRequests.size >= 256) return this.fail('Reverse request limit exceeded')
    this.#seenRequests.add(key)
    if (msg.method !== 'session/request_permission') {
      this.send({
        jsonrpc: '2.0',
        id: msg.id,
        error: { code: -32601, message: 'Unsupported by Phase 1A probe' },
      })
      return
    }
    const p = msg.params
    const turn = this.#turns.get(p?.sessionId)
    if (
      (!this.#fixture && !this.#live) ||
      !object(p) ||
      !Array.isArray(p.options) ||
      !turn ||
      turn.state !== 'pending' ||
      turn.cancelRequested
    ) {
      this.send({ jsonrpc: '2.0', id: msg.id, result: { outcome: { outcome: 'cancelled' } } })
      return
    }
    const request = { id: msg.id, sessionId: p.sessionId, turn, options: p.options, timer: null }
    request.timer = setTimeout(
      () => this.finishPermission(key, { outcome: 'cancelled' }),
      this.#permissionTimeout,
    )
    this.#permissions.set(key, request)
    this.record('permission_pending', { id: msg.id, sessionId: p.sessionId })
    this.#live?.permission?.(msg.id, p)
  }

  respondPermission(id, optionId, expiresAt) {
    if (!this.#fixture && !this.#live) throw Error('Permissions are not enabled')
    const key = idKey(id)
    const p = this.#permissions.get(key)
    if (!p || this.#dead) return false
    const allowed =
      Number.isFinite(expiresAt) &&
      expiresAt > Date.now() &&
      p.turn.state === 'pending' &&
      !p.turn.cancelRequested
    const option = p.options.find(
      (o) => o.optionId === optionId && ['allow_once', 'reject_once'].includes(o.kind),
    )
    return this.finishPermission(
      key,
      allowed && option ? { outcome: 'selected', optionId } : { outcome: 'cancelled' },
    )
  }

  finishPermission(key, outcome) {
    const p = this.#permissions.get(key)
    if (!p) return false
    clearTimeout(p.timer)
    this.#permissions.delete(key)
    if (!this.#dead) this.send({ jsonrpc: '2.0', id: p.id, result: { outcome } })
    this.record('permission_resolved', {
      id: p.id,
      outcome: outcome.outcome,
      optionId: outcome.optionId,
    })
    return true
  }

  revokePermissions(sessionId) {
    for (const [key, p] of this.#permissions)
      if (!sessionId || p.sessionId === sessionId)
        this.finishPermission(key, { outcome: 'cancelled' })
  }

  fail(reason) {
    if (this.#dead) return
    this.#dead = true
    this.record('transport_closed', { reason })
    for (const p of this.#pending.values()) {
      clearTimeout(p.timer)
      p.resolve({ status: 'uncertain', reason })
    }
    this.#pending.clear()
    this.revokePermissions()
    void this.close().catch(() => {})
  }

  snapshot() {
    return structuredClone({
      fixture: this.#fixture,
      launcherPid: this.#child.pid,
      exit: this.#exit,
      cleanup: this.#cleanup,
      stdoutBytes: this.#bytes,
      stderrBytes: this.#stderrBytes,
      events: this.#events,
      turns: Object.fromEntries(this.#turns),
    })
  }

  close() {
    if (this.#closing) return this.#closing
    this.#closing = Promise.resolve().then(async () => {
      this.fail('Probe closed')
      try {
        await this.#stop(this.#child)
        this.#cleanup = 'owned_processes_settled'
      } catch (error) {
        this.#cleanup = 'unconfirmed'
        throw error
      }
      this.record('cleanup', { outcome: this.#cleanup })
      return this.snapshot()
    })
    return this.#closing
  }
}

function launch(
  entry,
  args,
  cwd,
  env,
  fixture,
  timeoutMs = 5000,
  permissionTimeoutMs = 1000,
  live,
) {
  if (![entry, cwd, process.execPath].every(isAbsolute))
    throw Error('Absolute launch paths required')
  const { spawnOwnedProcess, stopOwnedProcess } = processOwnership()
  return new AcpProbe(
    spawnOwnedProcess(process.execPath, [entry, ...args], cwd, env),
    stopOwnedProcess,
    fixture,
    timeoutMs,
    permissionTimeoutMs,
    cwd,
    live,
  )
}

export function createFixtureProbe({ cwd, timeoutMs = 3000, permissionTimeoutMs = 500 } = {}) {
  return launch(
    fake,
    [],
    cwd,
    isolatedEnvironment(join(cwd, 'fake-state')),
    true,
    timeoutMs,
    permissionTimeoutMs,
  )
}

/** A fresh directory and a recorded entry hash are mandatory; there is no real prompt API. */
export async function runInitialization({
  runtimeRoot,
  runRoot,
  entrySha256,
  operation = 'initialize',
}) {
  if (!['initialize', 'version', 'help'].includes(operation))
    throw Error('Only non-inference operations are supported')
  if (![runtimeRoot, runRoot].every(isAbsolute)) throw Error('Absolute preparation paths required')
  const runtime = await realpath(runtimeRoot)
  const parent = await realpath(dirname(runRoot))
  if (contains(await realpath(repo), runtime) || contains(await realpath(repo), parent))
    throw Error('Runtime preparation must stay outside the Threadlight checkout')
  const packageRoot = join(runtime, 'node_modules/@moonshot-ai/kimi-code')
  const metadata = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
  if (
    metadata.name !== '@moonshot-ai/kimi-code' ||
    metadata.version !== '2.4.1' ||
    metadata.bin?.kimi !== 'dist/main.mjs'
  )
    throw Error('Unexpected runtime package identity')
  const entry = await realpath(join(packageRoot, metadata.bin.kimi))
  if (
    !contains(runtime, entry) ||
    !/^[a-f0-9]{64}$/.test(entrySha256 ?? '') ||
    hash(await readFile(entry)) !== entrySha256
  )
    throw Error('Runtime entry identity mismatch')
  // mkdir without recursive deliberately refuses an existing profile or symlink.
  await mkdir(runRoot)
  const root = await realpath(runRoot)
  const state = join(root, 'state')
  const cwd = join(root, 'project')
  await mkdir(state)
  await mkdir(cwd)
  const args =
    operation === 'initialize' ? ['acp'] : [operation === 'version' ? '--version' : '--help']
  const manifest = {
    evidenceKind: 'actual-non-inference-runtime',
    operation,
    node: process.execPath,
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    package: metadata.name,
    version: metadata.version,
    entry,
    entrySha256,
    args,
    cwd,
    state,
    isolation: 'KIMI_CODE_HOME',
    inferenceEnabled: false,
    promptCount: 0,
  }
  await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest, null, 2))
  if (operation !== 'initialize') {
    const { spawnOwnedProcess, stopOwnedProcess } = processOwnership()
    const child = spawnOwnedProcess(
      process.execPath,
      [entry, ...args],
      cwd,
      isolatedEnvironment(state),
    )
    let output = ''
    let bytes = 0
    let timedOut = false
    let timer
    let finish
    const completion = new Promise((done) => {
      finish = done
      child.once('close', (code, signal) => done({ code, signal }))
      child.once('error', () => done({ code: null, signal: 'launch_error' }))
      timer = setTimeout(() => {
        timedOut = true
        done({ code: null, signal: 'inspection_timeout' })
      }, 15000)
    })
    child.stdout.on('data', (chunk) => {
      bytes += chunk.length
      if (bytes <= 128 * 1024) output += chunk.toString('utf8')
      else {
        timedOut = true
        finish({ code: null, signal: 'output_limit' })
      }
    })
    child.stderr.resume()
    const exit = await completion
    clearTimeout(timer)
    let cleanup = 'owned_processes_settled'
    try {
      await stopOwnedProcess(child)
    } catch {
      cleanup = 'unconfirmed'
    }
    const report = {
      ...manifest,
      launcherPid: child.pid,
      exit,
      timedOut,
      output,
      cleanup,
    }
    await writeFile(join(root, 'report.json'), JSON.stringify(report, null, 2))
    return report
  }
  const probe = launch(entry, args, cwd, isolatedEnvironment(state), false, 15000)
  let result
  try {
    result = await probe.initialize()
  } finally {
    // Keep the evidence even if retirement fails; never upgrade it to settled.
    await probe.close().catch(() => {})
    await writeFile(
      join(root, 'report.json'),
      JSON.stringify({ ...manifest, result, observations: probe.snapshot() }, null, 2),
    )
  }
  return { ...manifest, result, observations: probe.snapshot() }
}

const pinnedEntryHash = 'fd15d5c9b48892bb4f1d5fe82df9f790c8c19a44ca9a81054cc592b6fb9e2c90'
const pinnedLockHash = '7dfee229a1b8d354de84fd58af1f4eb39a197d396b0fba8fc631d358fbd035c8'
const controlConfig = `
[permission]
ask = ["*"]
deny = ["Agent", "Task", "WebFetch", "WebSearch", "Cron*"]
[task]
max_running_tasks = 1
keep_alive_on_exit = false
bash_auto_background_on_timeout = false
bash_task_timeout_s = 10
[loop_control]
max_steps_per_turn = 4
max_retries_per_step = 0
[subagent]
timeout_ms = 10000
`
const jsonHash = (value) => hash(JSON.stringify(value))
const safeId = (value) => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value)
const seal = (value, key) => createHmac('sha256', key).update(JSON.stringify(value)).digest('hex')
function saveLedger(root, value, key) {
  const target = join(root, 'ownership.json')
  const temp = `${target}.${randomUUID()}.tmp`
  writeFileSync(temp, JSON.stringify({ value, seal: seal(value, key) }, null, 2), {
    flag: 'wx',
    flush: true,
  })
  renameSync(temp, target)
}

async function verifiedRuntime(runtimeRoot) {
  if (!isAbsolute(runtimeRoot ?? '')) throw Error('Explicit absolute runtime required')
  const root = await realpath(runtimeRoot)
  if (contains(await realpath(repo), root)) throw Error('Runtime must be outside Threadlight')
  const entry = await realpath(join(root, 'node_modules/@moonshot-ai/kimi-code/dist/main.mjs'))
  const metadata = JSON.parse(await readFile(join(dirname(entry), '../package.json'), 'utf8'))
  if (
    !contains(root, entry) ||
    metadata.name !== '@moonshot-ai/kimi-code' ||
    metadata.version !== '2.4.1' ||
    hash(await readFile(entry)) !== pinnedEntryHash ||
    hash(await readFile(join(root, 'package-lock.json'))) !== pinnedLockHash
  )
    throw Error('Pinned runtime identity mismatch')
  return { kind: 'kimi', root, entry, entrySha256: pinnedEntryHash, lockSha256: pinnedLockHash }
}

/** Preparation does not authenticate or launch a provider. Each authorization binds one exercise. */
export async function prepareLiveExercise({ runtimeRoot, exerciseRoot, exerciseId }) {
  const runtime = await verifiedRuntime(runtimeRoot)
  const area = await realpath(join(dirname(runtime.root), 'phase1b'))
  if (!isAbsolute(exerciseRoot ?? '') || !contains(area, await realpath(dirname(exerciseRoot))))
    throw Error('Exercise must be inside the established phase1b preparation area')
  return prepareExercise({ runtime, exerciseRoot, exerciseId, area })
}

export async function prepareFixtureExercise({ exerciseRoot, exerciseId }) {
  return prepareExercise({
    runtime: { kind: 'fixture', entry: fake },
    exerciseRoot,
    exerciseId,
    area: await realpath(dirname(exerciseRoot)),
  })
}

async function prepareExercise({ runtime, exerciseRoot, exerciseId, area }) {
  if (!safeId(exerciseId)) throw Error('Explicit exercise identity required')
  await mkdir(exerciseRoot) // Never adopt an existing home or workspace.
  const root = await realpath(exerciseRoot)
  const state = join(root, 'state')
  const workspace = join(root, 'project')
  await mkdir(state)
  await mkdir(workspace)
  await writeFile(join(workspace, 'task.txt'), 'before\n')
  await writeFile(
    join(workspace, 'check.mjs'),
    "import {readFileSync} from 'node:fs';process.exit(readFileSync(new URL('./task.txt',import.meta.url),'utf8')==='after\\n'?0:1)\n",
  )
  await writeFile(join(state, 'config.toml'), controlConfig)
  const registry = join(area, '.probe-owners')
  await mkdir(registry, { recursive: true })
  const key = randomBytes(32).toString('hex')
  const anchor = { root, exerciseId, runtime, state, workspace, key }
  // Separate from both the provider home and synthetic workspace. Not an OS security boundary.
  await writeFile(join(registry, `${exerciseId}.json`), JSON.stringify(anchor), {
    flag: 'wx',
    mode: 0o600,
  })
  saveLedger(
    root,
    {
      schema: 1,
      root,
      exerciseId,
      runtime,
      state,
      workspace,
      sessionId: null,
      model: null,
      prompts: 0,
      startedAt: null,
      operations: {},
      sessionOperation: null,
      authorizationHash: null,
      uncertain: false,
    },
    key,
  )
  return { exerciseRoot: root, exerciseId, runtime, workspace, state }
}

function validateAuthorization(auth, exerciseId, fixture) {
  if (
    !object(auth) ||
    auth.authorizer !== 'Julius' ||
    !auth.decisionRef?.trim() ||
    auth.exerciseId !== exerciseId ||
    auth.fixtureOnly !== fixture ||
    auth.accessRoute !== 'kimi-account-device-code' ||
    !['global', 'mainland-cn'].includes(auth.region) ||
    !Number.isFinite(auth.expiresAt) ||
    auth.expiresAt <= Date.now() ||
    !['included-only', 'paid-budget'].includes(auth.allowance?.mode) ||
    auth.modelPolicy !== 'discover-then-select'
  )
    throw Error('Explicit account and usage authorization required')
  if (
    auth.allowance.mode === 'paid-budget' &&
    (!(auth.allowance.amount > 0) || !auth.allowance.currency?.trim())
  )
    throw Error('Paid allowance requires an explicit amount and currency')
  if (
    !Number.isInteger(auth.maxPrompts) ||
    auth.maxPrompts < 1 ||
    auth.maxPrompts > 12 ||
    !Number.isInteger(auth.maxDurationMs) ||
    auth.maxDurationMs < 1 ||
    auth.maxDurationMs > 20 * 60 * 1000
  )
    throw Error('Operational allowance exceeds the Phase 1B bounds')
}

async function ownedExercise(options, fixture) {
  validateAuthorization(options.authorization, options.exerciseId, fixture) // Before any launch or state mutation.
  if (!isAbsolute(options.exerciseRoot ?? '') || !safeId(options.exerciseId))
    throw Error('Explicit exercise required')
  const runtime = fixture
    ? { kind: 'fixture', entry: fake }
    : await verifiedRuntime(options.runtimeRoot)
  const root = await realpath(options.exerciseRoot)
  const area = fixture
    ? await realpath(dirname(root))
    : await realpath(join(dirname(runtime.root), 'phase1b'))
  if (!contains(area, root) || root === area) throw Error('Unowned execution area')
  const anchor = JSON.parse(
    await readFile(join(area, '.probe-owners', `${options.exerciseId}.json`), 'utf8'),
  )
  // Read mutable counters only AFTER taking the lease; a pre-lease read could roll
  // back another owner's completed turn when this caller later obtains the lock.
  const lease = join(root, '.probe-lease')
  const fd = openSync(lease, 'wx')
  try {
    const envelope = JSON.parse(await readFile(join(root, 'ownership.json'), 'utf8'))
    const record = envelope.value
    if (
      anchor.root !== root ||
      anchor.exerciseId !== options.exerciseId ||
      jsonHash(anchor.runtime) !== jsonHash(runtime) ||
      envelope.seal !== seal(record, anchor.key) ||
      record.root !== root ||
      record.exerciseId !== options.exerciseId ||
      jsonHash(record.runtime) !== jsonHash(runtime) ||
      record.workspace !== anchor.workspace ||
      record.state !== anchor.state ||
      (await realpath(record.workspace)) !== join(root, 'project') ||
      (await realpath(record.state)) !== join(root, 'state')
    )
      throw Error('Unowned or mismatched exercise state')
    const authHash = jsonHash({
      ...options.authorization,
      allowance: { ...options.authorization.allowance, enforcement: undefined },
    })
    if (record.authorizationHash && record.authorizationHash !== authHash)
      throw Error('Authorization changed; explicit reconciliation required')
    // Exclusive owner across connections/processes. A stale lease is evidence, not automatically removed.
    record.authorizationHash = authHash
    validateAuthorization(options.authorization, options.exerciseId, fixture)
    saveLedger(root, record, anchor.key)
    return {
      root,
      record,
      key: anchor.key,
      runtime,
      lease,
      fd,
      auth: structuredClone(options.authorization),
    }
  } catch (error) {
    closeSync(fd)
    unlinkSync(lease)
    throw error
  }
}

/** Hash the exact approval display, excluding the provider-generated request identity. */
export function permissionScopeHash(toolCall) {
  return jsonHash({ title: toolCall?.title, content: toolCall?.content })
}

async function sourceState(workspace) {
  const files = {}
  async function visit(dir) {
    for (const name of await readdir(dir)) {
      const path = join(dir, name)
      const stat = await lstat(path)
      if (stat.isSymbolicLink()) throw Error('Synthetic workspace contains a link')
      if (stat.isDirectory()) await visit(path)
      else {
        if (Object.keys(files).length >= 100 || stat.size > 1024 * 1024)
          throw Error('Synthetic evidence limit exceeded')
        files[relative(workspace, path)] = hash(await readFile(path))
      }
    }
  }
  await visit(workspace)
  return files
}

class Exercise {
  #owned
  #probe
  #fixture
  #active = null
  #closed = false
  #closing
  #deadline
  #permissions = new Map()
  #updates = []
  #configOptions = []
  #ready = false
  #modelReady = false
  #settlement
  #settle
  #manifest
  constructor(owned, fixture) {
    this.#owned = owned
    this.#fixture = fixture
    this.#manifest = {
      evidenceKind: fixture ? 'fixture-test' : 'actual-provider-observation',
      node: process.execPath,
      nodeVersion: process.version,
      entry: owned.runtime.entry,
      args: fixture ? [] : ['acp'],
      cwd: owned.record.workspace,
      state: owned.record.state,
      configSha256: hash(readFileSync(join(owned.record.state, 'config.toml'))),
      probeSha256: hash(readFileSync(fileURLToPath(import.meta.url))),
      ownershipHelperSha256: hash(readFileSync(join(repo, 'src/main/agent/ownedProcess.ts'))),
      jobHelperSha256: hash(readFileSync(join(repo, 'src/main/agent/windowsProcessJob.ts'))),
      authorization: {
        decisionRef: owned.auth.decisionRef,
        accessRoute: owned.auth.accessRoute,
        region: owned.auth.region,
        allowance: owned.auth.allowance,
        maxPrompts: owned.auth.maxPrompts,
        maxDurationMs: owned.auth.maxDurationMs,
      },
    }
  }
  #save() {
    saveLedger(this.#owned.root, this.#owned.record, this.#owned.key)
  }
  #check() {
    if (this.#closed) throw Error('Exercise is retired')
    validateAuthorization(this.#owned.auth, this.#owned.record.exerciseId, this.#fixture)
    if (
      this.#owned.record.startedAt &&
      Date.now() >= this.#owned.record.startedAt + this.#owned.auth.maxDurationMs
    )
      throw Error('Exercise time allowance exhausted')
  }
  async start() {
    this.#check()
    const { runtime, record } = this.#owned
    const hooks = {
      permission: (id, params) =>
        this.#permissions.set(idKey(id), {
          id,
          params,
          hash: permissionScopeHash(params.toolCall),
          operationId: this.#active,
        }),
      update: (params) => {
        if (this.#updates.length < 500) this.#updates.push(params)
      },
    }
    this.#probe = launch(
      runtime.entry,
      this.#fixture ? [] : ['acp'],
      record.workspace,
      isolatedEnvironment(record.state),
      this.#fixture,
      60000,
      30000,
      hooks,
    )
    const result = await this.#probe.initialize()
    this.#manifest.initialization = result
    if (
      result.status !== 'observed' ||
      result.result?.protocolVersion !== 1 ||
      (!this.#fixture && result.result.agentInfo?.version !== '2.4.1')
    )
      throw Error('Initialization did not establish the expected runtime')
    if (record.startedAt) this.#armDeadline()
    return this
  }
  #armDeadline() {
    clearTimeout(this.#deadline)
    const remaining =
      Math.min(
        this.#owned.record.startedAt + this.#owned.auth.maxDurationMs,
        this.#owned.auth.expiresAt,
      ) - Date.now()
    this.#deadline = setTimeout(
      () => {
        void this.close().catch(() => {})
      },
      Math.max(0, remaining),
    )
  }
  async attach(operationId, operation) {
    this.#check()
    const r = this.#owned.record
    if (!safeId(operationId) || !['discover', 'restore'].includes(operation))
      throw Error('Explicit session operation required')
    if (this.#active || r.uncertain || r.sessionOperation?.status === 'dispatching')
      throw Error('Reconcile uncertain or active operation first')
    if (operation === 'discover' && r.sessionId)
      throw Error('Existing session requires explicit restoration')
    if (operation === 'restore' && !r.sessionId) throw Error('No recorded session to restore')
    this.#active = operationId
    this.#modelReady = false
    r.startedAt ??= Date.now()
    r.sessionOperation = { operationId, operation, status: 'dispatching' }
    this.#save()
    this.#armDeadline()
    try {
      const response = await this.#probe.session(
        liveCapability,
        operation === 'restore' ? r.sessionId : undefined,
      )
      r.sessionId = response.sessionId
      this.#configOptions = response.configOptions ?? []
      r.sessionOperation.status = 'observed'
      this.#ready = true
      this.#save()
      return response
    } catch (error) {
      r.uncertain = true
      this.#save()
      throw error
    } finally {
      this.#active = null
    }
  }
  async selectModel(value) {
    this.#check()
    if (!this.#ready || this.#active) throw Error('Restore or discover an idle session first')
    const models = this.#configOptions.find((option) => option.id === 'model')?.options ?? []
    if (!models.some((model) => model.value === value))
      throw Error('Model was not offered by this session')
    this.#active = 'model-selection'
    try {
      const mode = await this.#probe.configure(
        liveCapability,
        this.#owned.record.sessionId,
        'mode',
        'default',
      )
      if (
        mode.status !== 'observed' ||
        mode.result?.configOptions?.find((option) => option.id === 'mode')?.currentValue !==
          'default'
      )
        throw Error('Manual permission mode was not confirmed')
      const response = await this.#probe.configure(
        liveCapability,
        this.#owned.record.sessionId,
        'model',
        value,
      )
      const effective = response.result?.configOptions?.find(
        (option) => option.id === 'model',
      )?.currentValue
      if (response.status !== 'observed' || effective !== value) {
        this.#owned.record.uncertain = true
        this.#save()
        throw Error('Effective model selection was not confirmed')
      }
      this.#owned.record.model = value
      this.#modelReady = true
      this.#save()
      return value
    } finally {
      this.#active = null
    }
  }
  async submit({ operationId, operation, prompt, scope, permissionHashes = [] }) {
    this.#check()
    const r = this.#owned.record
    if (
      !safeId(operationId) ||
      !['prompt', 'continue'].includes(operation) ||
      !prompt?.trim() ||
      !scope?.trim() ||
      prompt.length > 8000 ||
      !Array.isArray(permissionHashes) ||
      !permissionHashes.every((x) => /^[a-f0-9]{64}$/.test(x))
    )
      throw Error('Explicit bounded prompt and declared scope required')
    const inputHash = jsonHash({ operation, prompt, scope, permissionHashes })
    if (r.operations[operationId]) {
      if (r.operations[operationId].inputHash !== inputHash)
        throw Error('Operation identity reused with different content')
      return structuredClone(r.operations[operationId]) // Never resubmit, including unresolved delivery.
    }
    if (
      !this.#ready ||
      !this.#modelReady ||
      !r.model ||
      this.#active ||
      r.uncertain ||
      Object.values(r.operations).some((op) => op.status === 'dispatching')
    )
      throw Error('Session needs admission or reconciliation')
    if (
      operation === 'continue' &&
      !Object.values(r.operations).some((op) => op.status === 'terminal')
    )
      throw Error('Continuation requires a recorded prior terminal turn')
    if (r.prompts >= this.#owned.auth.maxPrompts)
      throw Error('Foreground prompt allowance exhausted')
    const spending = this.#owned.auth.allowance.enforcement
    if (
      !spending ||
      spending.kind !== 'verified-account-cap' ||
      !spending.evidenceRef?.trim() ||
      spending.route !== this.#owned.auth.accessRoute ||
      spending.mode !== this.#owned.auth.allowance.mode
    )
      throw Error(
        'Account allowance enforcement evidence is required before inference; client limits are not a spend cap',
      )
    const configPath = join(r.state, 'config.toml')
    if (
      (await realpath(configPath)) !== configPath ||
      !(await readFile(configPath, 'utf8')).includes(controlConfig)
    )
      throw Error('Runtime control configuration changed; review before inference')
    const before = await sourceState(r.workspace)
    // Revalidate after asynchronous evidence reads; reserve durably BEFORE submission.
    this.#check()
    if (this.#active) throw Error('Another operation owns the session')
    r.startedAt ??= Date.now()
    r.prompts++
    r.operations[operationId] = {
      inputHash,
      operation,
      scope,
      permissionHashes,
      status: 'dispatching',
      sessionId: r.sessionId,
      model: r.model,
      before,
      startedAt: Date.now(),
    }
    this.#active = operationId
    this.#save()
    this.#settlement = new Promise((done) => {
      this.#settle = done
    })
    this.#armDeadline()
    try {
      const result = await this.#probe.prompt(liveCapability, r.sessionId, prompt)
      const item = r.operations[operationId]
      item.status = result.turn.state === 'terminal' ? 'terminal' : 'uncertain'
      item.result = result
      item.after = await sourceState(r.workspace)
      item.finishedAt = Date.now()
      r.uncertain ||= item.status === 'uncertain'
      this.#save()
      return structuredClone(item)
    } catch (error) {
      r.operations[operationId].status = 'uncertain'
      r.uncertain = true
      this.#save()
      throw error
    } finally {
      this.#active = null
      this.#permissions.clear()
      this.#settle?.()
    }
  }
  permissions() {
    return [...this.#permissions.values()]
      .filter((p) => p.operationId === this.#active)
      .map((p) => structuredClone(p))
  }
  respondPermission(id, { optionId, requestHash, operationId, expiresAt }) {
    this.#check()
    const pending = this.#permissions.get(idKey(id))
    const op = this.#owned.record.operations[this.#active]
    if (
      !pending ||
      !op ||
      pending.operationId !== operationId ||
      operationId !== this.#active ||
      pending.hash !== requestHash
    )
      return false
    const option = pending.params.options.find((o) => o.optionId === optionId)
    // Never session/permanent approval. Unknown displays must be denied and reviewed.
    if (option?.kind === 'allow_once' && !op.permissionHashes.includes(requestHash)) return false
    const result = this.#probe.respondPermission(
      id,
      optionId,
      Math.min(expiresAt, this.#owned.auth.expiresAt),
    )
    this.#permissions.delete(idKey(id))
    return result
  }
  cancel(operationId) {
    if (this.#closed || operationId !== this.#active) return false
    this.#permissions.clear()
    return this.#probe.cancel(this.#owned.record.sessionId)
  }
  fixtureControl(action, params) {
    if (!this.#fixture) throw Error('Fixture controls are unavailable for a real runtime')
    return this.#probe.fixtureControl(action, params)
  }
  snapshot() {
    return structuredClone({
      manifest: this.#manifest,
      record: this.#owned.record,
      observations: this.#probe?.snapshot(),
      updates: this.#updates,
    })
  }
  close() {
    if (this.#closing) return this.#closing
    this.#closed = true
    clearTimeout(this.#deadline)
    this.#permissions.clear()
    this.#closing = (async () => {
      let cleanupError
      try {
        await this.#probe?.close()
      } catch (error) {
        cleanupError = error
      }
      await this.#settlement
      const r = this.#owned.record
      if (this.#active && r.operations[this.#active]?.status === 'dispatching') {
        r.operations[this.#active].status = 'uncertain'
        r.uncertain = true
      }
      this.#save()
      const evidence = this.snapshot()
      // Evidence is synthetic, but redact common credential-shaped fields before persistence.
      const safe = JSON.stringify(
        evidence,
        (key, value) =>
          /^(api.?key|access.?token|refresh.?token|password|secret)$/i.test(key)
            ? '[redacted]'
            : typeof value === 'string'
              ? value.replace(
                  /\b(?:sk-[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9._-]+)/gi,
                  '[redacted]',
                )
              : value,
        2,
      )
      try {
        await writeFile(join(this.#owned.root, `run-${randomUUID()}.json`), safe)
      } finally {
        closeSync(this.#owned.fd)
        unlinkSync(this.#owned.lease)
      }
      if (cleanupError) throw cleanupError
      return evidence
    })()
    return this.#closing
  }
}

async function openExercise(options, fixture) {
  const owned = await ownedExercise(options, fixture)
  const exercise = new Exercise(owned, fixture)
  try {
    return await exercise.start()
  } catch (error) {
    await exercise.close()
    throw error
  }
}
export const openLiveExercise = (options) => openExercise(options, false)
export const openFixtureExercise = (options) => openExercise(options, true)

/** Authentication is a separate explicit operation; it cannot submit a model turn. */
export async function loginLiveExercise(options) {
  const owned = await ownedExercise(options, false)
  const { spawnOwnedProcess, stopOwnedProcess } = processOwnership()
  let child
  let timer
  try {
    child = spawnOwnedProcess(
      process.execPath,
      [owned.runtime.entry, 'acp', '--login', '--region', owned.auth.region],
      owned.record.workspace,
      isolatedEnvironment(owned.record.state),
    )
    // Display the supported local sign-in flow without saving tokens/output to evidence.
    child.stdout.pipe(process.stdout, { end: false })
    child.stderr.pipe(process.stderr, { end: false })
    const result = await new Promise((done) => {
      child.once('close', (code) => done({ code }))
      child.once('error', () => done({ code: null }))
      timer = setTimeout(() => done({ code: null, timedOut: true }), 5 * 60 * 1000)
    })
    await writeFile(
      join(owned.root, `login-${randomUUID()}.json`),
      JSON.stringify({
        route: owned.auth.accessRoute,
        region: owned.auth.region,
        result,
        launcherPid: child.pid,
        prompts: 0,
      }),
    )
    return result
  } finally {
    clearTimeout(timer)
    try {
      if (child) await stopOwnedProcess(child)
    } finally {
      closeSync(owned.fd)
      unlinkSync(owned.lease)
    }
  }
}

// Load the application mapper itself, using the repository's installed TS compiler.
// This scoped loader neither installs packages nor changes global require hooks.
function loadRepoTs(path, cache = new Map()) {
  const filename = resolve(repo, path)
  if (!contains(repo, filename) || !filename.endsWith('.ts')) throw Error('Unowned TS module')
  if (cache.has(filename)) return cache.get(filename).exports
  const require = createRequire(filename)
  const { outputText } = require('typescript').transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: require('typescript').ModuleKind.CommonJS,
      target: require('typescript').ScriptTarget.ES2022,
    },
  })
  const module = { exports: {} }
  cache.set(filename, module)
  new Function('require', 'module', 'exports', outputText)(
    (id) =>
      id.startsWith('.') ? loadRepoTs(resolve(dirname(filename), `${id}.ts`), cache) : require(id),
    module,
    module.exports,
  )
  return module.exports
}

/** Explicit real runtime + owned scripted HTTP endpoint. No account-gate bypass or arbitrary endpoint. */
export async function runScriptedRuntime(options) {
  if (
    !object(options) ||
    !['runRoot,runtimeRoot', 'profile,runRoot,runtimeRoot'].includes(
      Object.keys(options).sort().join(),
    ) ||
    (options.profile !== undefined && options.profile !== 'api-rehearsal')
  )
    throw Error('Scripted operation accepts only runtimeRoot and a fresh runRoot')
  const apiRehearsal = options.profile === 'api-rehearsal'
  const { runtimeRoot, runRoot } = options
  const runtime = await verifiedRuntime(runtimeRoot)
  const area = await realpath(join(dirname(runtime.root), 'phase2b'))
  if (!isAbsolute(runRoot ?? '') || (await realpath(dirname(runRoot))) !== area)
    throw Error('Scripted run must use a fresh folder in the owned phase2b area')
  const lease = join(area, 'scripted.lease')
  const fd = openSync(lease, 'wx')
  const budgetPath = join(area, 'scripted-budget.json')
  let budget
  try {
    budget = JSON.parse(readFileSync(budgetPath, 'utf8'))
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    budget = { prompts: 0, requests: 0, elapsedMs: 0, uncertain: false }
  }
  const persistBudget = () => writeFileSync(budgetPath, JSON.stringify(budget), { flush: true })
  let probe, server, timer, startedAt
  const updates = [],
    permissions = []
  const report = {
    evidenceKind: 'Real Kimi runtime with a scripted model endpoint',
    profile: apiRehearsal
      ? 'Kimi wire protocol, no tools, one prompt, output cap rehearsal'
      : 'four scripted scenarios',
    runtime,
    sourceHashes: Object.fromEntries(
      [
        'test/live/kimi-acp.proof.mjs',
        'test/fixtures/fake-kimi-model-server.mjs',
        'src/main/kimi/config.ts',
        'src/shared/kimi.ts',
      ].map((p) => [p, hash(readFileSync(join(repo, p)))]),
    ),
    prompts: [],
    permissions,
    updates,
    outcome: 'incomplete',
  }
  let created = false
  let activeScenario = null
  try {
    if (
      budget.uncertain ||
      budget.prompts >= 8 ||
      budget.requests >= 24 ||
      budget.elapsedMs >= 600000
    )
      throw Error('Scripted aggregate budget exhausted or outcome needs reconciliation')
    await mkdir(runRoot)
    created = true
    const state = join(runRoot, 'state'),
      cwd = join(runRoot, 'project'),
      home = join(runRoot, 'home')
    await Promise.all([mkdir(state), mkdir(cwd), mkdir(home)])
    // Stop upward workspace discovery at this synthetic project, not a user's parent folders.
    await mkdir(join(cwd, '.git'))
    await writeFile(join(state, 'mcp.json'), '{"mcpServers":{}}')
    server = await createScriptedModelServer({
      apiRehearsal,
      onRequest: () => {
        if (++budget.requests > 24) throw Error('Aggregate model request limit')
        persistBudget()
      },
    })
    const { SettingsStore } = loadRepoTs('src/main/settings.ts')
    const { translateKimiConfiguration } = loadRepoTs('src/main/kimi/config.ts')
    const store = new SettingsStore(join(runRoot, 'threadlight-state'))
    const saved = {
      connection: {
        kind: 'local',
        endpoint: server.endpoint,
        model: SCRIPTED_MODEL,
        protocol: 'openai-chat',
        authentication: 'external-api-key',
      },
      agent: { kind: 'local', installationPath: dirname(dirname(runtime.entry)) },
    }
    if (!(await store.update({ kimiSetup: saved })).ok)
      throw Error('Synthetic settings save failed')
    const loaded = (await new SettingsStore(join(runRoot, 'threadlight-state')).load()).kimiSetup
    const metadata = {
      model: SCRIPTED_MODEL,
      maxContextSize: 32768,
      capabilities: apiRehearsal ? ['thinking', 'always_thinking'] : ['tool_use'],
      source: 'scripted-fixture',
    }
    const credential = {
      endpoint: server.endpoint,
      variable: 'THREADLIGHT_KIMI_FIXTURE_KEY',
      material: FIXTURE_CREDENTIAL,
    }
    const translated = translateKimiConfiguration(
      loaded,
      metadata,
      credential,
      apiRehearsal ? 4096 : undefined,
    )
    if (translated.status !== 'translated') throw Error('Synthetic translation incomplete')
    // Rehearse the Kimi wire encoder only against this owned local synthetic provider.
    // The production Moonshot mapping/endpoint is never rewritten or contacted.
    const toml = apiRehearsal
      ? singleRequestConfiguration(translated.toml.replace('type = "openai"', 'type = "kimi"'))
      : translated.toml
    await writeFile(join(state, 'config.toml'), toml)
    const env = isolatedEnvironment(state)
    // Child-only homes prevent user skills, hooks and MCP/account discovery; parent homes stay intact.
    for (const name of Object.keys(env))
      if (/^(home|userprofile|appdata|localappdata|homedrive|homepath)$/i.test(name))
        delete env[name]
    Object.assign(env, {
      HOME: home,
      USERPROFILE: home,
      APPDATA: home,
      LOCALAPPDATA: home,
      THREADLIGHT_KIMI_FIXTURE_KEY: FIXTURE_CREDENTIAL,
    })
    if (apiRehearsal) {
      const fetchPlan = join(state, 'fetch-plan.json')
      await writeFile(
        fetchPlan,
        JSON.stringify({
          mode: 'rehearsal',
          url: `${server.endpoint}/chat/completions`,
          model: SCRIPTED_MODEL,
          deadline: Date.now() + 600000,
          receipt: join(runRoot, 'request-receipt.json'),
        }),
      )
      env.THREADLIGHT_KIMI_FETCH_PLAN = fetchPlan
      env.NODE_OPTIONS = `--import=${pathToFileURL(join(repo, 'test/fixtures/kimi-api-fetch-guard.mjs')).href}`
    }
    report.configuration = {
      saved: loaded,
      alias: translated.alias,
      provider: translated.provider,
      metadata,
      configSha256: hash(toml),
      credentialVariable: translated.credentialVariable,
    }
    report.launch = {
      node: process.execPath,
      args: [runtime.entry, 'acp'],
      cwd,
      state,
      home,
      environmentNames: Object.keys(env),
      shell: false,
    }
    startedAt = Date.now()
    timer = setTimeout(() => {
      budget.uncertain = true
      persistBudget()
      void probe?.close()
      void server.close()
    }, 600000 - budget.elapsedMs)
    probe = launch(runtime.entry, ['acp'], cwd, env, false, 30000, 5000, {
      // Only the scripted, credential-free fixture records diagnostic error text.
      rpcError: (method, error) => {
        report.scriptedRpcError = { method, error: JSON.stringify(error).slice(0, 8000) }
      },
      update: (value) => {
        if (updates.length < 500) updates.push(value)
      },
      permission: (id, params) => {
        const expected =
          ['approve', 'deny'].includes(activeScenario) &&
          params.toolCall?.title === 'Write' &&
          params.toolCall.toolCallId?.endsWith(`phase2b-${activeScenario}`) &&
          JSON.stringify(params.toolCall.content).includes(`${activeScenario}.txt`)
        const kind = expected && activeScenario === 'approve' ? 'allow_once' : 'reject_once'
        const choice = params.options.find((option) => option.kind === kind)
        permissions.push({ scenario: activeScenario, expected, toolCall: params.toolCall, kind })
        probe.respondPermission(id, choice?.optionId, Date.now() + 1000)
      },
    })
    report.initialization = await probe.initialize()
    if (report.initialization.result?.agentInfo?.version !== '2.4.1')
      throw Error('Runtime initialization mismatch')
    report.session = await probe.session(liveCapability)
    const sessionId = report.session.sessionId
    for (const scenario of apiRehearsal ? ['stream'] : ['stream', 'approve', 'deny', 'cancel']) {
      if (budget.prompts >= 8 || budget.uncertain) throw Error('Prompt budget/uncertainty gate')
      activeScenario = scenario
      server.arm(scenario)
      budget.prompts++
      // Reserve uncertain delivery durably before sending; clear only on a terminal receipt.
      budget.uncertain = true
      persistBudget()
      const pending = probe.prompt(liveCapability, sessionId, `Synthetic ${scenario} scenario.`)
      if (scenario === 'cancel') {
        const deadline = Date.now() + 15000
        while (!server.snapshot().records.some((item) => item.scenario === 'cancel' && item.body)) {
          if (Date.now() > deadline) throw Error('Held stream was not reached')
          await new Promise((done) => setTimeout(done, 20))
        }
        report.cancelRequested = probe.cancel(sessionId)
      }
      const result = await pending
      report.prompts.push({ scenario, result })
      if (result.turn.state !== 'terminal') throw Error('Uncertain result; no automatic replay')
      budget.uncertain = false
      persistBudget()
      if (server.snapshot().failure) throw Error(server.snapshot().failure)
      if (scenario !== 'cancel' && result.turn.terminal !== 'end_turn')
        throw Error('Unexpected terminal result')
    }
    if (apiRehearsal) {
      report.requestGuard = JSON.parse(
        await readFile(join(runRoot, 'request-receipt.json'), 'utf8'),
      )
      if (permissions.length || server.snapshot().requests !== 1)
        throw Error('Rehearsal request/tool bound mismatch')
      report.outcome = 'observed'
      return report
    }
    const approved = await readFile(join(cwd, 'approve.txt'), 'utf8')
    if (approved !== WRITE_CONTENT) throw Error('Approved write effect mismatch')
    let deniedExists = false
    try {
      await lstat(join(cwd, 'deny.txt'))
      deniedExists = true
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    report.effects = {
      approvedSha256: hash(approved),
      expectedSha256: hash(WRITE_CONTENT),
      deniedExists,
    }
    if (deniedExists || permissions.length !== 2 || permissions.some((p) => !p.expected))
      throw Error('Permission scope/effect mismatch')
    report.outcome = 'observed'
  } catch (error) {
    report.error = error.message
    throw error
  } finally {
    clearTimeout(timer)
    try {
      if (probe) {
        await probe.close()
        report.observations = probe.snapshot()
      }
    } finally {
      if (server) {
        report.endpointBeforeCleanup = server.snapshot()
        await server.close()
        report.endpointAfterCleanup = server.snapshot()
      }
      if (startedAt) budget.elapsedMs += Date.now() - startedAt
      persistBudget()
      report.budget = budget
      if (created) await writeFile(join(runRoot, 'report.json'), JSON.stringify(report, null, 2))
      closeSync(fd)
      unlinkSync(lease)
    }
  }
  return report
}

function singleRequestConfiguration(toml) {
  return toml
    .replace('max_steps_per_turn = 4', 'max_steps_per_turn = 1')
    .replace('enabled = ["Write"]', 'enabled = ["Write"]\ndisabled = ["Write"]')
}

export function validateMoonshotAuthorization(auth) {
  if (
    !object(auth) ||
    Object.keys(auth).sort().join() !==
      'authorizer,budgetUsd,decisionRef,expiresAt,model,prompts' ||
    auth.authorizer !== 'Julius' ||
    typeof auth.decisionRef !== 'string' ||
    !auth.decisionRef.trim() ||
    !Number.isFinite(auth.budgetUsd) ||
    auth.budgetUsd < 0.3 ||
    auth.budgetUsd > 1 ||
    auth.model !== 'kimi-k3.1-pro' ||
    auth.prompts !== 1 ||
    !Number.isFinite(auth.expiresAt) ||
    auth.expiresAt <= Date.now() ||
    auth.expiresAt > Date.now() + 3600000
  )
    throw Error('Explicit current one-prompt Moonshot authorization is required')
}

/** Fixed guest-only API proof. The owned guest launcher establishes the OS/network boundary. */
async function runMoonshotAccess() {
  if (
    process.platform !== 'win32' ||
    process.env.USERNAME !== 'WDAGUtilityAccount' ||
    process.env.THREADLIGHT_KIMI_GUEST_READY !== 'online-checked'
  )
    throw Error('The owned, network-checked Windows Sandbox launcher is required')
  const auth = JSON.parse(
    (await readFile('C:/Input/authorization.json', 'utf8')).replace(/^\uFEFF/, ''),
  )
  validateMoonshotAuthorization(auth)
  const network = JSON.parse(
    (await readFile('C:/Evidence/network.json', 'utf8')).replace(/^\uFEFF/, ''),
  )
  if (network.status !== 'observed') throw Error('Guest network proof required')
  const secret = process.env.THREADLIGHT_KIMI_API_KEY
  delete process.env.THREADLIGHT_KIMI_API_KEY
  if (!secret?.trim()) throw Error('A dedicated API credential must be entered inside the guest')
  await writeFile(
    'C:/Evidence/live-admission.json',
    JSON.stringify({
      authorization: auth,
      operationId: randomUUID(),
      admittedAt: new Date().toISOString(),
      replay: 'prohibited',
    }),
    { flag: 'wx', flush: true },
  )
  const runtime = await verifiedRuntime('C:/KimiProof/runtime')
  const root = 'C:/KimiProof/api-single',
    state = join(root, 'state'),
    cwd = join(root, 'project'),
    home = join(root, 'home')
  await mkdir(root)
  await Promise.all([mkdir(state), mkdir(cwd), mkdir(home)])
  await mkdir(join(cwd, '.git'))
  await writeFile(join(state, 'mcp.json'), '{"mcpServers":{}}')
  const { translateKimiConfiguration } = loadRepoTs('src/main/kimi/config.ts')
  const setup = {
    connection: {
      kind: 'moonshot',
      protocol: 'kimi',
      authentication: 'external-api-key',
      model: 'kimi-k3.1-pro',
    },
    agent: { kind: 'local', installationPath: dirname(dirname(runtime.entry)) },
  }
  const translated = translateKimiConfiguration(
    setup,
    {
      model: 'kimi-k3.1-pro',
      maxContextSize: 1048576,
      capabilities: ['thinking', 'always_thinking'],
      source: 'operator-declared',
    },
    {
      endpoint: 'https://api.moonshot.ai/v1',
      variable: 'THREADLIGHT_KIMI_API_KEY',
      material: secret,
    },
    4096,
  )
  if (translated.status !== 'translated') throw Error('API configuration incomplete')
  const toml = singleRequestConfiguration(translated.toml)
  await writeFile(join(state, 'config.toml'), toml)
  const deadline = Date.now() + 600000
  const fetchPlan = join(state, 'fetch-plan.json')
  await writeFile(
    fetchPlan,
    JSON.stringify({
      mode: 'moonshot',
      url: 'https://api.moonshot.ai/v1/chat/completions',
      model: 'kimi-k3.1-pro',
      deadline,
      receipt: 'C:/Evidence/request-receipt.json',
    }),
  )
  const env = isolatedEnvironment(state)
  for (const name of Object.keys(env))
    if (/^(home|userprofile|appdata|localappdata|homedrive|homepath)$/i.test(name)) delete env[name]
  Object.assign(env, {
    HOME: home,
    USERPROFILE: home,
    APPDATA: home,
    LOCALAPPDATA: home,
    THREADLIGHT_KIMI_API_KEY: secret,
    THREADLIGHT_KIMI_FETCH_PLAN: fetchPlan,
    NODE_OPTIONS: `--import=${pathToFileURL(join(repo, 'test/fixtures/kimi-api-fetch-guard.mjs')).href}`,
  })
  const report = {
    evidenceKind: 'One-prompt guest Moonshot API probe',
    runtime,
    model: 'kimi-k3.1-pro',
    endpoint: translated.endpoint,
    configSha256: hash(toml),
    sourceHashes: Object.fromEntries(
      [
        'test/live/kimi-acp.proof.mjs',
        'test/fixtures/kimi-api-fetch-guard.mjs',
        'src/main/kimi/config.ts',
      ].map((p) => [p, hash(readFileSync(join(repo, p)))]),
    ),
    outcome: 'incomplete',
    updates: [],
    permissions: [],
  }
  let probe, timer
  try {
    probe = launch(runtime.entry, ['acp'], cwd, env, false, 600000, 1000, {
      update: (value) => {
        if (report.updates.length < 500) report.updates.push(value)
      },
      permission: (id, params) => {
        report.permissions.push({ unexpected: true })
        probe.respondPermission(
          id,
          params.options.find((o) => o.kind === 'reject_once')?.optionId,
          Date.now() + 500,
        )
      },
    })
    timer = setTimeout(() => void probe.close(), Math.max(1, deadline - Date.now()))
    report.initialization = await probe.initialize()
    report.session = await probe.session(liveCapability)
    report.result = await probe.prompt(
      liveCapability,
      report.session.sessionId,
      'Reply with exactly: Threadlight API check OK. Do not use tools.',
    )
    report.request = JSON.parse(await readFile('C:/Evidence/request-receipt.json', 'utf8'))
    report.projectEntries = await readdir(cwd)
    if (
      report.result.turn.state !== 'terminal' ||
      report.result.turn.terminal !== 'end_turn' ||
      report.permissions.length ||
      report.request.attempts !== 1 ||
      report.request.blocked ||
      report.projectEntries.join() !== '.git'
    )
      throw Error('Live acceptance failed; do not replay')
    report.outcome = 'observed'
  } catch {
    report.outcome = 'failed-or-uncertain'
    throw Error('API proof did not pass; inspect retained receipt, never replay automatically')
  } finally {
    clearTimeout(timer)
    if (probe) {
      await probe.close()
      report.observations = probe.snapshot()
    }
    await writeFile('C:/Evidence/live-report.json', JSON.stringify(report, null, 2))
  }
}

export async function main(argv) {
  if (argv.length === 1 && argv[0] === 'moonshot-single') {
    await runMoonshotAccess()
    return
  }
  if (argv[0] === 'scripted' || argv[0] === 'api-rehearsal') {
    if (argv.length !== 3) throw Error('Usage: scripted ABS_RUNTIME ABS_NEW_RUN')
    const report = await runScriptedRuntime({
      runtimeRoot: argv[1],
      runRoot: argv[2],
      ...(argv[0] === 'api-rehearsal' ? { profile: 'api-rehearsal' } : {}),
    })
    console.log(
      JSON.stringify({
        evidenceKind: report.evidenceKind,
        outcome: report.outcome,
        report: join(argv[2], 'report.json'),
      }),
    )
    return
  }
  if (argv[0] === 'live') {
    if (
      argv.length !== 3 ||
      !['prepare', 'login', 'discover', 'restore', 'prompt', 'continue'].includes(argv[1]) ||
      !isAbsolute(argv[2])
    )
      throw Error('Usage: live prepare|login|discover|restore|prompt|continue ABS_PLAN_JSON')
    const plan = JSON.parse(await readFile(argv[2], 'utf8'))
    if (argv[1] === 'prepare') {
      console.log(JSON.stringify(await prepareLiveExercise(plan)))
      return
    }
    if (argv[1] === 'login') {
      const result = await loginLiveExercise(plan)
      if (result.code !== 0) throw Error('Login did not complete')
      return
    }
    const exercise = await openLiveExercise(plan)
    const stop = () => {
      void exercise.close().catch(() => {
        process.exitCode = 1
      })
    }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
    try {
      const op = argv[1]
      if (op === 'discover' || op === 'restore')
        console.log(JSON.stringify(await exercise.attach(plan.operationId, op)))
      else {
        // Loading history and submitting a continuation are explicit, independently recorded steps.
        await exercise.attach(`${plan.operationId}-restore`, 'restore')
        await exercise.selectModel(plan.model)
        console.log(JSON.stringify(await exercise.submit({ ...plan, operation: op })))
      }
    } finally {
      await exercise.close()
      process.removeListener('SIGINT', stop)
      process.removeListener('SIGTERM', stop)
    }
    return
  }
  const [operation, runtimeRoot, runRoot, entrySha256, ...extra] = argv
  if (extra.length || !['initialize', 'version', 'help'].includes(operation) || !entrySha256)
    throw Error(
      'Usage: node kimi-acp.proof.mjs initialize|version|help ABS_RUNTIME ABS_NEW_RUN ENTRY_SHA256. Inference is disabled.',
    )
  const report = await runInitialization({ operation, runtimeRoot, runRoot, entrySha256 })
  if (
    (report.result && report.result.status !== 'observed') ||
    (operation === 'initialize' &&
      (report.result?.result?.protocolVersion !== 1 ||
        report.result?.result?.agentInfo?.version !== '2.4.1')) ||
    (operation === 'version' && report.output.trim() !== '2.4.1') ||
    report.timedOut ||
    (report.exit && report.exit.code !== 0) ||
    (report.observations?.exit && report.observations.exit.code !== 0) ||
    (report.cleanup ?? report.observations?.cleanup) !== 'owned_processes_settled'
  )
    throw Error('Runtime inspection did not succeed; inspect the saved report.')
  console.log(
    JSON.stringify({ operation, report: join(runRoot, 'report.json'), inferenceEnabled: false }),
  )
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
