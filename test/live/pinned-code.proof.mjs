// Opt-in signed-in foreground Agent. Only disposable pin and receipt stores are exposed.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { memoryFixture } from './memory-transport.fixture.mjs'
if (process.env.THREADLIGHT_LIVE_SMOKE !== '1') process.exit(0)
const require = createRequire(import.meta.url),
  ts = require('typescript')
require.extensions['.ts'] = (module, file) =>
  module._compile(
    ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    file,
  )
const { AgentService } = require('../../src/main/agent/agentService.ts')
const { PinnedCodeStore } = require('../../src/main/pinnedCode.ts')
const { AppControlServer } = require('../../src/main/appControl/server.ts')
const { AppControlService } = require('../../src/main/appControl/service.ts')
const { DEFAULT_SETTINGS } = require('../../src/shared/settings.ts')
assert.ok(process.env.THREADLIGHT_CODEX_CLI)
const root = mkdtempSync(join(tmpdir(), 'threadlight-pin-proof-')),
  source = join(root, 'practice.py')
const marker = 'marker_' + randomUUID().replaceAll('-', '')
const original = '# ' + 'x'.repeat(135) + '\nanswer="' + marker + '"'
writeFileSync(source, original)
const pins = new PinnedCodeStore(join(root, 'pins.json'), () => {})
pins.request({ action: 'open' })
pins.request({
  action: 'add',
  file: {
    id: randomUUID(),
    code: original,
    language: 'python',
    file: { name: 'practice.py', kind: 'reference', path: source },
  },
})
const settings = () => ({ ...DEFAULT_SETTINGS, agentProvider: 'codex', agentLifetimeMinutes: 0 })
const control = new AppControlService(
  {
    pins,
    settings,
    spaces: () => [],
    workspaces: () => [],
    busy: () => ({ agent: true, otherWork: false }),
  },
  join(root, 'receipts.json'),
)
const calls = []
const call = control.call.bind(control)
control.call = (caller, name, args) => {
  calls.push(name)
  return call(caller, name, args)
}
const server = new AppControlServer(control, memoryFixture(root))
const agent = new AgentService({
  workspace: root,
  index: join(root, 'agent.json'),
  claudeProjects: root,
  settings,
  snapshot: () => ({
    sessions: [],
    workspaces: [],
    allWorkspaces: [],
    currentWorkspace: null,
    currentThreadId: null,
  }),
  cli: async () => ({ command: process.env.THREADLIGHT_CODEX_CLI, prefixArgs: [] }),
  appControl: server,
  onChange: () => {},
  onRateLimit: () => {},
})
async function wait(predicate) {
  const end = Date.now() + 120000
  while (!predicate()) {
    if (agent.current.error) throw Error(agent.current.error)
    assert.ok(Date.now() < end, 'Agent proof timed out (' + agent.current.status + ')')
    await new Promise((r) => setTimeout(r, 150))
  }
}
try {
  await server.start()
  assert.equal(
    (
      await agent.send(
        'Using Threadlight, read my selected pinned code and tell me the exact value assigned to answer.',
      )
    ).ok,
    true,
  )
  await wait(
    () =>
      agent.current.status === 'ready' &&
      agent.current.items.some((i) => i.kind === 'agent' && i.text.includes(marker)),
  )
  assert.equal(
    (
      await agent.send(
        'Replace the selected Threadlight pinned copy with precisely this single line: answer = 42. Request its approval now.',
      )
    ).ok,
    true,
  )
  await wait(() => agent.current.requests.some((r) => r.title === 'Replace pinned copy'))
  const card = agent.current.requests.find((r) => r.title === 'Replace pinned copy')
  assert.ok(card.detail.includes('answer = 42'))
  assert.equal(pins.current.files[0].code, original)
  assert.equal(agent.respond(card.id, { action: 'allow' }).ok, true)
  await wait(() => pins.current.files[0].revision === 2)
  assert.equal(pins.current.files[0].code.trim(), 'answer = 42')
  await wait(() => agent.current.status === 'ready')
  const pin = pins.current.files[0]
  assert.equal(pins.read(pin.id, 0, 2, 1).data.code, original)
  assert.equal(
    (
      await agent.send(
        'Use append mode to add a newline and the comment # checked to my selected pinned copy. Preserve the first line.',
      )
    ).ok,
    true,
  )
  await wait(() => agent.current.requests.some((r) => r.title === 'Append to pinned copy'))
  const append = agent.current.requests.find((r) => r.title === 'Append to pinned copy')
  assert.equal(agent.respond(append.id, { action: 'allow' }).ok, true)
  await wait(() => pins.current.files[0].revision === 3)
  assert.match(pins.current.files[0].code, /answer = 42\s*# checked/)
  pins.request({ action: 'browse', id: pin.id, revision: 1 })
  assert.equal(pins.read(pin.id, 0).data.code, original)
  assert.equal(pins.read(pin.id, 0).data.latestRevision, 3)
  assert.equal(readFileSync(source, 'utf8'), original)
  for (const name of ['threadlight_list_pins', 'threadlight_read_pin', 'threadlight_replace_pin'])
    assert.ok(calls.includes(name), name)
  console.log(
    'PASS signed-in foreground Codex Agent read the selected pin, proposed and applied an approved replacement and append to a disposable snapshot. Earlier versions and source preserved.',
  )
} finally {
  await agent.close()
  server.close()
}
