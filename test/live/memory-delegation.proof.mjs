// Real delivery acceptance test: fresh throwaway chats only, one bounded assignment each.
import { createRequire } from 'node:module'
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
if (process.env.THREADLIGHT_MEMORY_LIVE !== '1')
  throw new Error('Explicit disposable-chat authorization is required.')
const require = createRequire(import.meta.url),
  ts = require('typescript')
require.extensions['.ts'] = (module, filename) =>
  module._compile(
    ts.transpileModule(readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    filename,
  )
const { MemoryStore } = require('../../src/main/memory/store.ts'),
  { MemoryServer } = require('../../src/main/memory/server.ts'),
  { MemoryDispatcher } = require('../../src/main/memory/dispatcher.ts')
const { RelayService } = require('../../src/main/relayService.ts'),
  { findClaudeCli, isHeld } = require('../../src/main/relay.ts'),
  { CodexRelayService, findCodexCli } = require('../../src/main/codex/relay.ts'),
  { defaultPaths, codexPaths } = require('../../src/main/sessions/paths.ts')
const directory = mkdtempSync(join(tmpdir(), 'threadlight-delegation-proof-')),
  store = new MemoryStore(join(directory, 'memory.sqlite')),
  server = new MemoryServer(store)
const execute = (input) => store.execute({ ...input, operationId: randomUUID() })
const seed = (cli, args) =>
  new Promise((done) => {
    const env = { ...process.env }
    for (const key of [
      'CODEX_THREAD_ID',
      'CODEX_TURN_ID',
      'CODEX_INTERNAL_ORIGINATOR_OVERRIDE',
      'CLAUDECODE',
    ])
      delete env[key]
    const child = spawn(cli.command, [...cli.prefixArgs, ...args], {
      cwd: directory,
      env,
      windowsHide: true,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let out = '',
      err = ''
    const timer = setTimeout(() => child.kill(), 90000)
    child.stdout.on('data', (c) => (out += c))
    child.stderr.on('data', (c) => (err += c))
    child.stdin.on('error', () => {})
    child.stdin.end(
      'This is an authorised disposable Threadlight integration test chat. Reply only READY. Do not use any tools or perform other work.',
    )
    child.once('error', (e) => {
      clearTimeout(timer)
      done({ error: e.message })
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      done({ code, out, err })
    })
  })
const results = []
try {
  await server.start(0)
  for (const provider of ['claude', 'codex']) {
    const cli = await (provider === 'claude'
      ? findClaudeCli(defaultPaths())
      : findCodexCli(codexPaths()))
    if (!cli) {
      results.push({ provider, error: 'CLI missing' })
      continue
    }
    const nativeId = randomUUID()
    console.log(`Creating disposable ${provider} assignment recipient…`)
    const result = await seed(
      cli,
      provider === 'claude'
        ? ['-p', '--session-id', nativeId, '--output-format', 'json', '--tools', '']
        : ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', '--json', '-'],
    )
    if (result.code !== 0) {
      results.push({ provider, error: 'Seed failed', detail: result.err ?? result.error })
      continue
    }
    const id =
      provider === 'claude'
        ? nativeId
        : 'codex:' +
          result.out
            .split('\n')
            .map((line) => {
              try {
                return JSON.parse(line)
              } catch {
                return {}
              }
            })
            .find((e) => e.type === 'thread.started')?.thread_id
    const target = {
      id,
      provider,
      cwd: directory,
      live: false,
      state: 'idle',
      permissionMode: 'default',
      title: 'Disposable shared-memory delivery proof',
    }
    const space = execute({ action: 'create_space', title: `Disposable ${provider} delegation` })
    const folder = execute({
      action: 'ensure_folder',
      spaceId: space.id,
      title: 'Evidence',
      description: 'Synthetic proof only',
      reason: 'Delivery acceptance',
    }).folder
    const item = execute({
      action: 'create_item',
      folderId: folder.id,
      title: 'Exact assignment input',
      body: 'The synthetic release colour is indigo; verification code TL-DELEGATE-638.',
    })
    execute({
      action: 'create_grant',
      spaceId: space.id,
      title: `Enrolled ${provider} throwaway`,
      assignee: id,
      readOnly: false,
      createFolders: true,
    })
    const task = execute({
      action: 'create_task',
      folderId: folder.id,
      title: 'Verify the saved release colour',
      assignee: id,
      inputs: [{ itemId: item.id, revision: 1 }],
      body: 'This is a bounded integration test. Use only the Threadlight memory tools. Read the pinned input, publish one note containing the exact synthetic colour and verification code, then submit that saved result for this assignment. Do not use shell, files, other tools, other chats, or delegate. Finish once the result is submitted.',
    })
    let receipt
    const publish = () => {
      for (const status of relays.list()) receipt?.(status)
    }
    const relays =
      provider === 'claude'
        ? new RelayService(
            async () => ({
              cli,
              isHeld: (session) => isHeld(defaultPaths().liveSessionsDir, session),
            }),
            (key) => (key === id ? target : undefined),
            publish,
          )
        : new CodexRelayService(codexPaths(), (key) => (key === id ? target : undefined), publish)
    const dispatcher = new MemoryDispatcher(
      store,
      {
        find: (key) => (key === id ? target : undefined),
        statuses: () => relays.list(),
        watch: (listener) => {
          receipt = listener
          return () => {
            receipt = undefined
          }
        },
        send: (...args) => relays.send(...args),
      },
      () => server.endpoint,
    )
    execute({
      action: 'update_space',
      id: space.id,
      paused: false,
      durationMinutes: 5,
      maxDispatches: 1,
    })
    execute({ action: 'authorize_task', id: task.id })
    const deadline = Date.now() + 180000
    while (Date.now() < deadline) {
      dispatcher.tick()
      const current = store.tasks().find((t) => t.id === task.id)
      const status = relays.list().find((s) => s.sessionId === id)
      if (
        ['unknown', 'blocked'].includes(current.state) ||
        (['submitted', 'completed'].includes(current.state) &&
          ['replied', 'failed'].includes(status?.state))
      )
        break
      await new Promise((done) => setTimeout(done, 1000))
    }
    const current = store.tasks().find((t) => t.id === task.id)
    const verified =
      current.state === 'submitted' &&
      current.outputs.some((ref) =>
        store.read({}, ref.itemId, ref.revision).revision.body.includes('TL-DELEGATE-638'),
      )
    if (verified) execute({ action: 'resolve_task', id: task.id })
    results.push({
      provider,
      chat: id,
      verified,
      state: store.tasks().find((t) => t.id === task.id).state,
      reason: current.reason,
      relay: relays.list().map((s) => ({ state: s.state, detail: s.detail })),
    })
    console.log(
      `${provider}: ${verified ? 'saved input → background delivery → result → human acceptance passed' : current.state}`,
    )
  }
  writeFileSync(join(directory, 'summary.json'), JSON.stringify(results, null, 2))
  console.log(JSON.stringify({ directory, results }, null, 2))
} finally {
  server.close()
  store.close()
}
