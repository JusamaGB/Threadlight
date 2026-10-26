// Actual native runtime + packaged MCP bridge + production registration/claims/outbox.
// Explicit opt-in; disposable chat and project only. This is NOT Desktop UI sign-off.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
if (
  process.env.THREADLIGHT_COMMUNICATION_PROOF !== '1' ||
  process.env.THREADLIGHT_CLAUDE_WAKEUP_TEST !== '1'
)
  throw new Error('Opt in to disposable communication proof and Claude wakeup test mode.')
const require = createRequire(import.meta.url),
  ts = require('typescript')
require.extensions['.ts'] = (module, file) =>
  module._compile(
    ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 },
    }).outputText,
    file,
  )
const { MemoryStore } = require('../../src/main/memory/store.ts'),
  { MemoryServer } = require('../../src/main/memory/server.ts')
const { CommunicationService } = require('../../src/main/communication/service.ts')
const { findClaudeCli } = require('../../src/main/relay.ts'),
  { defaultPaths } = require('../../src/main/sessions/paths.ts')
const root = mkdtempSync(join(tmpdir(), 'threadlight-wakeup-')),
  id = randomUUID()
const store = new MemoryStore(join(root, 'memory.sqlite')),
  server = new MemoryServer(store)
const events = [],
  checks = [],
  report = { root, id, checks, desktopSignOff: false }
let child,
  service,
  closed = false,
  stderr = ''
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function until(label, predicate, timeout = 90000) {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error(`Timed out: ${label}`)
    await sleep(100)
  }
}
const check = (label) => {
  checks.push(label)
  console.log(label)
}
const user = (content) =>
  child.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content } }) + '\n')
try {
  await server.start(0)
  const space = store.execute({
    action: 'create_space',
    title: 'Disposable runtime wakeup proof',
    operationId: randomUUID(),
  })
  store.execute({
    action: 'update_space',
    id: space.id,
    paused: false,
    durationMinutes: 15,
    maxDispatches: 10,
    operationId: randomUUID(),
  })
  let nativeModel = ''
  service = new CommunicationService(store.communications, {
    authorize: (actor, space) => store.authorizeCommunication(actor, space),
    input: (actor, item, revision) => store.communicationInput(actor, item, revision),
    project: (space) => store.space(space),
    destinations: async (target) =>
      target === id
        ? [
            {
              id,
              title: 'Disposable Claude wakeup',
              provider: 'claude',
              hostId: 'local',
              workspace: root,
              state: 'idle',
              model: nativeModel,
              generation: 'unregistered',
              send: false,
              queue: false,
              reason: 'Unregistered',
              observedAt: Date.now(),
              ...(await server.runtime.destination(id)),
            },
          ]
        : [],
    deliver: (message, destination, accepted) =>
      server.runtime.deliver(message, destination, accepted),
  })
  store.communicationService = service
  const cli = await findClaudeCli(defaultPaths())
  assert.ok(cli)
  const env = { ...process.env, THREADLIGHT_MEMORY_URL: server.endpoint }
  delete env.CLAUDECODE
  child = spawn(
    cli.command,
    [
      ...cli.prefixArgs,
      '-p',
      '--session-id',
      id,
      '--name',
      'Threadlight automatic wakeup proof',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--verbose',
      '--tools',
      '',
      '--permission-mode',
      'dontAsk',
      '--setting-sources',
      '',
      '--strict-mcp-config',
      '--mcp-config',
      JSON.stringify({
        mcpServers: {
          threadlight: {
            command: process.execPath,
            args: [resolve('scripts/memory-bridge.mjs'), '--provider', 'claude'],
          },
        },
      }),
      '--allowedTools',
      'mcp__threadlight__memory_connect',
      'mcp__threadlight__memory_enable_wakeup',
      'mcp__threadlight__threadlight_claim_delivery',
      'mcp__threadlight__threadlight_complete_delivery',
      'mcp__threadlight__threadlight_ask_question',
    ],
    { cwd: root, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
  )
  let buffer = ''
  child.stdout.on('data', (chunk) => {
    buffer += chunk
    let n
    while ((n = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, n)
      buffer = buffer.slice(n + 1)
      try {
        events.push(JSON.parse(line))
      } catch {
        /* Ignore non-JSON native startup diagnostics. */
      }
    }
  })
  child.stderr.on('data', (chunk) => {
    stderr = (stderr + chunk).slice(-2000)
  })
  child.on('close', () => {
    closed = true
  })
  child.stdin.on('error', () => {})
  user(
    'Disposable Threadlight transport proof. Request a Threadlight connection using memory_connect with label "Native wakeup proof". Show the verification code and stop. No other tools or work.',
  )
  await until(
    'enrollment request and idle turn',
    () =>
      server.connections.list().some((c) => c.state === 'pending') &&
      events.some((e) => e.type === 'result'),
  )
  nativeModel = events.find((e) => e.type === 'system' && e.subtype === 'init')?.model
  assert.ok(nativeModel, 'Native model identity required')
  service.configure(
    {
      id: randomUUID(),
      spaceId: space.id,
      revision: 1,
      mode: 'manual',
      paused: false,
      participants: [
        {
          id: randomUUID(),
          target: id,
          role: 'Probe',
          model: nativeModel,
          communicate: true,
          requestWork: true,
        },
      ],
      maxConcurrent: 1,
      maxDispatches: 10,
      expiresAt: Date.now() + 3600000,
      recover: false,
      acceptBy: 'human',
    },
    0,
    { id: 'human', kind: 'human' },
  )
  const connection = server.connections.list().find((c) => c.state === 'pending')
  server.connections.approve(connection.id, {
    action: 'create_grant',
    spaceId: space.id,
    title: 'Disposable wakeup',
    assignee: id,
    readOnly: false,
  })
  user(
    `The test operator approved connection ${connection.id} for this disposable chat. Check memory_connect with that connectionId, then call memory_enable_wakeup with the same connectionId. Stop after reporting its result. You are authorized to handle subsequent harmless probe messages through claim_delivery and complete_delivery. Only a new claimed response permits execution.`,
  )
  await until(
    'registered native inbox',
    () => events.filter((e) => e.type === 'result').length >= 2,
  )
  const capability = await server.runtime.destination(id)
  assert.equal(capability?.send, true, JSON.stringify(capability))
  check('Real MCP bridge registered the existing native process through authenticated enrollment')
  const marker = `WAKEUP_RESULT_${randomUUID()}`
  const message = await service.execute(
    'send_message',
    {
      operationId: randomUUID(),
      targets: [id],
      spaceId: space.id,
      body: `Harmless probe. After claiming this delivery, complete it with body exactly ${marker}. No tools except the claim and completion tools.`,
      intent: 'send',
    },
    { id: 'human', kind: 'human' },
  )
  await until(
    'correlated completion',
    () => store.communications.get('message', message.id).deliveries[0].phase === 'completed',
  )
  const saved = store.communications.get('message', message.id)
  assert.equal(saved.deliveries[0].reply, marker)
  assert.ok(saved.deliveries[0].claim)
  assert.equal(saved.deliveries[0].generation, capability.generation)
  check('Automatic wakeup obtained a durable claim and correlated completion in the same chat')
  const replies = store.communications.list('message').filter((m) => m.replyTo === message.id)
  assert.equal(replies.length, 1)
  assert.equal(replies[0].body, marker)
  check('Result DM and claim acknowledgement are preserved in the human-review journal')
  const count = store.communications
    .events()
    .filter((e) => e.action === 'Recipient acknowledged delivery').length
  assert.equal(count, 1)
  assert.ok(events.filter((e) => e.session_id).every((e) => e.session_id === id))
  check('One native chat identity; one claim; no resume, copied chat or competing writer')
  const questionMessage = await service.execute(
    'send_message',
    {
      operationId: randomUUID(),
      targets: [id],
      spaceId: space.id,
      intent: 'send',
      body: `Harmless question-routing probe. After claiming this message, use threadlight_ask_question in space ${space.id}, audience human, body "Which probe colour?", choices ["blue","green"], originMessageId set to the claimed message ID, and a new operationId UUID. Complete this delivery with questionId set to the returned question ID and a short summary containing that ID, then yield. When its answer arrives in a later delivery, claim that delivery and complete it with body exactly QUESTION_RESULT_blue if the answer is blue. Use only Threadlight claim, ask_question and complete_delivery tools.`,
    },
    { id: 'human', kind: 'human' },
  )
  await until(
    'question and yielded delivery',
    () =>
      store.communications.list('question').some((q) => q.state === 'pending') &&
      store.communications.get('message', questionMessage.id).deliveries[0].phase === 'completed',
  )
  const question = store.communications.list('question').find((q) => q.state === 'pending')
  const answer = await service.execute(
    'answer_request',
    { operationId: randomUUID(), id: question.id, generation: question.generation, answer: 'blue' },
    { id: 'human', kind: 'human' },
  )
  await service.tick()
  await until(
    'answer delivery completion',
    () => store.communications.get('message', answer.messageId).deliveries[0].phase === 'completed',
  )
  assert.equal(
    store.communications.get('message', answer.messageId).deliveries[0].reply,
    'QUESTION_RESULT_blue',
  )
  check(
    'Native question, yield, human answer and automatic answer wakeup completed with distinct durable claims',
  )
  report.question = store.communications.get('question', question.id)
  report.message = saved
  report.replies = replies
  report.journal = store.communications.events()
  report.passed = true
} catch (error) {
  report.passed = false
  report.error = error.stack
  console.error(error.message)
  process.exitCode = 1
} finally {
  if (child && !closed) {
    child.stdin.end()
    await until('native shutdown', () => closed, 15000).catch(() => child.kill())
  }
  report.stderr = stderr
  report.journal = store.communications.events()
  report.messages = store.communications.list('message')
  report.toolCalls = events
    .filter((e) => e.type === 'assistant')
    .flatMap((e) => e.message?.content ?? [])
    .filter((c) => c.type === 'tool_use')
  report.nativeResults = events
    .filter((e) => e.type === 'result')
    .map((e) => ({ session_id: e.session_id, subtype: e.subtype, result: e.result }))
  service?.close()
  server.close()
  store.close()
  writeFileSync(join(root, 'proof.json'), JSON.stringify(report, null, 2))
  console.log(`Evidence: ${join(root, 'proof.json')}`)
}
