// Opt-in installed-runtime proof for observing an active question without answering it.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
const require = createRequire(import.meta.url),
  ts = require('typescript')
if (process.env.THREADLIGHT_READ_ATTENTION !== '1') {
  console.log('Skipped')
  process.exit(0)
}
const root = process.env.THREADLIGHT_EVIDENCE_DIR
assert.ok(root)
await mkdir(root, { recursive: true })
require.extensions['.ts'] = (module, file) =>
  module._compile(
    ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 },
    }).outputText,
    file,
  )
const { AgentService } = require('../../src/main/agent/agentService.ts'),
  { CodexClient } = require('../../src/main/agent/codexClient.ts')
const { ThreadReadService } = require('../../src/main/threadRead/service.ts'),
  { CodexReadAdapter } = require('../../src/main/threadRead/codex.ts')
const { codexPaths, defaultPaths } = require('../../src/main/sessions/paths.ts'),
  { DEFAULT_SETTINGS } = require('../../src/shared/settings.ts')
const cli = { command: process.env.THREADLIGHT_CODEX_CLI, prefixArgs: [] }
const target = new AgentService({
  workspace: root,
  index: join(root, 'target.json'),
  claudeProjects: defaultPaths().projectsDir,
  settings: () => ({
    ...DEFAULT_SETTINGS,
    agentProvider: 'codex',
    agentCodexModel: 'gpt-6-luna',
    agentLifetimeMinutes: 0,
  }),
  snapshot: () => ({
    sessions: [],
    workspaces: [],
    allWorkspaces: [],
    currentWorkspace: null,
    currentThreadId: null,
  }),
  cli: async () => cli,
  onChange: () => {},
  onRateLimit: () => {},
})
const sources = new ThreadReadService([new CodexReadAdapter(codexPaths())], () => ['codex']),
  scope = sources.open(),
  report = { startedAt: new Date().toISOString() }
const wait = async () => {
  const until = Date.now() + 120000
  while (Date.now() < until && !['waiting', 'ready', 'error'].includes(target.current.status))
    await new Promise((r) => setTimeout(r, 200))
}
try {
  assert.equal(
    (
      await target.send(
        'Use request_user_input to ask me to choose between Amber and Cyan. Wait for my answer before continuing. Do not choose for me.',
      )
    ).ok,
    true,
  )
  await wait()
  assert.equal(
    target.current.status,
    'waiting',
    target.current.error ?? 'Expected a native question',
  )
  const native = new CodexClient(cli, root),
    title = `Synthetic pending colour ${Date.now()}`
  try {
    await native.initialize()
    await native.request('thread/name/set', { threadId: target.current.sessionId, name: title })
  } finally {
    native.close()
  }
  const found = await sources.find(scope, { query: title, provider: 'codex' })
  assert.equal(found.resolution, 'unique')
  const request = target.current.requests[0],
    before = await sources.read(scope, { threadRef: found.resolvedRef })
  report.waiting = before
  assert.ok(before.attention, 'Read must expose the observed question')
  assert.equal(target.current.status, 'waiting')
  assert.equal(target.current.requests[0].id, request.id)
  const question = request.questions[0]
  assert.equal(
    target.respond(request.id, {
      action: 'answer',
      answers: { [question.id]: question.options[0] },
    }).ok,
    true,
  )
  await wait()
  assert.equal(target.current.status, 'ready')
  const after = await sources.read(scope, {
    threadRef: found.resolvedRef,
    sinceObservationId: before.observationId,
  })
  report.completed = after
  assert.equal(after.attention, null)
  assert.equal(
    (
      await target.send(
        'Write a numbered list of 150 distinct imaginary flower names. Start immediately and do not use tools.',
      )
    ).ok,
    true,
  )
  const streamingUntil = Date.now() + 30000
  while (Date.now() < streamingUntil) {
    const observed = await sources.read(scope, { threadRef: found.resolvedRef })
    if (observed.status.state === 'working') {
      report.streaming = observed
      assert.ok(
        !observed.latestCompletedReply ||
          observed.latestCompletedReply.turnId !== observed.status.turnId,
        'An active turn must not be reported as a completed reply',
      )
      assert.equal(target.current.status, 'working')
      break
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  assert.ok(report.streaming, 'Must observe the actual runtime while its next reply is active')
  await wait()
  assert.equal(target.current.status, 'ready')
  report.pass = true
  console.log(
    'PASS: read a real pending question without resolving it, then observed its resolution.',
  )
} catch (error) {
  report.error = error.message
  console.error(error.message)
  process.exitCode = 1
} finally {
  await target.close()
  await writeFile(join(root, 'attention-report.json'), JSON.stringify(report, null, 2))
}
