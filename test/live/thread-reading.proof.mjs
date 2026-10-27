// Opt-in: authenticated owned runtimes, synthetic named target chats, real local adapters.
// Evidence stays outside the repository. No physical microphone or speakers are opened.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const require = createRequire(import.meta.url),
  ts = require('typescript')
if (process.env.THREADLIGHT_READ_PROOF !== '1') {
  console.log('Skipped: opt in with THREADLIGHT_READ_PROOF=1.')
  process.exit(0)
}
for (const key of ['THREADLIGHT_CODEX_CLI', 'THREADLIGHT_CLAUDE_CLI', 'THREADLIGHT_EVIDENCE_DIR'])
  assert.ok(process.env[key], `Missing ${key}`)
require.extensions['.ts'] = (module, file) =>
  module._compile(
    ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 },
    }).outputText,
    file,
  )
const { AgentService } = require('../../src/main/agent/agentService.ts')
const { CodexClient } = require('../../src/main/agent/codexClient.ts')
const { ThreadReadService } = require('../../src/main/threadRead/service.ts')
const { ThreadReadServer } = require('../../src/main/threadRead/server.ts')
const { ClaudeReadAdapter } = require('../../src/main/threadRead/claude.ts')
const { CodexReadAdapter } = require('../../src/main/threadRead/codex.ts')
const { defaultPaths, codexPaths } = require('../../src/main/sessions/paths.ts')
const { DEFAULT_SETTINGS } = require('../../src/shared/settings.ts')
const root = process.env.THREADLIGHT_EVIDENCE_DIR
await mkdir(root, { recursive: true })
const targetFolder = join(root, 'targets')
await mkdir(targetFolder, { recursive: true })
const suffix = randomUUID().slice(0, 8),
  claudeTitle = `Synthetic reader Claude ${suffix}`,
  codexTitle = `Synthetic reader Codex ${suffix}`
const cli = { claude: process.env.THREADLIGHT_CLAUDE_CLI, codex: process.env.THREADLIGHT_CODEX_CLI }
const emptySnapshot = () => ({
  sessions: [],
  workspaces: [],
  allWorkspaces: [],
  currentWorkspace: null,
  currentThreadId: null,
})
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const waitReady = async (service, allowQuestions = false) => {
  const until = Date.now() + 240000
  while (Date.now() < until) {
    if (['ready', 'error', 'waiting'].includes(service.current.status)) break
    await sleep(200)
  }
  if (
    allowQuestions &&
    service.current.status === 'waiting' &&
    service.current.requests[0]?.kind === 'questions'
  )
    return
  assert.equal(
    service.current.status,
    'ready',
    service.current.error ?? `Agent state: ${service.current.status}`,
  )
}
let readProviders = ['claude', 'codex']
const sources = new ThreadReadService(
  [new ClaudeReadAdapter(defaultPaths()), new CodexReadAdapter(codexPaths())],
  () => readProviders,
)
const server = new ThreadReadServer(sources)
await server.start()
const services = [],
  report = { startedAt: new Date().toISOString(), checks: [] }
const make = (provider, name, reader = true) => {
  const service = new AgentService({
    workspace: join(root, name),
    index: join(root, `${name}.json`),
    claudeProjects: defaultPaths().projectsDir,
    settings: () => ({
      ...DEFAULT_SETTINGS,
      agentProvider: provider,
      agentLifetimeMinutes: 0,
      agentCodexModel: process.env.THREADLIGHT_READ_MODEL ?? 'gpt-6-luna',
    }),
    snapshot: emptySnapshot,
    cli: async (p) => ({ command: cli[p], prefixArgs: [] }),
    onChange: () => {},
    onRateLimit: () => {},
    ...(reader ? { threadReads: server } : {}),
  })
  services.push(service)
  return service
}
let native
try {
  console.log('Creating disposable synthetic targets through the installed providers.')
  const claudeId = randomUUID()
  await promisify(execFile)(
    cli.claude,
    [
      '-p',
      'Reply exactly: synthetic colour amber. Do not use tools.',
      '--model',
      'haiku',
      '--tools',
      '',
      '--strict-mcp-config',
      '--mcp-config',
      '{"mcpServers":{}}',
      '--session-id',
      claudeId,
      '--name',
      claudeTitle,
    ],
    { cwd: targetFolder, windowsHide: true, timeout: 120000, maxBuffer: 1024 * 1024 },
  )
  const target = make('codex', 'codex-target', false)
  assert.equal(
    (
      await target.send(
        `This synthetic chat is named ${codexTitle}. Reply exactly: synthetic colour violet. Do not use tools.`,
      )
    ).ok,
    true,
  )
  await waitReady(target)
  native = new CodexClient({ command: cli.codex, prefixArgs: [] }, targetFolder)
  await native.initialize()
  await native.request('thread/name/set', { threadId: target.current.sessionId, name: codexTitle })
  const scope = sources.open()
  for (const [provider, title] of [
    ['claude', claudeTitle],
    ['codex', codexTitle],
  ]) {
    let found = await sources.find(scope, { query: title, provider })
    while (found.resolution === 'incomplete' && found.nextCursor)
      found = await sources.find(scope, { query: title, provider, cursor: found.nextCursor })
    await writeFile(join(root, `${provider}-discovery.json`), JSON.stringify(found, null, 2))
    const selected = found.candidates.find((c) => c.title === title)
    assert.ok(selected, `${provider} exact target candidate`)
    if (found.resolution === 'incomplete')
      report.checks.push({
        case: `${provider}-coverage`,
        pass: true,
        note: 'Incomplete provider metadata was disclosed; test explicitly selects its known synthetic candidate.',
      })
    else assert.equal(found.resolution, 'unique')
    const read = await sources.read(scope, { threadRef: selected.threadRef })
    await writeFile(join(root, `${provider}-source.json`), JSON.stringify(read, null, 2))
    assert.ok(
      read.items.some((i) => /synthetic colour/.test(i.text)),
      `${provider} target content`,
    )
    report.checks.push({ case: `native-${provider}-source`, pass: true })
  }
  for (const provider of (process.env.THREADLIGHT_READ_HOSTS ?? 'codex,claude').split(',')) {
    console.log(`Testing hosted ${provider} against both real provider sources.`)
    const agent = make(provider, `${provider}-reader`)
    for (const [title, colour] of [
      [claudeTitle, 'amber'],
      [codexTitle, 'violet'],
    ]) {
      const before = agent.current.items.length
      assert.equal(
        (await agent.send(`What did the chat named "${title}" say last? Check it now.`)).ok,
        true,
      )
      await waitReady(agent)
      if (
        !agent.current.items.slice(before).some((i) => i.source?.tool === 'threadlight_read_thread')
      ) {
        const choices = agent.current.items
          .slice(before)
          .flatMap((i) => i.source?.result?.candidates ?? [])
        const selected = choices.find((c) => c.title === title)
        assert.ok(selected, 'No exact synthetic candidate offered for confirmation')
        assert.equal(
          (
            await agent.send(
              `I select the candidate titled "${title}" with threadRef ${selected.threadRef}. Read that chat now; disclose any source limitations.`,
            )
          ).ok,
          true,
        )
        await waitReady(agent)
      }
      const items = agent.current.items.slice(before)
      await writeFile(join(root, `${provider}-${colour}.json`), JSON.stringify(items, null, 2))
      assert.ok(
        items.some((i) => i.source?.tool === 'threadlight_read_thread'),
        'Missing actual read receipt',
      )
      assert.ok(
        items.some((i) => i.kind === 'agent' && i.text.toLowerCase().includes(colour)),
        `Missing expected ${colour} answer`,
      )
      assert.ok(
        !items.some((i) => i.kind === 'step' && /^(Opus|Sonnet) ·/.test(i.text)),
        'Ordinary lookup delegated to worker',
      )
      report.checks.push({ case: `${provider}-reads-${colour}`, pass: true })
    }
    assert.equal(
      (
        await target.send(
          'Update the synthetic colour to cyan. Reply exactly: synthetic colour cyan. Do not use tools.',
        )
      ).ok,
      true,
    )
    await waitReady(target)
    const before = agent.current.items.length
    assert.equal((await agent.send('And now? Check that same chat again.')).ok, true)
    await waitReady(agent)
    const items = agent.current.items.slice(before)
    await writeFile(join(root, `${provider}-followup.json`), JSON.stringify(items, null, 2))
    assert.ok(items.some((i) => i.source?.tool === 'threadlight_read_thread'))
    assert.ok(items.some((i) => i.kind === 'agent' && /cyan/i.test(i.text)))
    report.checks.push({ case: `${provider}-fresh-followup`, pass: true })
    // Restore the synthetic answer key for the other reader's first pass.
    assert.equal(
      (await target.send('Reply exactly: synthetic colour violet. Do not use tools.')).ok,
      true,
    )
    await waitReady(target)
    if (process.env.THREADLIGHT_READ_EXTENDED === '1') {
      await native.request('thread/name/set', {
        threadId: target.current.sessionId,
        name: claudeTitle,
      })
      const ambiguityStart = agent.current.items.length
      assert.equal(
        (
          await agent.send(
            `Find across both enabled providers the exact chat title "${claudeTitle}". What did it say last? Find it again before answering.`,
          )
        ).ok,
        true,
      )
      await waitReady(agent, true)
      const ambiguity = agent.current.items.slice(ambiguityStart)
      assert.ok(
        !ambiguity.some((i) => i.source?.tool === 'threadlight_read_thread'),
        'Ambiguous names must be clarified before reading',
      )
      if (agent.current.status === 'waiting') {
        const request = agent.current.requests[0]
        assert.equal(
          agent.respond(request.id, {
            action: 'answer',
            answers: Object.fromEntries(
              request.questions.map((q) => [
                q.id,
                q.options.find((o) => /claude/i.test(o)) ?? 'The Claude provider',
              ]),
            ),
          }).ok,
          true,
        )
      } else
        assert.equal(
          (await agent.send('The Claude one. I select that Claude chat. Read it now.')).ok,
          true,
        )
      await waitReady(agent)
      assert.ok(
        agent.current.items
          .slice(ambiguityStart)
          .some((i) => i.source?.result?.thread?.provider === 'claude'),
      )
      report.checks.push({ case: `${provider}-ambiguous-name-choice`, pass: true })
      await native.request('thread/name/set', {
        threadId: target.current.sessionId,
        name: codexTitle,
      })
      readProviders = ['claude']
      const disabledStart = agent.current.items.length
      assert.equal((await agent.send(`Check the Codex chat named "${codexTitle}" now.`)).ok, true)
      await waitReady(agent)
      const disabled = agent.current.items.slice(disabledStart)
      assert.ok(
        !disabled.some(
          (i) =>
            i.source?.tool === 'threadlight_read_thread' &&
            ['ok', 'partial'].includes(i.source.result.outcome),
        ),
      )
      assert.ok(
        disabled.some(
          (i) =>
            i.kind === 'agent' &&
            /disabled|unavailable|cannot|can't|not enabled|not.*accessible/i.test(i.text),
        ),
      )
      report.checks.push({ case: `${provider}-disabled-provider`, pass: true })
      readProviders = ['codex']
      await target.close()
      const archivedStart = agent.current.items.length
      assert.equal(
        (
          await agent.send(
            `Read the archived Codex chat named "${codexTitle}" and tell me its latest reply.`,
          )
        ).ok,
        true,
      )
      await waitReady(agent)
      assert.ok(
        agent.current.items
          .slice(archivedStart)
          .some((i) => i.source?.result?.thread?.archived === true),
      )
      const id = agent.current.conversationId
      await agent.close()
      assert.ok((await agent.read(id)).items.some((i) => i.source && i.sourceHistorical))
      report.checks.push({ case: `${provider}-archive-and-history`, pass: true })
      await writeFile(
        join(root, `${provider}-extended.json`),
        JSON.stringify(agent.current.items, null, 2),
      )
      break
    }
  }
  console.log(
    `PASS: installed hosted readers (${process.env.THREADLIGHT_READ_HOSTS ?? 'codex,claude'}), both native sources and fresh follow-up evidence.`,
  )
} catch (error) {
  await writeFile(
    join(root, 'failure-states.json'),
    JSON.stringify(
      services.map((s) => s.current),
      null,
      2,
    ),
  )
  report.error = error.message
  console.error(error.message)
  process.exitCode = 1
} finally {
  native?.close()
  for (const service of services.toReversed()) await service.close()
  server.close()
  report.finishedAt = new Date().toISOString()
  await writeFile(join(root, 'report.json'), JSON.stringify(report, null, 2))
}
