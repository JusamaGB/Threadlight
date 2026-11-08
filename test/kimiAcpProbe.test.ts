import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it } from 'vitest'

// Standalone .mjs has no companion declaration in this phase's scope.
// Import by URL, as the executable is also consumed outside the TS application.
const moduleUrl = new URL('./live/kimi-acp.proof.mjs', import.meta.url)
const {
  createFixtureProbe,
  runInitialization,
  isolatedEnvironment,
  prepareFixtureExercise,
  openFixtureExercise,
  openLiveExercise,
  permissionScopeHash,
  runScriptedRuntime,
  validateMoonshotAuthorization,
} = await import(moduleUrl.href)
const modelFixtureUrl = new URL('./fixtures/fake-kimi-model-server.mjs', import.meta.url)
const { createScriptedModelServer, SCRIPTED_MODEL, FIXTURE_CREDENTIAL } = await import(
  modelFixtureUrl.href
)
const roots: string[] = []
const { guardedApiFetch } = await import(
  new URL('./fixtures/kimi-api-fetch-guard.mjs', import.meta.url).href
)
it('reserves one bounded API request before transport and refuses a retry after uncertain delivery', async () => {
  const records: unknown[] = []
  let sends = 0
  const guard = guardedApiFetch(
    {
      mode: 'moonshot',
      url: 'https://api.moonshot.ai/v1/chat/completions',
      model: 'kimi-k3.1-pro',
      deadline: Date.now() + 30000,
    },
    async () => {
      sends++
      expect(records).toHaveLength(1)
      throw Error('Synthetic network failure')
    },
    (record: object) => records.push(structuredClone(record)),
  )
  const init = {
    method: 'POST',
    body: JSON.stringify({
      model: 'kimi-k3.1-pro',
      stream: true,
      max_completion_tokens: 4096,
      messages: [{ role: 'user', content: 'Reply OK.' }],
    }),
  }
  await expect(guard('https://api.moonshot.ai/v1/chat/completions', init)).rejects.toThrow(
    'uncertain',
  )
  await expect(guard('https://api.moonshot.ai/v1/chat/completions', init)).rejects.toThrow(
    'refused',
  )
  expect(sends).toBe(1)
})
it.each(['endpoint', 'cap', 'tools', 'size', 'reservation'])(
  'refuses an unsafe API %s before sending',
  async (failure) => {
    let sends = 0
    const guard = guardedApiFetch(
      {
        mode: 'moonshot',
        url: 'https://api.moonshot.ai/v1/chat/completions',
        model: 'kimi-k3.1-pro',
        deadline: Date.now() + 30000,
      },
      async () => {
        sends++
        return new Response('')
      },
      () => {
        if (failure === 'reservation') throw Error('Existing receipt')
      },
    )
    const body = {
      model: 'kimi-k3.1-pro',
      stream: true,
      max_completion_tokens: failure === 'cap' ? 4097 : 4096,
      tools: failure === 'tools' ? [{}] : [],
      messages: [{ role: 'user', content: failure === 'size' ? 'x'.repeat(33000) : 'OK' }],
    }
    await expect(
      guard(
        failure === 'endpoint'
          ? 'https://example.com'
          : 'https://api.moonshot.ai/v1/chat/completions',
        { method: 'POST', body: JSON.stringify(body) },
      ),
    ).rejects.toThrow('refused')
    expect(sends).toBe(0)
  },
)
it.each([4096, 4097])(
  'checks the API rehearsal completion cap (%s) and no-tool request',
  async (cap) => {
    const server = await createScriptedModelServer({ apiRehearsal: true })
    try {
      server.arm('stream')
      const response = await fetch(`${server.endpoint}/chat/completions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${FIXTURE_CREDENTIAL}` },
        body: JSON.stringify({
          model: SCRIPTED_MODEL,
          stream: true,
          messages: [{ role: 'user', content: 'Synthetic' }],
          max_completion_tokens: cap,
        }),
      })
      expect(response.status).toBe(cap === 4096 ? 200 : 400)
      await response.text()
      expect(server.snapshot().failure === null).toBe(cap === 4096)
    } finally {
      await server.close()
    }
  },
)
it('does not let the scripted runtime operation accept endpoint or authorization overrides', async () => {
  await expect(
    runScriptedRuntime({
      runtimeRoot: 'unused',
      runRoot: 'unused',
      endpoint: 'https://external.example',
    }),
  ).rejects.toThrow('only runtimeRoot')
  await expect(
    runScriptedRuntime({ runtimeRoot: 'unused', runRoot: 'unused', disableAuth: true }),
  ).rejects.toThrow('only runtimeRoot')
})

it('owns a bounded loopback streaming endpoint and closes its sockets', async () => {
  const server = await createScriptedModelServer()
  try {
    expect(server.endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/v1$/)
    server.arm('stream')
    const response = await fetch(`${server.endpoint}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${FIXTURE_CREDENTIAL}` },
      body: JSON.stringify({
        model: SCRIPTED_MODEL,
        stream: true,
        messages: [{ role: 'user', content: 'Synthetic' }],
      }),
    })
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('[DONE]')
    expect(server.snapshot().records[0].syntheticAuthentication).toBe(true)
    expect(server.snapshot().failure).toBeNull()
  } finally {
    await server.close()
  }
  expect(server.snapshot()).toMatchObject({ closed: true, openSockets: 0 })
})

it('rejects unexpected fixture authentication and refuses further scenarios', async () => {
  const server = await createScriptedModelServer()
  try {
    server.arm('stream')
    const response = await fetch(`${server.endpoint}/chat/completions`, {
      method: 'POST',
      body: '{}',
    })
    expect(response.status).toBe(400)
    await response.text()
    expect(server.snapshot().failure).toBe('Unexpected synthetic authentication')
    expect(() => server.arm('approve')).toThrow()
  } finally {
    await server.close()
  }
})
const probes: Array<{ close(): Promise<unknown> }> = []
async function fixture(options: { timeoutMs?: number; permissionTimeoutMs?: number } = {}) {
  const cwd = await mkdtemp(join(tmpdir(), 'threadlight-kimi-fixture-'))
  roots.push(cwd)
  const probe = createFixtureProbe({ cwd, ...options })
  probes.push(probe)
  expect((await probe.initialize()).status).toBe('observed')
  return probe
}
const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
afterEach(async () => {
  await Promise.all(probes.splice(0).map((p) => p.close()))
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

it('correlates out-of-order responses instead of response arrival order', async () => {
  const p = await fixture()
  const first = p.fixtureControl('echo', { sessionId: 'first/opaque', value: 1 })
  const second = p.fixtureControl('echo', { sessionId: 'second/opaque', value: 2 })
  await p.fixtureControl('flush')
  expect((await first).result).toEqual({ sessionId: 'first/opaque', value: 1 })
  expect((await second).result).toEqual({ sessionId: 'second/opaque', value: 2 })
})

it('accepts opaque sessions and fragmented UTF-8 events without double completion', async () => {
  const p = await fixture()
  const id = await p.fixtureSession()
  expect(id).toBe('opaque/session:1')
  const before = p.snapshot().stdoutBytes
  const turn = p.fixturePrompt(id, 'complete')
  await expect.poll(() => p.snapshot().stdoutBytes).toBeGreaterThan(before)
  await p.fixtureControl('flush')
  const result = await turn
  await p.fixtureControl('stats') // A protocol barrier drains earlier frames.
  expect(result.turn).toMatchObject({ state: 'terminal', terminal: 'end_turn' })
  const events = p.snapshot().events
  expect(events.filter((e: { kind: string }) => e.kind === 'terminal_observed')).toHaveLength(1)
  expect(events.some((e: { kind: string }) => e.kind === 'session_update')).toBe(true)
  expect(events.some((e: { kind: string }) => e.kind === 'late_or_duplicate_response')).toBe(true)
  expect(events.some((e: { kind: string }) => e.kind === 'foreign_session_event')).toBe(true)
})

it('preserves explicit permission denial and ignores duplicate requests and answers', async () => {
  const p = await fixture()
  const id = await p.fixtureSession()
  const turn = p.fixturePrompt(id, 'permission')
  await p.fixtureControl('stats')
  expect(p.respondPermission(`permission:${id}`, 'no', Date.now() + 1000)).toBe(true)
  expect(p.respondPermission(`permission:${id}`, 'yes', Date.now() + 1000)).toBe(false)
  const stats = (await p.fixtureControl('stats')).result
  expect(stats.responses).toHaveLength(1)
  expect(stats.responses[0].result.outcome).toEqual({ outcome: 'selected', optionId: 'no' })
  await p.fixtureControl('settle', { sessionId: id })
  await turn
})

it('settles only the matching session while another session still owns its turn', async () => {
  const p = await fixture()
  const first = await p.fixtureSession()
  const second = await p.fixtureSession()
  const a = p.fixturePrompt(first, 'wait')
  const b = p.fixturePrompt(second, 'wait')
  await p.fixtureControl('settle', { sessionId: second, reason: 'end_turn' })
  expect((await b).turn.terminal).toBe('end_turn')
  expect(p.snapshot().turns[first].state).toBe('pending')
  p.cancel(first)
  await p.fixtureControl('settle', { sessionId: first })
  expect((await a).turn.terminal).toBe('cancelled')
})

it('expires unanswered permission requests without accepting a late approval', async () => {
  const p = await fixture({ permissionTimeoutMs: 40 })
  const id = await p.fixtureSession()
  const turn = p.fixturePrompt(id, 'permission')
  await expect.poll(async () => (await p.fixtureControl('stats')).result.responses.length).toBe(1)
  expect(p.respondPermission(`permission:${id}`, 'yes', Date.now() + 1000)).toBe(false)
  expect((await p.fixtureControl('stats')).result.responses[0].result.outcome).toEqual({
    outcome: 'cancelled',
  })
  await p.fixtureControl('settle', { sessionId: id })
  await turn
})

it.each([undefined, 0])(
  'never upgrades missing/expired authorization into approval (%s)',
  async (expiry) => {
    const p = await fixture()
    const id = await p.fixtureSession()
    const turn = p.fixturePrompt(id, 'permission')
    await p.fixtureControl('stats')
    p.respondPermission(`permission:${id}`, 'yes', expiry)
    expect((await p.fixtureControl('stats')).result.responses[0].result.outcome).toEqual({
      outcome: 'cancelled',
    })
    await p.fixtureControl('settle', { sessionId: id })
    await turn
  },
)

it('keeps cancellation pending until the fixture supplies terminal settlement', async () => {
  const p = await fixture()
  const id = await p.fixtureSession()
  const turn = p.fixturePrompt(id, 'permission')
  await p.fixtureControl('stats')
  expect(p.cancel(id)).toBe(true)
  expect(p.cancel(id)).toBe(false)
  expect(p.respondPermission(`permission:${id}`, 'yes', Date.now() + 1000)).toBe(false)
  expect(p.snapshot().turns[id]).toMatchObject({
    state: 'pending',
    cancelRequested: true,
    terminal: null,
  })
  expect((await p.fixtureControl('stats')).result.cancels).toBe(1)
  await expect(p.fixturePrompt(id, 'duplicate')).rejects.toThrow('owns this session')
  await p.fixtureControl('settle', { sessionId: id })
  expect((await turn).turn).toMatchObject({ state: 'terminal', terminal: 'cancelled' })
})

it('disconnect leaves an outstanding cancelled turn uncertain without replay or late approval', async () => {
  const p = await fixture()
  const id = await p.fixtureSession()
  const turn = p.fixturePrompt(id, 'permission')
  await p.fixtureControl('stats')
  p.cancel(id)
  await p.fixtureControl('disconnect')
  expect((await turn).turn.state).toBe('uncertain')
  expect(p.respondPermission(`permission:${id}`, 'yes', Date.now() + 1000)).toBe(false)
  await p.close()
  const prompts = p
    .snapshot()
    .events.filter(
      (e: { kind: string; method?: string }) =>
        e.kind === 'request' && e.method === 'session/prompt',
    )
  expect(prompts).toHaveLength(1)
  expect(p.snapshot().cleanup).toBe('owned_processes_settled')
})

it('malformed output fails pending operations honestly and retires the owned process', async () => {
  const p = await fixture()
  expect((await p.fixtureControl('malformed')).status).toBe('uncertain')
  await p.close()
  expect(alive(p.snapshot().launcherPid)).toBe(false)
})

it('timeout retires the owned process tree while an independent test sentinel survives', async () => {
  const sentinel = await fixture()
  const sentinelPid = (await sentinel.fixtureControl('stats')).result.pid
  // Process startup shares CPU with the full Windows suite; the deliberate hang,
  // not cold Node startup, is the operation whose timeout this test exercises.
  const p = await fixture({ timeoutMs: 5000 })
  const descendant = (await p.fixtureControl('descendant')).result.pid
  expect(alive(descendant)).toBe(true)
  expect((await p.fixtureControl('hang')).status).toBe('uncertain')
  await p.close()
  expect(alive(descendant)).toBe(false)
  expect(alive(p.snapshot().launcherPid)).toBe(false)
  expect(alive(sentinelPid)).toBe(true)
  expect((await sentinel.fixtureControl('stats')).status).toBe('observed')
}, 20000)

it('rejects unknown real operations before examining or launching a runtime', async () => {
  await expect(runInitialization({ operation: 'prompt' })).rejects.toThrow('Only non-inference')
  await expect(runInitialization({ operation: 'authenticate' })).rejects.toThrow(
    'Only non-inference',
  )
})

it('rejects an altered entry and an existing state directory before execution', async () => {
  const root = await mkdtemp(join(tmpdir(), 'threadlight-kimi-identity-'))
  roots.push(root)
  const runtimeRoot = join(root, 'runtime')
  const packageRoot = join(runtimeRoot, 'node_modules/@moonshot-ai/kimi-code')
  await mkdir(join(packageRoot, 'dist'), { recursive: true })
  await writeFile(
    join(packageRoot, 'package.json'),
    JSON.stringify({
      name: '@moonshot-ai/kimi-code',
      version: '2.4.1',
      bin: { kimi: 'dist/main.mjs' },
    }),
  )
  const entry = "throw Error('Synthetic entry must never execute')"
  await writeFile(join(packageRoot, 'dist/main.mjs'), entry)
  const runRoot = join(root, 'existing-profile')
  await expect(
    runInitialization({ runtimeRoot, runRoot, entrySha256: '0'.repeat(64) }),
  ).rejects.toThrow('identity mismatch')
  await mkdir(runRoot)
  await expect(
    runInitialization({
      runtimeRoot,
      runRoot,
      entrySha256: createHash('sha256').update(entry).digest('hex'),
    }),
  ).rejects.toMatchObject({ code: 'EEXIST' })
})

it('import is inert even with credentials present and preserves normal system locations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'threadlight-kimi-import-'))
  roots.push(root)
  const marker = join(root, 'child-started')
  const preload = join(root, 'guard.cjs')
  await writeFile(
    preload,
    `const cp=require('node:child_process'); for(const k of ['spawn','exec','execFile','fork','spawnSync','execSync','execFileSync']) cp[k]=()=>{require('node:fs').writeFileSync(${JSON.stringify(marker)},'unexpected');throw Error('No launch allowed')};`,
  )
  const result = await new Promise<{ code: number | null; stderr: string }>((done) => {
    const child = spawn(
      process.execPath,
      [
        '--require',
        preload,
        '--input-type=module',
        '-e',
        `await import(${JSON.stringify(moduleUrl.href)});`,
      ],
      {
        cwd: root,
        shell: false,
        windowsHide: true,
        env: { ...process.env, KIMI_API_KEY: 'synthetic-not-a-key', KIMI_CODE_HOME: root },
        stdio: ['ignore', 'ignore', 'pipe'],
      },
    )
    let stderr = ''
    child.stderr.on('data', (b) => {
      stderr += String(b)
    })
    child.on('close', (code) => done({ code, stderr }))
  })
  expect(result).toEqual({ code: 0, stderr: '' })
  await expect(readFile(marker)).rejects.toMatchObject({ code: 'ENOENT' })
  const env = isolatedEnvironment(root)
  expect(env.KIMI_CODE_HOME).toBe(root)
  expect(env.KIMI_API_KEY).toBeUndefined()
  expect(env.USERPROFILE).toBe(process.env.USERPROFILE)
  expect(env.HOME).toBe(process.env.HOME)
  expect(fileURLToPath(moduleUrl)).toContain('kimi-acp.proof.mjs')
})

function authorization(exerciseId: string, overrides: Record<string, unknown> = {}) {
  return {
    authorizer: 'Julius',
    decisionRef: 'fixture-only decision; never real authorization',
    exerciseId,
    fixtureOnly: true,
    accessRoute: 'kimi-account-device-code',
    region: 'global',
    expiresAt: Date.now() + 60 * 60 * 1000,
    modelPolicy: 'discover-then-select',
    maxPrompts: 12,
    maxDurationMs: 20 * 60 * 1000,
    allowance: {
      mode: 'included-only',
      enforcement: {
        kind: 'verified-account-cap',
        evidenceRef: 'fixture evidence only',
        route: 'kimi-account-device-code',
        mode: 'included-only',
      },
    },
    ...overrides,
  }
}

async function exerciseSetup(overrides: Record<string, unknown> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'threadlight-kimi-live-gates-'))
  roots.push(root)
  const exerciseId = 'synthetic-exercise'
  const setup = await prepareFixtureExercise({ exerciseRoot: join(root, 'exercise'), exerciseId })
  return { ...setup, authorization: authorization(exerciseId, overrides) }
}
async function exercise(options: Record<string, unknown>) {
  const result = await openFixtureExercise(options)
  probes.push(result)
  return result
}
async function readyExercise(options: Record<string, unknown>) {
  const result = await exercise(options)
  await result.attach('create-session', 'discover')
  await result.selectModel('fixture-model')
  return result
}
const turnPlan = (operationId: string, prompt = 'live-complete') => ({
  operationId,
  operation: 'prompt',
  prompt,
  scope: 'Synthetic fixture only',
})

it('missing authorization and fixture authorization cannot launch the real live path', async () => {
  await expect(openLiveExercise({})).rejects.toThrow('authorization required')
  const options = await exerciseSetup()
  await expect(openLiveExercise(options)).rejects.toThrow('authorization required')
  await expect(openFixtureExercise({ ...options, authorization: undefined })).rejects.toThrow(
    'authorization required',
  )
  await expect(readFile(join(options.state, 'fake-sessions.json'))).rejects.toMatchObject({
    code: 'ENOENT',
  })
})

it('rejects a forged session ownership record before launching', async () => {
  const options = await exerciseSetup()
  const file = join(options.exerciseRoot, 'ownership.json')
  const envelope = JSON.parse(await readFile(file, 'utf8'))
  envelope.value.sessionId = 'another/users/session'
  await writeFile(file, JSON.stringify(envelope))
  await expect(openFixtureExercise(options)).rejects.toThrow('mismatched')
  await expect(readFile(join(options.state, 'fake-sessions.json'))).rejects.toMatchObject({
    code: 'ENOENT',
  })
})

it('rejects copied state at a different workspace and an arbitrary existing directory', async () => {
  const options = await exerciseSetup()
  const other = join(roots.at(-1)!, 'unowned')
  await mkdir(other)
  await writeFile(
    join(other, 'ownership.json'),
    await readFile(join(options.exerciseRoot, 'ownership.json')),
  )
  await expect(openFixtureExercise({ ...options, exerciseRoot: other })).rejects.toThrow(
    'mismatched',
  )
  await expect(
    prepareFixtureExercise({ exerciseRoot: other, exerciseId: 'different' }),
  ).rejects.toMatchObject({ code: 'EEXIST' })
})

it('restores owned history without inference and submits a repeated continuation only once', async () => {
  const options = await exerciseSetup()
  const first = await readyExercise(options)
  const initial = await first.submit(turnPlan('initial'))
  expect(initial.status).toBe('terminal')
  const sessionId = first.snapshot().record.sessionId
  await first.close()
  const restored = await exercise(options)
  await restored.attach('restore-only', 'restore')
  expect(restored.snapshot().record.sessionId).toBe(sessionId)
  expect((await restored.fixtureControl('stats')).result.aggregatePrompts).toBe(1)
  await restored.selectModel('fixture-model')
  const plan = { ...turnPlan('continue-once'), operation: 'continue' }
  const continued = await restored.submit(plan)
  expect(await restored.submit(plan)).toEqual(continued)
  expect((await restored.fixtureControl('stats')).result.aggregatePrompts).toBe(2)
  expect(restored.snapshot().record.prompts).toBe(2)
  await expect(restored.submit({ ...plan, prompt: 'changed' })).rejects.toThrow('different content')
})

it('persists submitted uncertainty and does not replay after disconnect or reopen', async () => {
  const options = await exerciseSetup()
  const first = await readyExercise(options)
  const plan = turnPlan('lost-receipt', 'disconnect-after-submit')
  expect((await first.submit(plan)).status).toBe('uncertain')
  expect((await first.submit(plan)).status).toBe('uncertain')
  await first.close()
  const reopened = await exercise(options)
  expect((await reopened.submit(plan)).status).toBe('uncertain')
  await expect(reopened.attach('restore-uncertain', 'restore')).rejects.toThrow('Reconcile')
  expect((await reopened.fixtureControl('stats')).result.aggregatePrompts).toBe(1)
})

it('keeps cancellation pending, rejects wrong-owner cancellation and late approvals', async () => {
  const e = await readyExercise(await exerciseSetup())
  const pending = e.submit(turnPlan('pending', 'permission'))
  await expect.poll(() => e.permissions().length).toBe(1)
  const request = e.permissions()[0]
  expect(e.cancel('another-operation')).toBe(false)
  expect(e.cancel('pending')).toBe(true)
  expect(
    e.respondPermission(request.id, {
      optionId: 'yes',
      requestHash: request.hash,
      operationId: 'pending',
      expiresAt: Date.now() + 1000,
    }),
  ).toBe(false)
  expect(e.snapshot().record.operations.pending.status).toBe('dispatching')
  const sessionId = e.snapshot().record.sessionId
  await e.fixtureControl('settle', { sessionId })
  expect((await pending).result.turn).toMatchObject({
    terminal: 'cancelled',
    cancelRequested: true,
  })
})

it('denies undeclared approval displays while preserving explicit denial', async () => {
  const e = await readyExercise(await exerciseSetup())
  const pending = e.submit(turnPlan('permission', 'permission'))
  await expect.poll(() => e.permissions().length).toBe(1)
  const request = e.permissions()[0]
  const decision = {
    requestHash: request.hash,
    operationId: 'permission',
    expiresAt: Date.now() + 1000,
  }
  expect(e.respondPermission(request.id, { ...decision, optionId: 'yes' })).toBe(false)
  expect(e.respondPermission(request.id, { ...decision, optionId: 'no' })).toBe(true)
  const stats = (await e.fixtureControl('stats')).result
  expect(stats.responses).toHaveLength(1)
  expect(stats.responses[0].result.outcome).toEqual({ outcome: 'selected', optionId: 'no' })
  await e.fixtureControl('settle', { sessionId: e.snapshot().record.sessionId })
  await pending
})

it('permits only a declared exact one-shot approval and consumes no duplicate response', async () => {
  const e = await readyExercise(await exerciseSetup())
  const pending = e.submit({
    ...turnPlan('approved', 'permission'),
    permissionHashes: [permissionScopeHash({ title: 'WriteFile', content: [] })],
  })
  await expect.poll(() => e.permissions().length).toBe(1)
  const request = e.permissions()[0]
  const decision = {
    optionId: 'yes',
    requestHash: request.hash,
    operationId: 'approved',
    expiresAt: Date.now() + 1000,
  }
  expect(e.respondPermission(request.id, decision)).toBe(true)
  expect(e.respondPermission(request.id, decision)).toBe(false)
  expect((await e.fixtureControl('stats')).result.responses).toHaveLength(1)
  await e.fixtureControl('settle', { sessionId: e.snapshot().record.sessionId })
  await pending
})

it('enforces the aggregate foreground count across owned restoration', async () => {
  const options = await exerciseSetup({ maxPrompts: 1 })
  const first = await readyExercise(options)
  await first.submit(turnPlan('one'))
  await first.close()
  const second = await exercise(options)
  await second.attach('restore', 'restore')
  await second.selectModel('fixture-model')
  await expect(second.submit({ ...turnPlan('two'), operation: 'continue' })).rejects.toThrow(
    'allowance exhausted',
  )
  expect((await second.fixtureControl('stats')).result.aggregatePrompts).toBe(1)
})

it('requires spending enforcement separately from authorization and local time limits', async () => {
  const e = await readyExercise(await exerciseSetup({ allowance: { mode: 'included-only' } }))
  await expect(e.submit(turnPlan('blocked'))).rejects.toThrow('not a spend cap')
  expect((await e.fixtureControl('stats')).result.aggregatePrompts).toBe(0)
})

it('retires an expired exercise without claiming terminal settlement', async () => {
  const e = await readyExercise(await exerciseSetup({ maxDurationMs: 150 }))
  const result = await e.submit(turnPlan('deadline', 'wait'))
  expect(result.status).toBe('uncertain')
  await e.close()
  expect(e.snapshot().observations.cleanup).toBe('owned_processes_settled')
  await expect(e.submit(turnPlan('too-late'))).rejects.toThrow('retired')
})

it('rejects a second owner while preserving the first connection and an independent sentinel', async () => {
  const options = await exerciseSetup()
  const first = await readyExercise(options)
  const sentinel = await fixture()
  await expect(openFixtureExercise(options)).rejects.toMatchObject({ code: 'EEXIST' })
  expect((await first.fixtureControl('stats')).status).toBe('observed')
  await first.close()
  expect((await sentinel.fixtureControl('stats')).status).toBe('observed')
}, 20000)

it('blocks concurrent prompt admission and unoffered models without extra submission', async () => {
  const e = await readyExercise(await exerciseSetup())
  await expect(e.selectModel('invented-model')).rejects.toThrow('not offered')
  const pending = e.submit(turnPlan('active', 'wait'))
  await expect.poll(() => e.snapshot().record.prompts).toBe(1)
  await expect(e.submit(turnPlan('overlap'))).rejects.toThrow('admission')
  await e.fixtureControl('settle', { sessionId: e.snapshot().record.sessionId })
  await pending
  expect((await e.fixtureControl('stats')).result.aggregatePrompts).toBe(1)
})

it('refuses changed runtime controls before sending a prompt', async () => {
  const options = await exerciseSetup()
  const e = await readyExercise(options)
  await writeFile(join(options.state, 'config.toml'), '[permission]\nallow = ["*"]\n')
  await expect(e.submit(turnPlan('bad-controls'))).rejects.toThrow('configuration changed')
  expect((await e.fixtureControl('stats')).result.aggregatePrompts).toBe(0)
})

it('requires a current explicit numerical API allowance for exactly one fixed-model prompt', () => {
  const auth = {
    authorizer: 'Julius',
    decisionRef: 'synthetic-test-only',
    budgetUsd: 1,
    expiresAt: Date.now() + 30000,
    model: 'kimi-k3.1-pro',
    prompts: 1,
  }
  expect(() => validateMoonshotAuthorization(auth)).not.toThrow()
  for (const change of [
    { budgetUsd: 0 },
    { budgetUsd: 0.25 },
    { budgetUsd: 2 },
    { prompts: 4 },
    { model: 'different' },
    { expiresAt: 0 },
    { decisionRef: '' },
    { credential: 'not-accepted' },
  ])
    expect(() => validateMoonshotAuthorization({ ...auth, ...change })).toThrow('authorization')
})
