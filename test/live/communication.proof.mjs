// Real authenticated peer MCP calls. Disposable chats, private test memory, no native desktop takeover.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
if (process.env.THREADLIGHT_COMMUNICATION_PROOF !== '1')
  throw new Error('Opt in to disposable-chat proofs.')
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
const { findClaudeCli, relayMessage } = require('../../src/main/relay.ts'),
  { findCodexCli, sendCodex } = require('../../src/main/codex/relay.ts')
const { defaultPaths, codexPaths } = require('../../src/main/sessions/paths.ts')
const root = mkdtempSync(join(tmpdir(), 'threadlight-peer-proof-'))
const store = new MemoryStore(join(root, 'memory.sqlite')),
  server = new MemoryServer(store)
const execute = (input) => store.execute({ operationId: randomUUID(), ...input })
const env = { ...process.env }
for (const key of [
  'CODEX_THREAD_ID',
  'CODEX_TURN_ID',
  'CODEX_INTERNAL_ORIGINATOR_OVERRIDE',
  'CLAUDECODE',
])
  delete env[key]
async function seed(provider, cli) {
  const id = randomUUID()
  const args =
    provider === 'claude'
      ? ['-p', '--session-id', id, '--output-format', 'json', '--tools', '']
      : ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', '--json', '-']
  const result = await new Promise((resolve, reject) => {
    const p = spawn(cli.command, [...cli.prefixArgs, ...args], {
      cwd: root,
      env,
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let out = '',
      err = ''
    const timer = setTimeout(() => {
      p.kill()
      reject(new Error('Seed timeout'))
    }, 90000)
    p.stdout.on('data', (c) => {
      out += c
    })
    p.stderr.on('data', (c) => {
      err += c
    })
    p.stdin.on('error', () => {})
    p.stdin.end('Disposable Threadlight communication proof. Reply READY. No tools.')
    p.on('error', reject)
    p.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(out)
      else reject(new Error(err))
    })
  })
  const native =
    provider === 'claude'
      ? id
      : result
          .split('\n')
          .flatMap((line) => {
            try {
              return [JSON.parse(line)]
            } catch {
              return []
            }
          })
          .find((e) => e.type === 'thread.started')?.thread_id
  assert.ok(native)
  return {
    id: provider === 'claude' ? native : `codex:${native}`,
    provider,
    title: `Peer proof ${provider}`,
    cwd: root,
    live: false,
    state: 'idle',
    model: null,
    permissionMode: 'default',
  }
}
const report = {
  root,
  transport: 'explicit isolated native turns; automatic wakeup is tested separately',
  checks: [],
}
try {
  const cli = {
    claude: await findClaudeCli(defaultPaths()),
    codex: await findCodexCli(codexPaths()),
  }
  assert.ok(cli.claude && cli.codex)
  const chats = {}
  for (const provider of ['claude', 'codex']) {
    console.log(`Creating ${provider} peer fixture…`)
    chats[provider] = await seed(provider, cli[provider])
  }
  const space = execute({ action: 'create_space', title: 'Disposable peer exchange' })
  const folder = execute({
    action: 'ensure_folder',
    spaceId: space.id,
    title: 'Results',
    description: 'Proof outputs',
    reason: 'Test',
  }).folder
  for (const provider of ['claude', 'codex'])
    execute({
      action: 'create_grant',
      spaceId: space.id,
      title: provider,
      assignee: chats[provider].id,
      readOnly: false,
    })
  const service = new CommunicationService(store.communications, {
    destinations: async (target) =>
      Object.values(chats)
        .filter((c) => !target || c.id === target)
        .map((c) => ({
          id: c.id,
          title: c.title,
          provider: c.provider,
          hostId: 'local',
          workspace: root,
          model: 'runtime-default',
          state: 'idle',
          generation: 'proof',
          send: false,
          queue: true,
          reason: 'Fixture is driven explicitly',
          observedAt: Date.now(),
        })),
    deliver: async () => {
      throw new Error('This proof must not wake native chats automatically.')
    },
    authorize: (actor, id) => store.authorizeCommunication(actor, id),
    input: (actor, id, revision) => store.communicationInput(actor, id, revision),
    project: (id) => store.space(id),
  })
  store.communicationService = service
  service.configure(
    {
      id: randomUUID(),
      spaceId: space.id,
      revision: 1,
      mode: 'manual',
      paused: true,
      participants: Object.values(chats).map((c) => ({
        id: randomUUID(),
        target: c.id,
        role: c.provider,
        model: 'runtime-default',
        communicate: true,
        requestWork: true,
      })),
      maxConcurrent: 2,
      maxDispatches: 10,
      expiresAt: Date.now() + 600000,
      recover: false,
      acceptBy: 'human',
    },
    0,
    { id: 'human', kind: 'human' },
  )
  await server.start(0)
  async function turn(provider, prompt) {
    console.log(`${provider}: ${prompt.slice(0, 70)}…`)
    const context = {
      attemptId: randomUUID(),
      url: server.endpoint,
      token: store.prepareCommunicationDelivery(space.id, chats[provider].id),
    }
    const input = `Authorized disposable communication proof. Use only the provided Threadlight tools. Do not use shell or external apps. Exact project: ${space.id}. Your native identity is ${chats[provider].id}.\n${prompt}`
    const result =
      provider === 'claude'
        ? await relayMessage(
            chats[provider],
            input,
            { cli: cli.claude, isHeld: async () => false },
            () => {},
            context,
          )
        : await sendCodex(
            chats[provider],
            input,
            cli.codex,
            async () => false,
            () => {},
            context,
          )
    assert.ok(result.ok, result.reason)
    report.checks.push({ provider, reply: result.reply })
  }
  await turn(
    'claude',
    `Use threadlight_get_destination then threadlight_send_message to send exactly PEER-CLAUDE-91 to ${chats.codex.id}. Kind question. Use a fresh operationId UUID. Do not just describe a send.`,
  )
  const sent = store.communications
    .list('message')
    .find((m) => m.senderTarget === chats.claude.id && m.body === 'PEER-CLAUDE-91')
  assert.ok(sent)
  await turn(
    'codex',
    `Use threadlight_read_inbox. Reply to message ${sent.id} by calling threadlight_send_message targeting ${chats.claude.id}, replyTo ${sent.id}, kind answer, body PEER-CODEX-37. Then independently send a NEW kind question message to the same Claude chat with body CODEX-INITIATED-64. Use fresh operation IDs.`,
  )
  assert.ok(
    store.communications
      .list('message')
      .some((m) => m.replyTo === sent.id && m.body === 'PEER-CODEX-37'),
  )
  const other = store.communications.list('message').find((m) => m.body === 'CODEX-INITIATED-64')
  assert.ok(other)
  await turn(
    'claude',
    `Read your inbox. Reply to ${other.id} with kind answer, body CLAUDE-RESPONSE-82, targeting ${chats.codex.id}. Then use threadlight_ask_question to ask the HUMAN 'Choose proof colour' with choices ['blue','green'] in project ${space.id}. Finish after the tools return.`,
  )
  assert.ok(
    store.communications
      .list('message')
      .some((m) => m.replyTo === other.id && m.body === 'CLAUDE-RESPONSE-82'),
  )
  const question = store.communications
    .list('question')
    .find((q) => q.state === 'pending' && q.audience === 'human')
  assert.ok(question)
  await service.execute(
    'answer_request',
    { operationId: randomUUID(), id: question.id, generation: question.generation, answer: 'blue' },
    { id: 'human', kind: 'human' },
  )
  await turn(
    'claude',
    `Read the inbox to retrieve the answer to question ${question.id}. Save a memory_create_item note in folder ${folder.id}, title 'Peer proof result', body containing the exact received colour and PEER-FINAL-55. Then send a kind result message to ${chats.codex.id} containing PEER-FINAL-55 and the chosen colour. Do not invent the colour; read it.`,
  )
  assert.ok(
    store
      .snapshot()
      .items.some(
        (i) =>
          i.title === 'Peer proof result' && store.read({}, i.id).revision.body.includes('blue'),
      ),
  )
  assert.ok(
    store.communications
      .list('message')
      .some(
        (m) => m.kind === 'result' && m.body.includes('PEER-FINAL-55') && m.body.includes('blue'),
      ),
  )
  report.messages = store.communications.list('message')
  report.questions = store.communications.list('question')
  report.passed = true
  service.close()
} catch (error) {
  report.error = error.stack
  process.exitCode = 1
} finally {
  writeFileSync(join(root, 'communication.json'), JSON.stringify(report, null, 2))
  console.log(
    JSON.stringify({ root, passed: report.passed ?? false, error: report.error }, null, 2),
  )
  server.close()
  store.close()
}
