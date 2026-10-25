// Run after npm run build. Uses Playwright from THREADLIGHT_PLAYWRIGHT or local resolution.
// All IPC is synthetic; this never launches Threadlight, hooks or either provider CLI.
/* global window, getComputedStyle */
import assert from 'node:assert/strict'
import { readFileSync, statSync, mkdirSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { join, resolve, extname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const require = createRequire(import.meta.url)
const ts = require('typescript')
require.extensions['.ts'] = (module, filename) =>
  module._compile(
    ts.transpileModule(readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    filename,
  )
const { DEFAULT_SETTINGS, validatePatch } = require(join(root, 'src/shared/settings.ts'))
const { combinedSnapshot, providerView } = require(join(root, 'src/shared/providers.ts'))
const { IDLE_AGENT } = require(join(root, 'src/shared/agent.ts'))
const { chromium } = require(process.env['THREADLIGHT_PLAYWRIGHT'] || 'playwright')
let settings = structuredClone(DEFAULT_SETTINGS)
const folder = 'C:/synthetic/shared'
const session = (provider) => ({
  provider,
  id: provider === 'codex' ? 'codex:11111111-1111-4111-8111-111111111111' : 'synthetic-claude',
  appId: provider === 'codex' ? 'codex:11111111-1111-4111-8111-111111111111' : 'local_synthetic',
  title: `Synthetic ${provider === 'codex' ? 'Codex' : 'Claude'}`,
  state: 'waiting',
  tracked: true,
  cwd: folder,
  lastActiveAt: Date.now() - (provider === 'claude' ? 3600_000 : 600_000),
  focusedAt: 0,
  stage: 'Waiting for you',
  lastPrompt: 'Synthetic prompt',
  plan: [],
  currentStep: null,
  recap: null,
  lastReply: null,
  lastAction: null,
  turnStartedAt: null,
  backgroundTasks: [],
  live: false,
  git: null,
  contextUsed: 0.2,
  attention:
    provider === 'codex'
      ? {
          kind: 'next-step',
          recap: null,
          ask: 'Blue or green?',
          actions: [],
          answerableUntil: Date.now() + 60000,
          holdId: 'synthetic-nonce',
        }
      : null,
  permissionMode: null,
  model: null,
  pullRequests: [],
})
const chats = { claude: session('claude'), codex: session('codex') }
const source = (provider) => ({
  provider,
  sessions: [chats[provider]],
  currentWorkspace: folder,
  currentThreadId: chats[provider].id,
  allWorkspaces: [{ id: folder, name: 'shared' }],
  workspaces: [
    {
      id: folder,
      name: 'shared',
      threadCount: 1,
      activeCount: 1,
      anyWorking: false,
      threads: [{ session: chats[provider], children: [] }],
      hiddenCount: 0,
      worktrees: 0,
    },
  ],
})
const state = () => ({
  settings,
  snapshot: combinedSnapshot(
    settings.enabledProviders,
    { claude: source('claude'), codex: source('codex') },
    settings.maxSessions,
  ),
})
const output = resolve(root, 'out/renderer')
const server = createServer((request, response) => {
  const target = resolve(output, '.' + new URL(request.url, 'http://localhost').pathname)
  if (target !== output && !target.startsWith(output + sep)) return response.writeHead(403).end()
  try {
    const file = statSync(target).isDirectory() ? join(target, 'index.html') : target
    response.setHeader(
      'content-type',
      { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' }[extname(file)] ||
        'application/octet-stream',
    )
    response.end(readFileSync(file))
  } catch {
    response.writeHead(404).end()
  }
})
await new Promise((done) => server.listen(0, '127.0.0.1', done))
let browser
try {
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 460, height: 900 } })
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', (error) => {
    errors.push(String(error))
    console.error(error)
  })
  await page.exposeFunction('mockState', state)
  await page.exposeFunction('mockUpdate', async (patch) => {
    const result = validatePatch(patch)
    assert.equal(result.ok, true)
    settings = { ...settings, ...result.patch }
    if (!settings.enabledProviders.includes('codex')) {
      chats.codex.attention.answerableUntil = null
      delete chats.codex.attention.holdId
    }
    return { ok: true, ...state() }
  })
  await page.exposeFunction('mockPatch', (patch) => {
    Object.assign(chats.codex, patch)
    return state().snapshot
  })
  await page.exposeFunction('mockView', (view) =>
    settings.enabledProviders.map((provider) => ({
      provider,
      view: providerView(settings.enabledProviders, provider, view),
    })),
  )
  await page.addInitScript(
    ({ agent }) => {
      const listeners = new Map()
      const emit = (name, value) => {
        for (const fn of listeners.get(name) || []) fn(value)
      }
      window.proof = {
        calls: [],
        emit,
        async patch(patch) {
          emit('onSnapshot', await window.mockPatch(patch))
        },
      }
      window.threadlight = new Proxy(
        {
          getSettings: async () => (await window.mockState()).settings,
          getSnapshot: async () => (await window.mockState()).snapshot,
          getSessions: async () => (await window.mockState()).snapshot.sessions,
          updateSettings: async (patch) => {
            const result = await window.mockUpdate(patch)
            emit('onSnapshot', result.snapshot)
            emit('onSettings', result.settings)
            return result
          },
          setTreeView: (view) => {
            void window.mockView(view).then((views) => window.proof.calls.push(['views', views]))
          },
          getRelays: async () => [],
          getStt: async () => ({ state: 'missing' }),
          getAgent: async () => agent,
          getUsage: async () => null,
          getVersion: async () => 'preview',
          agentApps: async () => [],
          agentHistory: async () => [],
          sendMessage: async (...args) => {
            window.proof.calls.push(['send', ...args])
            return { ok: true }
          },
          answerCodex: async (...args) => {
            window.proof.calls.push(['answer', ...args])
            return { ok: true }
          },
          copyText: (...args) => window.proof.calls.push(['copy', ...args]),
          openInClaude: (...args) => window.proof.calls.push(['open', ...args]),
        },
        {
          get(target, name) {
            if (name in target) return target[name]
            if (String(name).startsWith('on'))
              return (fn) => {
                const set = listeners.get(name) || new Set()
                listeners.set(name, set)
                set.add(fn)
                return () => set.delete(fn)
              }
            return () => {}
          },
        },
      )
    },
    { agent: IDLE_AGENT },
  )
  const url = `http://127.0.0.1:${server.address().port}/`
  await page.goto(url + '?view=panel')
  const row = (provider) =>
    page.getByRole('button', { name: new RegExp(`Synthetic ${provider}`) }).first()
  const compose = async (provider) => {
    await row(provider).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Compose', exact: true }).click()
  }
  const toggle = async (provider) => {
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.getByRole('switch', { name: provider, exact: true }).click()
    await page.getByRole('button', { name: 'Back to sessions', exact: true }).click()
  }
  const capture = async (name) => {
    const dir = process.env['THREADLIGHT_SCREENSHOTS']
    if (dir) {
      mkdirSync(dir, { recursive: true })
      await page.locator('#root > div').screenshot({ path: join(dir, `${name}.local.png`) })
    }
  }
  const box = page.getByPlaceholder('Type a message…')
  await compose('Claude')
  await box.fill('Claude draft')
  await toggle('Codex')
  assert.equal(await row('Claude').isVisible(), true)
  assert.equal(await row('Codex').isVisible(), true)
  assert.equal(await box.inputValue(), 'Claude draft')
  assert.equal(await page.getByTitle('Claude chat').count(), 2)
  assert.equal(await row('Claude').getAttribute('data-provider'), 'claude')
  assert.equal(await row('Codex').getAttribute('data-provider'), 'codex')
  assert.equal(await row('Claude').locator('[class*="providerBadge"]').count(), 0)
  const claudeFade = await row('Claude').evaluate((node) => getComputedStyle(node).backgroundImage)
  const codexFade = await row('Codex').evaluate((node) => getComputedStyle(node).backgroundImage)
  assert.match(claudeFade, /linear-gradient/)
  assert.match(codexFade, /linear-gradient/)
  assert.notEqual(claudeFade, codexFade)
  await page.getByTitle('Show the full list').click()
  await capture('combined-list')
  await page.getByTitle('Show only active sessions').click()
  await compose('Codex')
  await box.fill('Codex draft')
  await row('Codex').click()
  await page.getByLabel('Answer for this Codex chat').fill('Blue pending answer')
  await toggle('Claude')
  assert.equal(await box.inputValue(), 'Codex draft')
  await toggle('Claude')
  await toggle('Codex')
  assert.equal(await box.count(), 0)
  await compose('Claude')
  assert.equal(await box.inputValue(), 'Claude draft')
  await toggle('Codex')
  assert.equal(await box.inputValue(), 'Claude draft')
  await compose('Codex')
  assert.equal(await box.inputValue(), 'Codex draft')
  await row('Codex').click()
  assert.equal(
    await page.getByLabel('Answer for this Codex chat').inputValue(),
    'Blue pending answer',
  )
  await page.evaluate(() => window.proof.patch({ live: true }))
  await page.getByRole('button', { name: 'Copy and open Codex', exact: true }).last().click()
  assert.deepEqual(await page.evaluate(() => window.proof.calls.filter((c) => c[0] === 'send')), [])
  assert.ok(
    (await page.evaluate(() => window.proof.calls)).some(
      (c) => c[0] === 'copy' && c[1] === 'Codex draft',
    ),
  )
  await page.evaluate(() => window.proof.patch({ live: false }))
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  assert.deepEqual(await page.evaluate(() => window.proof.calls.find((c) => c[0] === 'send')), [
    'send',
    chats.codex.id,
    'Codex draft',
  ])
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  assert.equal(
    await page.getByRole('switch', { name: 'Claude', exact: true }).getAttribute('aria-checked'),
    'true',
  )
  assert.equal(
    await page.getByRole('switch', { name: 'Codex', exact: true }).getAttribute('aria-checked'),
    'true',
  )
  // The merged open-mic control coexists with both provider switches; saving it never starts it.
  await page.getByRole('switch', { name: 'Open mic', exact: true }).click()
  await capture('provider-toggles')
  await page.getByRole('radio', { name: 'All', exact: true }).click()
  await page.getByRole('button', { name: 'Back to sessions', exact: true }).click()
  assert.equal(
    await page
      .getByRole('button', { name: 'Open the mic for voice commands' })
      .getAttribute('aria-pressed'),
    'false',
  )
  await page.getByTitle('Show the full list').click()
  assert.equal(await page.getByRole('button', { name: /^Claude · shared/ }).isVisible(), true)
  assert.equal(await page.getByRole('button', { name: /^Codex · shared/ }).isVisible(), true)
  await capture('combined-workspaces')
  await toggle('Claude')
  await toggle('Codex')
  assert.equal(
    await page
      .getByText('Chat monitoring is paused. Enable Claude or Codex in Settings.', { exact: true })
      .isVisible(),
    true,
  )
  await page.evaluate(() => window.proof.emit('onTalkToggle'))
  await page.getByRole('switch', { name: 'Claude', exact: true }).waitFor()
  await page.reload()
  assert.equal(
    await page
      .getByText('Chat monitoring is paused. Enable Claude or Codex in Settings.', { exact: true })
      .isVisible(),
    true,
  )
  await page.goto(url + '?view=dot')
  await page.getByRole('status', { name: /Chat monitoring is paused/ }).waitFor()
  await page.evaluate(() => window.proof.emit('onOpenMicLive', true))
  await page
    .getByRole('status', { name: /Chat monitoring is paused.*Open mic is listening/ })
    .waitFor()
  await page.evaluate(() => window.proof.emit('onOpenMicLive', false))
  assert.deepEqual(errors, [])
  console.log(
    'PASS: both toggles, combined rows/workspaces, draft and answer retention, exact send target, live copy/open, paused list/hotkey/dot, persisted off state; no browser errors.',
  )
} finally {
  await browser?.close()
  await new Promise((done) => server.close(done))
}
