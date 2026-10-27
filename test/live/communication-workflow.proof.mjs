// Installed Codex runtime, production communication service/MCP, isolated test project.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
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
  { MemoryServer } = require('../../src/main/memory/server.ts'),
  { CommunicationService } = require('../../src/main/communication/service.ts')
const { findCodexCli, sendCodex } = require('../../src/main/codex/relay.ts'),
  { codexPaths } = require('../../src/main/sessions/paths.ts'),
  { codexHeld } = require('../../src/main/codex/live.ts')
const { codexCommunicationAdmitted } = require('../../src/main/communication/admission.ts')
const paths = codexPaths(),
  root = mkdtempSync(join(tmpdir(), 'threadlight-workflow-proof-')),
  memory = new MemoryStore(join(root, 'memory.sqlite')),
  server = new MemoryServer(memory)
const report = { root, checks: [] },
  human = { id: 'human', kind: 'human' }
let service
const execute = (input) => memory.execute({ operationId: randomUUID(), ...input })
const waitFor = async (check, timeout = 180000) => {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    if (check()) return
    await service.tick()
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('Workflow timeout')
}
try {
  const cli = await findCodexCli(paths)
  assert.ok(await codexCommunicationAdmitted(cli), 'Installed binary must pass ownership admission')
  async function seed(role) {
    const env = { ...process.env }
    for (const key of ['CODEX_THREAD_ID', 'CODEX_TURN_ID', 'CODEX_INTERNAL_ORIGINATOR_OVERRIDE'])
      delete env[key]
    const output = await new Promise((resolve, reject) => {
      const child = spawn(
        cli.command,
        [
          ...cli.prefixArgs,
          'exec',
          '--skip-git-repo-check',
          '--sandbox',
          'read-only',
          '--json',
          '--model',
          'gpt-6.1-sol',
          '-',
        ],
        { cwd: root, env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
      )
      let out = '',
        err = ''
      const timer = setTimeout(() => {
        child.kill()
        reject(new Error('Seed timed out'))
      }, 90000)
      child.stdout.on('data', (c) => (out += c))
      child.stderr.on('data', (c) => (err += c))
      child.stdin.on('error', () => {})
      child.stdin.end('Disposable Threadlight workflow proof. Say READY only. No tools.')
      child.once('error', reject)
      child.once('close', (code) => {
        clearTimeout(timer)
        if (code === 0) resolve(out)
        else reject(new Error(err))
      })
    })
    const id = output
      .split('\n')
      .flatMap((line) => {
        try {
          return [JSON.parse(line)]
        } catch {
          return []
        }
      })
      .find((e) => e.type === 'thread.started')?.thread_id
    assert.ok(id)
    return {
      id: `codex:${id}`,
      provider: 'codex',
      title: role,
      cwd: root,
      model: 'gpt-6.1-sol',
      live: false,
    }
  }
  console.log('Creating two disposable Codex participants…')
  const chats = [await seed('Build'), await seed('Review')]
  const space = execute({ action: 'create_space', title: 'Workflow proof' })
  execute({
    action: 'update_space',
    id: space.id,
    mode: 'automatic',
    paused: false,
    durationMinutes: 15,
    maxDispatches: 6,
  })
  const folder = execute({
    action: 'ensure_folder',
    spaceId: space.id,
    title: 'Outputs',
    description: 'Proof outputs',
    reason: 'Test',
  }).folder
  for (const chat of chats)
    execute({
      action: 'create_grant',
      spaceId: space.id,
      title: chat.title,
      assignee: chat.id,
      readOnly: false,
    })
  service = new CommunicationService(memory.communications, {
    destinations: async (target) =>
      Promise.all(
        chats
          .filter((c) => !target || c.id === target)
          .map(async (c) => ({
            id: c.id,
            title: c.title,
            provider: 'codex',
            hostId: 'local',
            workspace: root,
            model: c.model,
            state: 'idle',
            generation: 'ownership-admitted-test',
            send: !(await codexHeld(paths.locks, c.id.slice(6))),
            queue: true,
            reason: 'Native writer is busy',
            observedAt: Date.now(),
          })),
      ),
    authorize: (a, id) => memory.authorizeCommunication(a, id),
    input: (a, id, r) => memory.communicationInput(a, id, r),
    folder: (s, f) => memory.communicationFolder(s, f),
    project: (id) => ({ ...memory.space(id), root }),
    deliver: async (message, destination, accepted) => {
      console.log(`Dispatch ${chats.find((c) => c.id === destination.id).title}: ${message.id}`)
      const chat = chats.find((c) => c.id === destination.id),
        context = {
          attemptId: message.deliveries[0].attemptId,
          url: server.endpoint,
          token: memory.prepareCommunicationDelivery(space.id, chat.id),
        }
      const result = await sendCodex(
        chat,
        `Authorized disposable workflow proof. Only use Threadlight tools. Do not run shell or edit repository files. Project ${space.id}.\n${message.body}`,
        cli,
        () => codexHeld(paths.locks, chat.id.slice(6)),
        () => accepted(),
        context,
      )
      if (!result.ok) throw new Error(result.reason)
      return { reply: result.reply }
    },
  })
  memory.communicationService = service
  const roles = chats.map((c) => ({
    id: randomUUID(),
    target: c.id,
    role: c.title,
    model: c.model,
    communicate: true,
    requestWork: true,
  }))
  service.configure(
    {
      id: randomUUID(),
      spaceId: space.id,
      revision: 1,
      mode: 'automatic',
      paused: false,
      participants: roles,
      maxConcurrent: 2,
      maxDispatches: 6,
      expiresAt: Date.now() + 900000,
      recover: false,
      acceptBy: 'human',
    },
    0,
    human,
  )
  await server.start(0)
  const first = randomUUID(),
    second = randomUUID()
  const planConnection = server.connectCommunication(() => ({
    id: 'proof-brainstorm',
    kind: 'agent',
    spaceId: space.id,
    target: chats[0].id,
  }))
  console.log('Native coordinator proposes a two-step plan using production tools…')
  const common = {
    spaceId: space.id,
    acceptance: 'Save the required output and submit it',
    resources: [],
    inputs: [],
    folderId: folder.id,
    workflowRevision: 1,
  }
  const specs = [
    {
      ...common,
      id: first,
      title: 'Create evidence',
      roleId: roles[0].id,
      dependsOn: [],
      brief: `Create a memory note in folder ${folder.id} titled Workflow implementation with body WORKFLOW-BUILD-41. Then submit this assignment result with its saved item ID using threadlight_submit_assignment_result. Do not request more work.`,
    },
    {
      ...common,
      id: second,
      title: 'Review accepted evidence',
      roleId: roles[1].id,
      dependsOn: [first],
      brief: `Read workflow assignment ${first}, retrieve its saved output with memory_read and verify WORKFLOW-BUILD-41. Save a note in folder ${folder.id} titled Workflow review with body WORKFLOW-REVIEW-72 and the verified marker. Submit this assignment result with its saved item ID. No further tasks.`,
    },
  ]
  const plan = await sendCodex(
    chats[0],
    `Use only threadlight_propose_assignment to propose these TWO exact assignments in order, with a fresh operationId each. Do not perform the assignments now. ${JSON.stringify(specs)}`,
    cli,
    () => codexHeld(paths.locks, chats[0].id.slice(6)),
    () => {},
    { attemptId: randomUUID(), url: planConnection.endpoint, token: planConnection.token },
  )
  assert.ok(plan.ok, plan.reason)
  planConnection.close()
  assert.equal(memory.communications.list('assignment').length, 2)
  await service.tick()
  await waitFor(() => memory.communications.get('assignment', first).state === 'submitted')
  assert.equal(
    memory.communications.get('assignment', second).messageId,
    undefined,
    'review must not start merely because a result was submitted',
  )
  await waitFor(
    () =>
      !memory.communications
        .list('message')
        .some((m) => m.deliveries.some((d) => ['submitting', 'accepted'].includes(d.phase))),
  )
  report.checks.push('Native planning, background implementation and acceptance gate passed')
  await service.execute(
    'accept_assignment',
    {
      operationId: randomUUID(),
      id: first,
      reason: 'Proof verified the saved implementation marker',
    },
    human,
  )
  await service.tick()
  await waitFor(() => memory.communications.get('assignment', second).state === 'submitted')
  await waitFor(
    () =>
      !memory.communications
        .list('message')
        .some((m) => m.deliveries.some((d) => ['submitting', 'accepted'].includes(d.phase))),
  )
  await service.execute(
    'accept_assignment',
    {
      operationId: randomUUID(),
      id: second,
      reason: 'Proof verified the review output and original marker',
    },
    human,
  )
  const review = memory.communications.get('assignment', second)
  const text = memory.read({}, review.outputs[0].itemId).revision.body
  assert.match(text, /WORKFLOW-REVIEW-72/)
  assert.match(text, /WORKFLOW-BUILD-41/)
  report.checks.push(
    'Dependency released only after acceptance; native reviewer read saved output and completed',
  )
  report.assignments = memory.communications.list('assignment')
  report.messages = memory.communications.list('message')
  report.events = memory.communications.events()
  report.passed = true
} catch (error) {
  report.error = error.stack
  process.exitCode = 1
} finally {
  service?.close()
  server.close()
  memory.close()
  writeFileSync(join(root, 'workflow.json'), JSON.stringify(report, null, 2))
  console.log(
    JSON.stringify({ root, passed: report.passed ?? false, error: report.error }, null, 2),
  )
}
