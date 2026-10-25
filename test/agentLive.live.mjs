// Opt-in native integration check. Uses the existing ChatGPT sign-in, synthetic silence,
// and one short test message. Never opens a physical microphone or plays through speakers.
/* global window, AudioContext */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)
const sourceRoot = fileURLToPath(new URL('../', import.meta.url))
if (process.env.THREADLIGHT_LIVE_SMOKE !== '1') {
  console.log('Skipped: set THREADLIGHT_LIVE_SMOKE=1 and THREADLIGHT_CODEX_CLI to opt in.')
  process.exit(0)
}
const ts = require('typescript')
require.extensions['.ts'] = (module, file) =>
  module._compile(
    ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    file,
  )
const { AgentService } = require('../src/main/agent/agentService.ts')
const { DEFAULT_SETTINGS } = require('../src/shared/settings.ts')
const { chromium } = require(process.env.THREADLIGHT_PLAYWRIGHT || 'playwright')
const folder = mkdtempSync(join(tmpdir(), 'threadlight-live-check-'))
let browser, page, service
const message =
  process.env.THREADLIGHT_LIVE_TEST_MESSAGE ||
  'This is a voice connection test. Reply briefly with voice connection ready. Do not use tools.'
const expected = new RegExp(process.env.THREADLIGHT_LIVE_EXPECT || 'voice connection ready', 'i')
;(async () => {
  assert.ok(
    process.env.THREADLIGHT_CODEX_CLI,
    'Set THREADLIGHT_CODEX_CLI to the installed desktop-managed CLI executable',
  )
  browser = await chromium.launch({
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required'],
  })
  page = await browser.newPage()
  await page.route('http://localhost:17896/', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Threadlight native voice test</title>',
    }),
  )
  await page.goto('http://localhost:17896/')
  service = new AgentService({
    workspace: folder,
    index: join(folder, 'history.json'),
    claudeProjects: folder,
    settings: () => ({
      ...DEFAULT_SETTINGS,
      agentProvider: 'codex',
      agentLifetimeMinutes: 0,
      agentCodexModel: process.env.THREADLIGHT_LIVE_MODEL || DEFAULT_SETTINGS.agentCodexModel,
    }),
    snapshot: () => ({
      sessions: [],
      workspaces: [],
      allWorkspaces: [],
      currentWorkspace: null,
      currentThreadId: null,
    }),
    cli: async () => ({ command: process.env.THREADLIGHT_CODEX_CLI, prefixArgs: [] }),
    onChange: () => {},
    onRateLimit: () => {},
    onLive: (event) => {
      void page.evaluate((e) => window.voiceEvent?.(e), event).catch(() => {})
    },
  })
  await page.exposeFunction('startVoice', (id, sdp) => service.startLive(id, sdp))
  await page.exposeFunction('openVoice', (id, text) => service.openLive(id, text))
  await page.exposeFunction('getAgent', () => service.current)
  await page.exposeFunction('stopVoice', (id) => service.stopLive(id))
  await page.evaluate(() => {
    window.threadlight = {
      getAgent: window.getAgent,
      agentLiveStart: window.startVoice,
      agentLiveOpen: window.openVoice,
      agentLiveStop: window.stopVoice,
      onAgentLive: (fn) => {
        window.voiceEvent = fn
        return () => {
          window.voiceEvent = null
        }
      },
    }
    window.phases = []
  })
  const renderer = ts
    .transpileModule(readFileSync(join(sourceRoot, 'src/renderer/lib/liveVoice.ts'), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    })
    .outputText.replace(
      'export class LiveVoiceConnection',
      'window.LiveVoiceConnection = class LiveVoiceConnection',
    )
  await page.addScriptTag({ content: renderer })
  await page.evaluate(async () => {
    window.context = new AudioContext({ sampleRate: 16000 })
    const osc = window.context.createOscillator(),
      gain = window.context.createGain(),
      dest = window.context.createMediaStreamDestination()
    gain.gain.value = 0
    const processor = window.context.createScriptProcessor(512, 1, 1)
    window.testProcessor = processor
    osc.connect(gain).connect(processor).connect(dest)
    window.connection = new window.LiveVoiceConnection(dest.stream, 16000, (phase, error) =>
      window.phases.push({ phase, error }),
    )
    window.connection.audio.muted = true
    processor.onaudioprocess = (e) =>
      window.connection.process(e.inputBuffer.getChannelData(0), e.outputBuffer.getChannelData(0))
    osc.start()
    await window.context.resume()
    await window.connection.start()
  })
  assert.equal(
    await page.evaluate(() => window.connection.connected),
    true,
    JSON.stringify(await page.evaluate(() => window.phases)),
  )
  assert.equal(service.current.items.length, 0, 'Preparation must not send the opening')
  await page.evaluate((text) => window.connection.open(text), message)
  const spokenAnswer = () =>
    service.current.items.some(
      (i) => i.kind === 'agent' && i.id?.startsWith('live:') && expected.test(i.text),
    )
  const deadline = Date.now() + 60000
  while (
    !spokenAnswer() &&
    (await page.evaluate(() => window.connection.active)) &&
    Date.now() < deadline
  )
    await new Promise((r) => setTimeout(r, 250))
  assert.ok(
    spokenAnswer(),
    'Expected a native spoken answer matching THREADLIGHT_LIVE_EXPECT, not just a filler acknowledgment',
  )
  // Let the native completed-item event persist the final transcript before stopping.
  await new Promise((r) => setTimeout(r, 2500))
  if (process.env.THREADLIGHT_LIVE_TEST_WAV) {
    const previousReplies = new Set(service.current.items.map((i) => i.id))
    const followupExpected = new RegExp(process.env.THREADLIGHT_LIVE_FOLLOWUP_EXPECT || '.+', 'i')
    const followupAnswer = () =>
      service.current.items.some(
        (i) =>
          i.kind === 'agent' &&
          i.id?.startsWith('live:') &&
          !previousReplies.has(i.id) &&
          followupExpected.test(i.text.trim()),
      )
    const wave = [...readFileSync(process.env.THREADLIGHT_LIVE_TEST_WAV)]
    await page.evaluate(async (bytes) => {
      const buffer = await window.context.decodeAudioData(new Uint8Array(bytes).buffer)
      const speech = window.context.createBufferSource()
      speech.buffer = buffer
      speech.connect(window.testProcessor)
      speech.start()
    }, wave)
    const followupDeadline = Date.now() + 30000
    while (
      (service.current.items.filter((i) => i.kind === 'you').length < 2 || !followupAnswer()) &&
      Date.now() < followupDeadline
    )
      await new Promise((r) => setTimeout(r, 250))
    assert.ok(
      service.current.items.filter((i) => i.kind === 'you').length >= 2,
      'Expected native microphone-input transcript',
    )
    assert.ok(
      followupAnswer(),
      'Expected native spoken follow-up answer matching THREADLIGHT_LIVE_FOLLOWUP_EXPECT',
    )
    console.log(
      'PASS: generated speech entered the same Live conversation and received a follow-up reply.',
    )
  }
  const stats = await page.evaluate(async () =>
    [...(await window.connection.peer.getStats())]
      .map(([, v]) => v)
      .filter((v) => v.type === 'inbound-rtp')
      .map((v) => ({ bytes: v.bytesReceived, packets: v.packetsReceived })),
  )
  assert.ok(
    stats.some((s) => s.bytes > 0),
    'Expected incoming native audio packets',
  )
  const id = service.current.conversationId
  await page.evaluate(() => {
    window.connection.stop()
    void window.context.close()
  })
  await service.stopLive()
  const history = await service.read(id)
  assert.ok(history.items.some((i) => i.kind === 'you' && i.text === message))
  assert.ok(history.items.some((i) => i.kind === 'agent' && i.text.trim()))
  assert.equal(service.store.get(id).archiveState, 'archived')
  console.log(
    'PASS: ChatGPT-authenticated WebRTC, opening sent once, native reply transcript and audio packets, voice history, stop and archive.',
  )
})()
  .catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
  .finally(async () => {
    await service?.close()
    await browser?.close()
  })
