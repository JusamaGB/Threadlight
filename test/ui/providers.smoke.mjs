// Run after npm run build. Uses Playwright from THREADLIGHT_PLAYWRIGHT or local resolution.
// All IPC is synthetic; this never launches Threadlight, hooks or either provider CLI.
/* global window, document, AudioContext, getComputedStyle */
import assert from 'node:assert/strict'
import { readFileSync, statSync, mkdirSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { join, resolve, extname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkVoiceRouting } from './voice-routing.smoke.mjs'
import { checkMicPill } from './mic-pill.smoke.mjs'
import { checkAgentSelection } from './agent-selection.smoke.mjs'

import { setupMemory, checkMemory } from './memory.smoke.mjs'

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
const { summarizeCodex } = require(join(root, 'src/main/codex/tracker.ts'))
const { codexState } = require(join(root, 'src/main/codex/state.ts'))
const readableSummary = summarizeCodex([
  {
    type: 'userMessage',
    content:
      '# Files mentioned by the user:\n\n## preview.png: C:/synthetic/preview.png\nImage attachment: true\n\n## My request:\nPlease make the edge tint narrower and extend it through the expanded thread.',
  },
  {
    type: 'agentMessage',
    phase: 'commentary',
    text: 'I’m checking the expanded layout and narrowing the provider tint.',
  },
  { type: 'commandExecution', command: 'C:/synthetic/pwsh.exe -Command "git diff --stat"' },
  {
    type: 'agentMessage',
    phase: 'final_answer',
    text: 'Done: the tint is now **20px wide** and continues through the expanded thread.\n\n![Preview](C:/synthetic/preview.png)\n\nBuild and UI checks pass.',
  },
])
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
chats.codex.plan = [
  { content: 'Inspect the data', status: 'completed' },
  { content: 'Build the display', status: 'in_progress' },
  { content: 'Verify the display', status: 'pending' },
]
const trackedPlan = structuredClone(chats.codex.plan)
const heldAttention = structuredClone(chats.codex.attention)
let codexQuota = {
  at: Date.now(),
  fiveHour: null,
  week: { used: 0.27, resetsAt: Date.now() + 86400_000 },
}
const source = (provider) => ({
  provider,
  codexUsage: provider === 'codex' ? codexQuota : undefined,
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
let browser, memoryProof, testPage
try {
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 460, height: 900 } })
  memoryProof = await setupMemory(page, require(join(root, 'src/main/memory/store.ts')).MemoryStore)
  testPage = page
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
  await page.exposeFunction('mockQuota', (value) => {
    codexQuota = value
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
        agent(next) {
          agent = { ...agent, ...next, revision: agent.revision + 1 }
          emit('onAgent', agent)
        },
        async patch(patch) {
          emit('onSnapshot', await window.mockPatch(patch))
        },
        async quota(value) {
          emit('onSnapshot', await window.mockQuota(value))
        },
      }
      window.threadlight = new Proxy(
        {
          memoryRequest: (input) => window.mockMemory(input),
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
          getOpenMicIndicator: async () => ({ live: false, level: 0 }),
          dotClick: () => window.proof.calls.push(['dotClick']),
          stopOpenMic: () => window.proof.calls.push(['stopOpenMic']),
          getAgent: async () => agent,
          getUsage: async () => ({
            at: Date.now(),
            fiveHour: { used: 0.2, resetsAt: Date.now() + 3600_000 },
            week: { used: 0.6, resetsAt: Date.now() + 86400_000 },
          }),
          getVersion: async () => 'preview',
          transcribe: () =>
            new Promise((resolve) => {
              window.proof.finishTranscript = resolve
            }),
          agentApps: async () => [],
          agentModels: async () => ({
            error: null,
            models: [
              {
                id: 'future-fast',
                name: 'Future Fast',
                isDefault: true,
                hidden: false,
                efforts: ['low', 'medium'],
                defaultEffort: 'low',
              },
              {
                id: 'future-deep',
                name: 'Future Deep',
                isDefault: false,
                hidden: true,
                efforts: ['high', 'ultra'],
                defaultEffort: 'high',
              },
            ],
          }),
          agentHistory: async () => [
            {
              id: 'codex:past',
              provider: 'codex',
              model: 'future-fast',
              title: 'Synthetic earlier agent',
              at: Date.now(),
            },
          ],
          agentReadPage: async (_id, cursor) => ({
            items: [{ kind: 'agent', text: cursor ? 'An older reply' : 'A saved reply' }],
            cursor: cursor ? null : 'older',
          }),
          agentResume: async (id) => {
            window.proof.calls.push(['agentResume', id])
            return { ok: true }
          },
          agentRespond: async (...args) => {
            window.proof.calls.push(['agentRespond', ...args])
            window.proof.agent({ status: 'working', requests: [] })
            return { ok: true }
          },
          agentSend: async (text) => {
            window.proof.calls.push(['agentSend', text])
            window.proof.agent({
              status: 'working',
              provider: 'codex',
              model: 'future-deep',
              reasoning: 'ultra',
              items: [{ kind: 'you', text }],
              conversationId: 'codex:active',
            })
            return { ok: true }
          },
          agentInterrupt: async () => {
            window.proof.agent({ status: 'interrupted', requests: [] })
            return { ok: true }
          },
          agentClose: () =>
            window.proof.agent({ status: 'idle', ended: true, requests: [], conversationId: null }),
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
  await checkMemory(page, memoryProof, capture)
  await page.reload()
  await compose('Claude')
  await box.fill('Claude draft')
  await toggle('Codex')
  assert.equal(await row('Claude').isVisible(), true)
  assert.equal(await row('Codex').isVisible(), true)
  assert.equal(await box.inputValue(), 'Claude draft')
  assert.equal(await page.getByTitle('Claude chat').count(), 1)
  assert.equal(await row('Claude').getAttribute('data-provider'), 'claude')
  assert.equal(await row('Codex').getAttribute('data-provider'), 'codex')
  assert.equal(await row('Claude').locator('[class*="providerBadge"]').count(), 0)
  const claudeFade = await row('Claude').evaluate(
    (node) => getComputedStyle(node.parentElement, '::after').backgroundImage,
  )
  const codexFade = await row('Codex').evaluate(
    (node) => getComputedStyle(node.parentElement, '::after').backgroundImage,
  )
  assert.match(claudeFade, /linear-gradient/)
  assert.match(codexFade, /linear-gradient/)
  assert.notEqual(claudeFade, codexFade)
  await page.getByTitle('Show the full list').click()
  await capture('combined-list')
  await page.getByTitle('Show only active sessions').click()
  await compose('Codex')
  await box.fill('Codex draft')
  await row('Codex').click()
  const plan = page.getByRole('region', { name: 'Codex plan' })
  await plan.getByText('Build the display', { exact: true }).waitFor()
  assert.equal(await plan.locator('li[data-status="completed"]').count(), 1)
  await page.getByLabel(/^Claude · 5-hour limit 20%/).hover()
  await page.getByRole('tooltip').filter({ hasText: 'Claude · 5-hour limit 20%' }).waitFor()
  await page.getByLabel(/^Codex · Weekly limit 27%/).hover()
  await page.getByRole('tooltip').filter({ hasText: 'Codex · Weekly limit 27%' }).waitFor()
  assert.equal(
    await page
      .getByRole('tooltip')
      .innerText()
      .then((text) => text.includes('5-hour')),
    false,
  )
  await page.locator('[class*="header"]').first().hover()
  await capture('codex-plan-usage')
  // Native Codex questions prepare answers without pretending to submit to a held hook.
  const nativeQuestion = {
    header: 'Preview colour',
    question: 'Which colour should the preview use for this workspace?',
    multiSelect: false,
    options: [
      {
        label: 'Follow the chat destination',
        description: 'Use the application colour.',
        recommended: true,
      },
      { label: 'Use the same colour everywhere', description: '', recommended: false },
    ],
  }
  await page.evaluate(
    (question) =>
      window.proof.patch({
        plan: [],
        attention: { kind: 'question', questions: [question], answerableUntil: null },
      }),
    nativeQuestion,
  )
  const questionCard = page.getByRole('region', { name: 'Codex question', exact: true })
  const customAnswer = questionCard.getByLabel('Answer for this Codex question')
  await questionCard.waitFor()
  assert.equal(await questionCard.getByRole('radio').first().isChecked(), true)
  await capture('codex-question')
  const beforeQuestion = await page.evaluate(
    () => window.proof.calls.filter((c) => ['send', 'answer'].includes(c[0])).length,
  )
  await questionCard.getByRole('radio').nth(1).check()
  await questionCard.getByRole('button', { name: 'Copy & open', exact: true }).click()
  assert.deepEqual(await page.evaluate(() => window.proof.calls.slice(-2)), [
    ['copy', 'Use the same colour everywhere'],
    ['open', chats.codex.appId],
  ])
  await customAnswer.fill('Use a softer blue for this workspace.')
  assert.equal(await questionCard.getByRole('radio').nth(1).isChecked(), false)
  await questionCard.getByRole('button', { name: 'Collapse question' }).click()
  await questionCard.waitFor({ state: 'detached' })
  await row('Codex').click()
  assert.equal(await customAnswer.inputValue(), 'Use a softer blue for this workspace.')
  await capture('codex-question-custom')
  await customAnswer.press('Control+Enter')
  assert.deepEqual(await page.evaluate(() => window.proof.calls.slice(-2)), [
    ['copy', 'Use a softer blue for this workspace.'],
    ['open', chats.codex.appId],
  ])
  await page.evaluate(
    (question) =>
      window.proof.patch({
        attention: {
          kind: 'question',
          questions: [
            question,
            {
              header: 'Details',
              question: 'What else should the preview show?',
              options: [],
              multiSelect: false,
            },
          ],
          answerableUntil: null,
        },
      }),
    nativeQuestion,
  )
  await questionCard.getByRole('button', { name: 'Next question' }).waitFor()
  assert.equal(
    await questionCard.getByRole('button', { name: 'Copy & open', exact: true }).isDisabled(),
    true,
  )
  await questionCard.getByRole('button', { name: 'Next question' }).click()
  await customAnswer.fill('Keep the labels visible.')
  await toggle('Codex')
  await toggle('Codex')
  await row('Codex').click()
  assert.equal(await customAnswer.inputValue(), 'Keep the labels visible.')
  await questionCard.getByRole('button', { name: 'Previous question' }).click()
  assert.equal(await questionCard.getByRole('radio').first().isChecked(), true)
  await questionCard.getByRole('button', { name: 'Copy & open', exact: true }).click()
  assert.deepEqual(await page.evaluate(() => window.proof.calls.slice(-2)), [
    [
      'copy',
      `${nativeQuestion.question}\nFollow the chat destination\n\nWhat else should the preview show?\nKeep the labels visible.`,
    ],
    ['open', chats.codex.appId],
  ])
  assert.equal(
    await page.evaluate(
      () => window.proof.calls.filter((c) => ['send', 'answer'].includes(c[0])).length,
    ),
    beforeQuestion,
  )
  await page.evaluate((plan) => window.proof.patch({ plan }), trackedPlan)
  await page.evaluate(
    (question) =>
      window.proof.patch({
        attention: {
          kind: 'question',
          questions: [{ ...question, multiSelect: true }],
          answerableUntil: null,
        },
      }),
    nativeQuestion,
  )
  assert.equal(
    await questionCard.getByRole('button', { name: 'Copy & open', exact: true }).isDisabled(),
    true,
  )
  await questionCard.getByRole('checkbox').first().check()
  await questionCard.getByRole('checkbox').nth(1).check()
  await questionCard.getByRole('button', { name: 'Copy & open', exact: true }).click()
  assert.deepEqual(await page.evaluate(() => window.proof.calls.slice(-2)), [
    ['copy', 'Follow the chat destination, Use the same colour everywhere'],
    ['open', chats.codex.appId],
  ])
  await customAnswer.fill('Custom answer')
  await questionCard.getByRole('checkbox').first().check()
  assert.equal(await customAnswer.inputValue(), '')
  assert.equal(await questionCard.getByRole('checkbox').first().isChecked(), true)
  assert.equal(await questionCard.getByRole('checkbox').nth(1).isChecked(), false)
  assert.equal(await questionCard.evaluate((node) => node.scrollWidth <= node.clientWidth), true)
  await page.evaluate(() =>
    window.proof.patch({
      attention: null,
      state: 'working',
      stage: '2/3 · Build the display',
    }),
  )
  await page.evaluate(
    (summary) =>
      window.proof.patch({
        lastPrompt: summary.lastPrompt,
        lastAction: summary.lastAction,
        lastReply: summary.lastReply,
      }),
    readableSummary,
  )
  await page.getByText('Working', { exact: true }).waitFor()
  await page.evaluate(
    (status) => window.proof.patch({ ...status, cwd: '\\\\?\\Z:\\synthetic\\workspace' }),
    codexState('inProgress', true, null, null),
  )
  await page.getByTitle('Z:\\synthetic\\workspace', { exact: true }).waitFor()
  assert.equal(await page.getByText('Working · state guessed', { exact: true }).count(), 0)
  await page.getByText(readableSummary.lastPrompt, { exact: true }).waitFor()
  await page.getByText(readableSummary.lastAction, { exact: true }).waitFor()
  await capture('codex-working-plan')
  await page.evaluate(() => window.proof.patch({ state: 'idle', stage: 'Done', plan: [] }))
  await page.getByText(readableSummary.lastReply, { exact: true }).waitFor()
  assert.equal(
    await page.getByText(/Files mentioned by the user|C:\/synthetic\/preview.png|pwsh.exe/).count(),
    0,
  )
  await capture('codex-readable-reply')
  await page.evaluate(() => window.proof.patch({ tracked: false }))
  await page.getByText('Status unavailable', { exact: true }).waitFor()
  await page.evaluate((cwd) => window.proof.patch({ tracked: true, cwd }), folder)
  await page.evaluate((plan) => window.proof.patch({ plan }), trackedPlan)
  await page.evaluate(
    (attention) => window.proof.patch({ attention, state: 'waiting', stage: 'Waiting for you' }),
    heldAttention,
  )
  await page.getByLabel('Answer for this Codex chat').waitFor()
  await page.evaluate(() =>
    window.proof.patch({
      plan: [],
      planText:
        '# Synthetic proposal\n- **Inspect** the data\n- Build `view.tsx`\n<script>not executable</script>',
    }),
  )
  await plan.getByRole('heading', { name: 'Synthetic proposal' }).waitFor()
  assert.equal(await plan.locator('script').count(), 0)
  await capture('codex-proposed-plan')
  await page.evaluate((plan) => window.proof.patch({ plan, planText: null }), trackedPlan)
  await page.getByLabel('Answer for this Codex chat').fill('Blue pending answer')
  await toggle('Claude')
  assert.equal(await page.getByLabel(/^Claude · 5-hour limit/).count(), 0)
  assert.equal(await box.inputValue(), 'Codex draft')
  await toggle('Claude')
  await toggle('Codex')
  assert.equal(await page.getByLabel(/^Codex · Weekly/).count(), 0)
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
  await box
    .locator('../..')
    .getByRole('button', { name: 'Copy and open Codex', exact: true })
    .click()
  assert.deepEqual(await page.evaluate(() => window.proof.calls.filter((c) => c[0] === 'send')), [])
  assert.ok(
    (await page.evaluate(() => window.proof.calls)).some(
      (c) => c[0] === 'copy' && c[1] === 'Codex draft',
    ),
    JSON.stringify(await page.evaluate(() => window.proof.calls)),
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
  // Agent voice is independent of monitored chats; with no model it requests speech setup.
  await page
    .getByText('Voice needs the speech model first. Open the composer and press the mic.')
    .waitFor()
  await page.reload()
  await page
    .getByText('Chat monitoring is paused. Enable Claude or Codex in Settings.', { exact: true })
    .waitFor()
  await page.goto(url + '?view=dot')
  await page.getByRole('status', { name: /Chat monitoring is paused/ }).waitFor()
  await checkMicPill(page, capture)
  await page.goto(url + '?view=panel')
  await toggle('Codex')
  await page.evaluate(() =>
    window.proof.quota({
      at: Date.now() - 86400_000,
      fiveHour: null,
      week: { used: 0.99, resetsAt: Date.now() - 1000 },
    }),
  )
  await page.getByLabel(/^Codex · Weekly usage unavailable/).waitFor()
  assert.equal(await page.locator('[class*="codexUsage"] [class*="usageFill"]').count(), 0)
  // Use a generated audio stream, never the PC's microphone, to exercise the actual recorder UI.
  await page.evaluate(async () => {
    await window.threadlight.updateSettings({ openMic: false })
    window.proof.emit('onStt', { state: 'ready' })
    window.proof.stoppedTracks = 0
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      value: async () => {
        const context = new AudioContext()
        const tone = context.createOscillator()
        const gain = context.createGain()
        const destination = context.createMediaStreamDestination()
        tone.frequency.value = 220
        tone.connect(gain)
        gain.connect(destination) // no connection to speakers or a physical input
        const now = context.currentTime
        gain.gain.setValueAtTime(0.02, now)
        for (let i = 0; i < 30; i++) {
          gain.gain.linearRampToValueAtTime(0.12, now + i * 0.4 + 0.15)
          gain.gain.linearRampToValueAtTime(0.02, now + i * 0.4 + 0.4)
        }
        window.proof.setAudioLevel = (value) => {
          gain.gain.cancelScheduledValues(context.currentTime)
          gain.gain.setValueAtTime(value, context.currentTime)
        }
        if (window.proof.quietInput) window.proof.setAudioLevel(0)
        tone.start()
        await context.resume()
        for (const track of destination.stream.getTracks()) {
          const stop = track.stop.bind(track)
          track.stop = () => {
            stop()
            tone.stop()
            void context.close()
            window.proof.stoppedTracks++
          }
        }
        return destination.stream
      },
    })
  })
  await compose('Codex')
  await box.fill('')
  assert.equal(
    await page
      .getByRole('group', { name: 'Codex message composer' })
      .getByRole('button', { name: 'Send', exact: true })
      .count(),
    0,
  )
  await box.fill('   ')
  assert.equal(
    await page
      .getByRole('group', { name: 'Codex message composer' })
      .getByRole('button', { name: 'Send', exact: true })
      .count(),
    0,
  )
  await box.fill('')
  const sendsBeforeRecording = await page.evaluate(
    () => window.proof.calls.filter((c) => c[0] === 'send').length,
  )
  await page.getByRole('button', { name: 'Talk', exact: true }).click()
  const waveform = page.getByRole('img', { name: 'Listening...', exact: true })
  await waveform.waitFor()
  const codexDivider = page.getByRole('status', { name: 'Codex microphone listening', exact: true })
  await codexDivider.waitFor()
  assert.equal(await codexDivider.getAttribute('data-provider'), 'codex')
  await page.waitForFunction(() => {
    const canvas = document.querySelector('canvas')
    if (!canvas) return false
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
    const peaks = []
    for (let x = 0; x < canvas.width; x++) {
      for (let y = 0; y < canvas.height / 2 - 3; y++) {
        if (pixels[(y * canvas.width + x) * 4 + 3] > 100) {
          peaks.push(x)
          break
        }
      }
    }
    return peaks.length && Math.max(...peaks) - Math.min(...peaks) > canvas.width * 0.85
  })
  const waveBounds = await waveform.boundingBox()
  const entryBounds = await waveform.locator('..').boundingBox()
  assert.ok(waveBounds.width > 220 && Math.abs(waveBounds.width - entryBounds.width) < 1)
  await capture('composer-listening')
  const firstFrame = await waveform.evaluate((canvas) => canvas.toDataURL())
  await page.waitForFunction(
    (first) => document.querySelector('canvas')?.toDataURL() !== first,
    firstFrame,
  )
  await page.getByRole('button', { name: 'Stop and transcribe', exact: true }).click()
  await waveform.waitFor({ state: 'detached' })
  await codexDivider.waitFor({ state: 'detached' })
  await page.waitForFunction(() => typeof window.proof.finishTranscript === 'function')
  await page.evaluate(() => window.proof.finishTranscript('Synthetic transcript'))
  await page.waitForFunction(
    () => document.querySelector('textarea')?.value === 'Synthetic transcript',
  )
  assert.equal(await page.evaluate(() => window.proof.stoppedTracks), 1)
  await box.fill('Existing draft')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.getByRole('button', { name: 'Talk', exact: true }).click()
  await waveform.waitFor()
  await page.waitForFunction(() => {
    const node = document.querySelector('[aria-label="Codex microphone listening"]')
    return node && Number(getComputedStyle(node).getPropertyValue('--spread')) === 0.15
  })
  assert.equal(await page.locator('textarea').inputValue(), 'Existing draft')
  assert.equal(await page.locator('textarea').isVisible(), true)
  const centreMask = () =>
    waveform.evaluate((canvas) => {
      const pixels = canvas
        .getContext('2d')
        .getImageData(0, Math.floor(canvas.height / 2), canvas.width, 1).data
      return Array.from({ length: canvas.width }, (_, x) => pixels[x * 4 + 3] > 0).join(',')
    })
  await page.waitForFunction(() =>
    document
      .querySelector('canvas')
      ?.getContext('2d')
      .getImageData(0, 10, 250, 1)
      .data.some((value) => value > 0),
  )
  const stationary = await centreMask()
  await page.waitForTimeout(180) // several animation frames: reduced motion must not scroll sideways
  assert.equal(await centreMask(), stationary)
  assert.equal(
    await codexDivider.evaluate((node) =>
      Number(getComputedStyle(node).getPropertyValue('--spread')),
    ),
    0.15,
  )
  await capture('composer-listening-draft')
  await page.evaluate(() => {
    window.proof.finishTranscript = null
  })
  await page.getByRole('button', { name: 'Stop and transcribe', exact: true }).click()
  await waveform.waitFor({ state: 'detached' })
  await page.waitForFunction(() => window.proof.stoppedTracks === 2)
  await page.getByPlaceholder('Transcribing...').waitFor()
  await page.waitForFunction(() => typeof window.proof.finishTranscript === 'function')
  await page.evaluate(() => window.proof.finishTranscript('More words'))
  await page.waitForFunction(
    () => document.querySelector('textarea')?.value === 'Existing draft More words',
  )
  assert.equal(
    await page.evaluate(() => window.proof.calls.filter((c) => c[0] === 'send').length),
    sendsBeforeRecording,
  )
  // The global open mic follows the built-in Claude agent, even with a Codex composer selected.
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.evaluate(async () => {
    window.proof.quietInput = true
    await window.threadlight.updateSettings({ openMic: true })
  })
  await page.getByRole('button', { name: 'Open the mic for voice commands', exact: true }).waitFor()
  await page.evaluate(() => window.proof.emit('onTalkToggle'))
  const divider = page.getByRole('status', { name: 'Claude microphone listening', exact: true })
  await divider.waitFor()
  assert.equal(await divider.getAttribute('data-provider'), 'claude')
  await page.waitForFunction(() => {
    const node = document.querySelector('[aria-label="Claude microphone listening"]')
    return node && Number(getComputedStyle(node).getPropertyValue('--spread')) < 0.05
  })
  await capture('open-mic-quiet')
  const before = await page.locator('[data-card]').boundingBox()
  await page.evaluate(() => window.proof.setAudioLevel(0.18))
  await page.waitForFunction(() => {
    const node = document.querySelector('[aria-label="Claude microphone listening"]')
    return node && Number(getComputedStyle(node).getPropertyValue('--spread')) > 0.85
  })
  assert.equal((await page.locator('[data-card]').boundingBox()).height, before.height)
  await capture('open-mic-speaking')
  await page.evaluate(() => window.proof.setAudioLevel(0))
  await page.waitForFunction(() => {
    const node = document.querySelector('[aria-label="Claude microphone listening"]')
    return node && Number(getComputedStyle(node).getPropertyValue('--spread')) < 0.06
  })
  await page.evaluate(() => window.proof.emit('onTalkToggle'))
  await divider.waitFor({ state: 'detached' })
  await page.waitForFunction(() => window.proof.stoppedTracks === 3)
  await checkVoiceRouting(page)
  await page.evaluate(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      value: async () => {
        throw new Error('Synthetic microphone denied')
      },
    })
    window.proof.emit('onTalkToggle')
  })
  await page.getByRole('button', { name: 'The microphone is blocked', exact: true }).waitFor()
  assert.equal(await divider.count(), 0)

  // The hosted Agent is available independently of monitoring and uses a dynamic catalog.
  await page.evaluate(() =>
    window.threadlight.updateSettings({ enabledProviders: [], openMic: false }),
  )
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByLabel('Agent provider', { exact: true }).selectOption('codex')
  const modelPicker = page.getByLabel('Codex agent model', { exact: true })
  await modelPicker.waitFor()
  await page.waitForFunction(
    () => !document.querySelector('[aria-label="Codex agent model"]').disabled,
  )
  assert.equal(await modelPicker.inputValue(), 'future-fast')
  assert.equal(await modelPicker.locator('option').count(), 1)
  await page.getByLabel('Show additional models').check()
  await page.getByLabel('Search Codex models').fill('deep')
  await modelPicker.selectOption('future-deep')
  await page.waitForFunction(
    () => document.querySelector('[aria-label="Agent reasoning"]').value === 'high',
  )
  assert.equal(await page.getByLabel('Agent reasoning', { exact: true }).inputValue(), 'high')
  await page.getByLabel('Agent reasoning', { exact: true }).selectOption('ultra')
  assert.equal(settings.agentCodexModel, 'future-deep')
  assert.equal(settings.agentCodexReasoning, 'ultra')
  await capture('agent-codex-settings')
  await page.getByRole('button', { name: 'Back to sessions', exact: true }).click()
  await page.getByRole('button', { name: 'Agent: ask it to do something', exact: true }).click()
  await page.getByPlaceholder('Ask your agent…').fill('Synthetic agent question')
  await page.getByPlaceholder('Ask your agent…').press('Enter')
  await page.getByRole('button', { name: 'Stop', exact: true }).waitFor()
  await page.getByText('Codex · future-deep · ultra', { exact: true }).waitFor()
  await page.evaluate(() =>
    window.proof.agent({
      status: 'waiting',
      requests: [
        {
          id: 'question-1',
          kind: 'questions',
          title: 'Choose a colour',
          detail: '',
          canAllow: true,
          questions: [
            { id: 'colour', text: 'Which colour?', options: ['Blue', 'Green'], other: true },
          ],
        },
      ],
    }),
  )
  assert.equal(await page.getByRole('radio', { name: 'Blue', exact: true }).isChecked(), false)
  await page.getByRole('radio', { name: 'Green', exact: true }).check()
  await page.getByRole('button', { name: 'Submit', exact: true }).click()
  const response = await page.evaluate(() =>
    window.proof.calls.filter((c) => c[0] === 'agentRespond').at(-1),
  )
  assert.deepEqual(response, [
    'agentRespond',
    'question-1',
    { action: 'answer', answers: { colour: 'Green' } },
  ])
  await page.evaluate(() =>
    window.proof.agent({
      status: 'waiting',
      requests: [
        {
          id: 'approval-1',
          kind: 'approval',
          title: 'Synthetic file change',
          detail: 'Full synthetic action details',
          canAllow: true,
        },
        { id: 'approval-2', kind: 'approval', title: 'Second action', detail: '', canAllow: true },
      ],
    }),
  )
  await page.getByText('Synthetic file change · 2 pending', { exact: true }).waitFor()
  await capture('agent-approval')
  await page.getByRole('button', { name: 'Deny', exact: true }).click()
  assert.deepEqual(
    await page.evaluate(() => window.proof.calls.filter((c) => c[0] === 'agentRespond').at(-1)),
    ['agentRespond', 'approval-1', { action: 'deny' }],
  )
  await page.getByRole('button', { name: 'Stop', exact: true }).click()
  await page
    .getByText('Turn stopped. You can continue this conversation.', { exact: true })
    .waitFor()
  await page.getByRole('button', { name: 'End', exact: true }).click()
  await page.getByRole('button', { name: /Earlier · 1/ }).click()
  await page.getByRole('button', { name: /Synthetic earlier agent/ }).click()
  await page.getByText('A saved reply', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Load earlier messages', exact: true }).click()
  await page.getByText('An older reply', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  assert.deepEqual(
    await page.evaluate(() => window.proof.calls.filter((c) => c[0] === 'agentResume').at(-1)),
    ['agentResume', 'codex:past'],
  )
  assert.deepEqual(errors, [])
  await checkAgentSelection(page, capture)
  assert.deepEqual(errors, [])
  console.log(
    'PASS: provider lists, drafts, sends, plans, usage, composer waveform and mic divider; Agent model settings, questions, queued approvals, Stop/End and history; no browser errors.',
  )
} catch (error) {
  console.log((await testPage?.locator('body').innerText())?.slice(0, 6000))
  if (process.env.THREADLIGHT_SCREENSHOTS)
    await testPage?.screenshot({
      path: join(process.env.THREADLIGHT_SCREENSHOTS, 'memory-error.local.png'),
    })
  throw error
} finally {
  await browser?.close()
  memoryProof?.close()
  await new Promise((done) => server.close(done))
}
