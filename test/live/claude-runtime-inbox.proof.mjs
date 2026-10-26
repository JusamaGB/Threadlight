// Opt-in investigation of the installed Claude runtime's own messaging inbox.
// Uses disposable sessions only. Runtime auth tokens stay in memory, never in reports.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.argv[2] === '--hook') {
  let input = ''
  for await (const chunk of process.stdin) input += chunk
  const event = JSON.parse(input)
  await fetch(process.argv[3], {
    method: 'POST',
    headers: { authorization: `Bearer ${process.argv[4]}` },
    body: JSON.stringify({
      event: event.hook_event_name,
      sessionId: event.session_id,
      transcript: event.transcript_path,
      socket: process.env.CLAUDE_CODE_MESSAGING_SOCKET,
      token: process.env.CLAUDE_CODE_MESSAGING_TOKEN,
    }),
    signal: AbortSignal.timeout(10000),
  })
  process.exit(0)
}
if (process.env.THREADLIGHT_COMMUNICATION_PROOF !== '1')
  throw new Error('Set THREADLIGHT_COMMUNICATION_PROOF=1 to test disposable native chats.')
const executable = process.env.THREADLIGHT_CLAUDE_EXE
assert.ok(executable, 'Set THREADLIGHT_CLAUDE_EXE to the installed executable.')
const root = mkdtempSync(join(tmpdir(), 'threadlight-runtime-inbox-'))
const secret = randomUUID()
const credentials = new Set([secret])
const registrations = new Map()
const hookEvents = []
const runtimes = []
const checks = []
const report = {
  root,
  executable,
  sha256: createHash('sha256').update(readFileSync(executable)).digest('hex'),
  checks,
}
const server = createServer(async (req, res) => {
  if (req.headers.authorization !== `Bearer ${secret}`) {
    res.writeHead(403).end()
    return
  }
  try {
    let body = ''
    for await (const c of req) {
      body += c
      if (body.length > 16384) throw new Error('Body limit')
    }
    const record = JSON.parse(body)
    if (!runtimes.some((r) => r.id === record.sessionId)) throw new Error('Unknown test session')
    if (record.socket && record.token) {
      registrations.set(record.sessionId, record)
      credentials.add(record.token)
    }
    hookEvents.push({ event: record.event, sessionId: record.sessionId, at: Date.now() })
    res.end('ok')
  } catch {
    res.writeHead(400).end()
  }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const normalize = (s) => s.replaceAll('\\', '/')
const hook = `"${normalize(process.execPath)}" "${normalize(fileURLToPath(import.meta.url))}" --hook "http://127.0.0.1:${server.address().port}" "${secret}"`
const hooks = Object.fromEntries(
  ['SessionStart', 'Stop', 'SessionEnd'].map((event) => [
    event,
    [{ hooks: [{ type: 'command', command: hook, timeout: 15 }] }],
  ]),
)
const env = { ...process.env }
for (const key of [
  'CLAUDECODE',
  'CODEX_THREAD_ID',
  'CODEX_TURN_ID',
  'CODEX_INTERNAL_ORIGINATOR_OVERRIDE',
])
  delete env[key]
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function until(label, predicate, timeout = 60000) {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error(`Timed out: ${label}`)
    await delay(100)
  }
}
function start(name, options = {}) {
  const r = { id: options.id ?? randomUUID(), name, events: [], stderr: '', closed: false }
  runtimes.push(r)
  const settingsPath = join(root, `${name}.settings.json`)
  writeFileSync(
    settingsPath,
    JSON.stringify({ hooks, ...(options.inbound ? { crossSessionInbound: options.inbound } : {}) }),
  )
  const args = [
    '-p',
    options.resume ? '--resume' : '--session-id',
    r.id,
    '--name',
    name,
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--tools',
    '',
    '--permission-mode',
    'dontAsk',
    '--setting-sources',
    '',
    '--settings',
    settingsPath,
    '--strict-mcp-config',
    '--mcp-config',
    '{"mcpServers":{}}',
    '--debug-file',
    join(root, `${name}.debug.log`),
  ]
  r.child = spawn(executable, args, {
    cwd: root,
    env,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let buffer = ''
  r.child.stdout.on('data', (chunk) => {
    buffer += chunk
    let newline
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      try {
        r.events.push({ ...JSON.parse(line), observedAt: Date.now() })
      } catch {
        /* non-JSON startup output */
      }
    }
  })
  r.child.stderr.on('data', (chunk) => {
    r.stderr = (r.stderr + chunk).slice(-4000)
  })
  r.child.on('error', (error) => {
    r.stderr += error.message
    r.closed = true
  })
  r.child.on('close', (code) => {
    r.closed = true
    r.exitCode = code
  })
  r.child.stdin.on('error', () => {})
  r.child.stdin.write(
    JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content:
          'Disposable Threadlight runtime inbox probe. Reply READY. No tools. Follow subsequent harmless text-only probe requests.',
      },
    }) + '\n',
  )
  return r
}
const results = (r) => r.events.filter((e) => e.type === 'result')
const replyText = (r) =>
  r.events
    .filter((e) => e.type === 'assistant')
    .flatMap((e) => e.message?.content ?? [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n')
async function send(r, text, overrides = {}) {
  const registration = registrations.get(r.id)
  assert.ok(registration?.token && registration.socket, 'Hook must export native inbox credentials')
  const message = {
    type: 'user',
    session_id: r.id,
    uuid: randomUUID(),
    message: { role: 'user', content: text },
    ...overrides.frame,
  }
  return new Promise((resolve) => {
    let response = '',
      error = null
    const socket = createConnection(registration.socket)
    socket.setTimeout(3000, () => {
      error = 'timeout'
      socket.destroy()
    })
    socket.on('data', (c) => {
      response += c
    })
    socket.on('error', (e) => {
      error = e.code
    })
    socket.on('close', () => resolve({ response, error }))
    socket.on('connect', () =>
      socket.end(
        JSON.stringify({ type: 'auth', token: overrides.token ?? registration.token }) +
          '\n' +
          JSON.stringify(message) +
          '\n',
      ),
    )
  })
}
const check = (name, details = {}) => {
  checks.push({ name, ...details })
  console.log(name)
}
try {
  const a = start('threadlight-inbox-probe-a')
  await until('initial native result', () => results(a).length === 1 || a.closed)
  assert.equal(a.closed, false, a.stderr)
  await until('native hook registration', () => registrations.has(a.id), 10000)
  assert.equal(results(a)[0].session_id, a.id)
  check('Native session seeded and still alive; hook exported its own inbox', {
    sessionId: a.id,
    pid: a.child.pid,
  })

  const idleToken = `IDLE_${randomUUID()}`
  const idleReceipt = await send(a, `Reply exactly ${idleToken}.`)
  await until('idle inbox response', () => results(a).length >= 2 || a.closed)
  assert.ok(replyText(a).includes(idleToken))
  check('Idle message woke the existing process in the same session', { transport: idleReceipt })

  const rejected = `INVALID_${randomUUID()}`
  await send(a, `Reply exactly ${rejected}.`, { token: 'invalid-test-token' })
  await send(a, `Reply exactly ${rejected}.`, { frame: { session_id: randomUUID() } })
  await delay(1000)
  const barrier = `BARRIER_${randomUUID()}`
  await send(a, `Reply exactly ${barrier}.`)
  await until('negative test barrier', () => results(a).some((e) => e.result?.includes(barrier)))
  assert.ok(!replyText(a).includes(rejected))
  check('Bad authentication and wrong destination session did not reach the model')

  const startEvent = a.events.length
  await send(
    a,
    'Write a numbered list of exactly 150 short neutral words, one per line, starting with BUSY_PROBE. No tools.',
  )
  await until('active generation', () =>
    a.events
      .slice(startEvent)
      .some((e) => e.type === 'stream_event' && e.event?.type === 'content_block_delta'),
  )
  const busyToken = `QUEUED_${randomUUID()}`
  await send(a, `After the current response, reply exactly ${busyToken}.`)
  await until('busy delivery response', () => replyText(a).includes(busyToken))
  await until('busy delivery final', () => results(a).some((e) => e.result?.includes(busyToken)))
  check('Message delivered while the existing runtime was generating', {
    resultCount: results(a).length,
  })

  assert.ok(a.events.filter((e) => e.session_id).every((e) => e.session_id === a.id))
  assert.equal(a.closed, false)
  check('One process and unchanged native session ID throughout')
  const duplicateId = randomUUID()
  const duplicateMarker = `DUPLICATE_${randomUUID()}`
  await send(a, `Reply exactly ${duplicateMarker}.`, { frame: { uuid: duplicateId } })
  await until('first duplicate probe', () =>
    results(a).some((e) => e.result?.includes(duplicateMarker)),
  )
  const duplicateCount = results(a).length
  await send(a, `Reply exactly ${duplicateMarker}.`, { frame: { uuid: duplicateId } })
  await delay(8000)
  const duplicateBarrier = `DUP_BARRIER_${randomUUID()}`
  await send(a, `Reply exactly ${duplicateBarrier}.`)
  await until('duplicate probe barrier', () =>
    results(a).some((e) => e.result?.includes(duplicateBarrier)),
  )
  check('Repeated message UUID observation', {
    repeatedUuidProducedAnotherResult: results(a)
      .slice(duplicateCount)
      .some((e) => e.result?.includes(duplicateMarker)),
  })
  const previousRegistration = registrations.get(a.id)
  a.child.stdin.end()
  await until('clean process shutdown', () => a.closed, 15000)
  const stale = await send(a, 'STALE_PROBE')
  assert.ok(stale.error)
  check('Closed runtime rejects stale endpoint delivery', { transport: stale })

  registrations.delete(a.id)
  const resumed = start('threadlight-inbox-probe-resumed', { id: a.id, resume: true })
  await until(
    'resumed process ready',
    () => results(resumed).length === 1 && registrations.has(resumed.id),
  )
  assert.notEqual(registrations.get(resumed.id).token, previousRegistration.token)
  const oldTokenMarker = `OLD_TOKEN_${randomUUID()}`
  await send(resumed, `Reply exactly ${oldTokenMarker}.`, { token: previousRegistration.token })
  const resumedMarker = `RESUMED_${randomUUID()}`
  await send(resumed, `Reply exactly ${resumedMarker}.`)
  await until('fresh resumed inbox response', () =>
    results(resumed).some((e) => e.result?.includes(resumedMarker)),
  )
  assert.ok(!replyText(resumed).includes(oldTokenMarker))
  check('Sequential restart preserves chat ID, rotates token, rejects previous token', {
    sessionId: resumed.id,
    oldPid: a.child.pid,
    newPid: resumed.child.pid,
  })
  resumed.child.stdin.end()
  await until('resumed shutdown', () => resumed.closed, 20000)

  for (const inbound of ['refuse', 'hold']) {
    const restricted = start(`threadlight-inbox-probe-${inbound}`, { inbound })
    await until(
      `${inbound} ready`,
      () => results(restricted).length === 1 && registrations.has(restricted.id),
    )
    const marker = `${inbound.toUpperCase()}_${randomUUID()}`
    const receipt = await send(restricted, `Reply exactly ${marker}.`)
    await delay(1000)
    const stdinBarrier = `STDIN_${randomUUID()}`
    restricted.child.stdin.write(
      JSON.stringify({
        type: 'user',
        message: { role: 'user', content: `Reply exactly ${stdinBarrier}.` },
      }) + '\n',
    )
    await until(`${inbound} stdin barrier`, () =>
      results(restricted).some((e) => e.result?.includes(stdinBarrier)),
    )
    assert.ok(!replyText(restricted).includes(marker))
    check(`Explicit ${inbound} prevents model delivery despite valid token`, { transport: receipt })
    restricted.child.stdin.end()
    await until(`${inbound} shutdown`, () => restricted.closed, 20000)
  }
  report.passed = true
} catch (error) {
  report.passed = false
  report.error = error.stack
  console.error(error.message)
  process.exitCode = 1
} finally {
  for (const r of runtimes) if (!r.closed) r.child.kill()
  await delay(300)
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  report.sessions = runtimes.map((r) => ({
    id: r.id,
    pid: r.child.pid,
    closed: r.closed,
    exitCode: r.exitCode,
    stderr: r.stderr,
    events: r.events.filter((e) => ['assistant', 'result', 'user'].includes(e.type)),
  }))
  report.hookEvents = hookEvents
  const redact = (text) => {
    for (const credential of credentials) text = text.replaceAll(credential, '[REDACTED]')
    return text
  }
  // Native debug logs include hook command arguments; remove the test registration key.
  for (const r of runtimes)
    for (const suffix of ['debug.log', 'settings.json']) {
      const path = join(root, `${r.name}.${suffix}`)
      if (existsSync(path)) writeFileSync(path, redact(readFileSync(path, 'utf8')))
    }
  writeFileSync(join(root, 'proof.json'), redact(JSON.stringify(report, null, 2)))
  console.log(`Evidence: ${join(root, 'proof.json')}`)
}
