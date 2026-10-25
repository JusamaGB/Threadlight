// Run after npm run build. Uses Playwright from THREADLIGHT_PLAYWRIGHT or local resolution.
// All IPC is synthetic; this never launches Threadlight, hooks or either provider CLI.
/* global window, document, AudioContext, getComputedStyle */
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
        async patch(patch) {
          emit('onSnapshot', await window.mockPatch(patch))
        },
        async quota(value) {
          emit('onSnapshot', await window.mockQuota(value))
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
  assert.equal(await page.getByTitle('Claude chat').count(), 1)
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
      lastAction: 'Updating the status display',
    }),
  )
  await page.getByText('Working', { exact: true }).waitFor()
  await capture('codex-working-plan')
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
  await page.getByRole('switch', { name: 'Claude', exact: true }).waitFor()
  await page.reload()
  await page
    .getByText('Chat monitoring is paused. Enable Claude or Codex in Settings.', { exact: true })
    .waitFor()
  await page.goto(url + '?view=dot')
  await page.getByRole('status', { name: /Chat monitoring is paused/ }).waitFor()
  await page.evaluate(() => window.proof.emit('onOpenMicLive', true))
  await page
    .getByRole('status', { name: /Chat monitoring is paused.*Open mic is listening/ })
    .waitFor()
  await page.evaluate(() => window.proof.emit('onOpenMicLive', false))
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
  assert.deepEqual(errors, [])
  console.log(
    'PASS: provider lists, drafts, sends, plans, usage, composer waveform and destination-coloured mic divider; quiet/loud, reduced motion, stop and denied-mic states; no browser errors.',
  )
} finally {
  await browser?.close()
  await new Promise((done) => server.close(done))
}
