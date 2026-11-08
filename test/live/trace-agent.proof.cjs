// Opt-in text-only check of the real backing Agent and application-control tool.
// Runs against the test profile and a disposable editor fixture, without WebRTC.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const ts = require('typescript')
require.extensions['.ts'] = (module, file) =>
  module._compile(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    file,
  )

async function run() {
  const { memoryFixture } = await import('./memory-transport.fixture.mjs')
  const { AppControlServer } = require('../../src/main/appControl/server.ts')
  const { AppControlService } = require('../../src/main/appControl/service.ts')
  const { CodexAgentRun } = require('../../src/main/agent/codexAgentRun.ts')
  const { CodexClient } = require('../../src/main/agent/codexClient.ts')
  const { AgentStore } = require('../../src/main/agent/agentStore.ts')
  const { EditorCoach } = require('../../src/main/editorCoach.ts')
  const root = process.env.THREADLIGHT_COACH_TEST_DIR
  const workspace = path.join(root, 'trace-agent')
  fs.mkdirSync(workspace)
  const owner = 'trace-test'
  const coach = new EditorCoach(
    () => owner,
    async () => {},
    path.join(
      root,
      'profile',
      'User',
      'globalStorage',
      'threadlight.threadlight-live-coach',
      'editor-coach.json',
    ),
  )
  const actions = []
  const server = new AppControlServer(
    new AppControlService(
      {
        workspaces: () => [],
        spaces: () => [],
        settings: () => require('../../src/shared/settings.ts').DEFAULT_SETTINGS,
      },
      path.join(workspace, 'operations.json'),
    ),
    memoryFixture(workspace),
  )
  await server.start()
  const run = new CodexAgentRun({
    client: async () => {
      const c = new CodexClient(
        { command: process.env.THREADLIGHT_CODEX_CLI, prefixArgs: [] },
        workspace,
      )
      await c.initialize()
      return c
    },
    workspace,
    model: null,
    reasoning: null,
    appsOff: [],
    store: new AgentStore(path.join(workspace, 'index.json')),
    briefing: () => '',
    lifetimeMinutes: () => 0,
    onChange: () => {},
    appControl: () =>
      server.connect({
        active: true,
        owner: () => owner,
        resolve: () => null,
        cards: async () => null,
        approve: (_id, _title, _detail, decide) => decide(false),
        editorCoach: async (cmd) => {
          actions.push(cmd.action)
          return coach.run(owner, cmd)
        },
      }),
  })
  const turn = async (prompt) => {
    actions.length = 0
    const sent = await run.send(prompt)
    assert.ok(sent.ok, sent.reason)
    const deadline = Date.now() + 90000
    while (Date.now() < deadline && !['ready', 'error', 'waiting'].includes(run.current.status))
      await new Promise((r) => setTimeout(r, 100))
    assert.equal(run.current.status, 'ready', run.current.error)
    const answer = run.current.items.filter((i) => i.kind === 'agent').at(-1)?.text
    console.log('Backing Agent actions', actions.join(', '), answer)
    return answer
  }
  try {
    await turn(
      'In my connected VS Code editor, could you fill that blank line for me, inside greet? Show me what should go on that line to print hello so I can type it myself.',
    )
    assert.ok(actions.includes('context') && actions.includes('trace'))
    assert.ok(!(actions.includes('inline') || actions.includes('diff')))
    const context = await coach.run(owner, { action: 'context' })
    assert.equal(context.trace.line, 2)
    assert.equal(context.trace.typed, '')
    assert.match(context.trace.suggestion, /print\(/)
    await turn(
      'Is it only when I select what text needs changing? If you have a look at my current file, there are a couple of issues. Could you show me inline diffs for all of them? doubled and increment should both work on numbers.',
    )
    assert.ok(actions.includes('review') && actions.includes('propose'))
    assert.ok(!actions.includes('diff'))
    const result = await coach.run(owner, { action: 'proposal_status' })
    assert.equal(result.status, 'shown')
    assert.ok(result.total >= 2)
    const lines = new Set()
    let shown = result
    for (let i = 0; i < result.total; i++) {
      lines.add(shown.line)
      shown = await coach.run(owner, { action: 'proposal_next', token: shown.token })
    }
    assert.ok(lines.has(96) && lines.has(99))
    assert.ok(!lines.has(2), 'Do not convert the previous typing trace into an unrelated file fix.')
    console.log(
      'PASS signed-in backing Agent chose trace without a selection and presented multiple late-file fixes without selection.',
    )
  } finally {
    await run.close()
    coach.close()
    server.close()
  }
}
run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
