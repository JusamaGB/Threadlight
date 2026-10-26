// Opt-in native integration check. Uses the existing ChatGPT sign-in, synthetic silence,
// and one short test message. Never opens a physical microphone or plays through speakers.
/* global window, AudioContext */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
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
let browser, page, service, readServer, target
const readProof = process.env.THREADLIGHT_LIVE_THREAD_READ === '1'
const bufferedOpening = process.env.THREADLIGHT_LIVE_BUFFERED === '1'
if (bufferedOpening) assert.ok(process.env.THREADLIGHT_LIVE_INITIAL_WAV)
let message =
  process.env.THREADLIGHT_LIVE_TEST_MESSAGE ||
  'This is a voice connection test. Reply briefly with voice connection ready. Do not use tools.'
let expected = new RegExp(process.env.THREADLIGHT_LIVE_EXPECT || 'voice connection ready', 'i')
const waitReady = async (agent) => {
  const until = Date.now() + 120000
  while (Date.now() < until && !['ready', 'error', 'waiting'].includes(agent.current.status))
    await new Promise((r) => setTimeout(r, 200))
  assert.equal(agent.current.status, 'ready', agent.current.error ?? 'Target did not finish')
}
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
  const options = {
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
  }
  if (readProof) {
    assert.ok(
      process.env.THREADLIGHT_LIVE_TEST_WAV,
      'Thread-reading proof requires follow-up speech WAV',
    )
    const { ThreadReadService } = require('../src/main/threadRead/service.ts')
    const { ThreadReadServer } = require('../src/main/threadRead/server.ts')
    const { CodexReadAdapter } = require('../src/main/threadRead/codex.ts')
    const { codexPaths } = require('../src/main/sessions/paths.ts')
    const { CodexClient } = require('../src/main/agent/codexClient.ts')
    readServer = new ThreadReadServer(
      new ThreadReadService([new CodexReadAdapter(codexPaths())], () => ['codex']),
    )
    await readServer.start()
    target = new AgentService({
      ...options,
      workspace: join(folder, 'target'),
      index: join(folder, 'target.json'),
      onLive: undefined,
    })
    const title = `Synthetic live reader ${Date.now()}`
    assert.equal(
      (await target.send('Reply exactly: synthetic colour amber. Do not use tools.')).ok,
      true,
    )
    await waitReady(target)
    const native = new CodexClient(
      { command: process.env.THREADLIGHT_CODEX_CLI, prefixArgs: [] },
      folder,
    )
    try {
      await native.initialize()
      await native.request('thread/name/set', { threadId: target.current.sessionId, name: title })
    } finally {
      native.close()
    }
    options.threadReads = readServer
    message = `What did the Codex chat named "${title}" say last? Read it now and tell me its colour.`
    expected = /amber/i
  }
  service = new AgentService(options)
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
  const { build } = await import('vite')
  const built = await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      write: false,
      lib: {
        entry: join(sourceRoot, 'src/renderer/lib/liveVoice.ts'),
        name: 'LiveVoiceProof',
        formats: ['iife'],
      },
    },
  })
  const output = Array.isArray(built) ? built[0].output : built.output
  const renderer = output.find((chunk) => chunk.type === 'chunk').code
  await page.addScriptTag({
    content: `${renderer}\nwindow.LiveVoiceConnection=LiveVoiceProof.LiveVoiceConnection;`,
  })
  await page.evaluate(async (buffered) => {
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
    if (buffered) {
      const ready = new Promise((resolve) => {
        window.releaseBufferedConnection = resolve
      })
      window.threadlight.agentLiveStart = async (...args) => {
        const result = await window.startVoice(...args)
        await ready
        return result
      }
    }
    window.connecting = window.connection.start({ bufferAudio: buffered })
    if (!buffered) await window.connecting
  }, bufferedOpening)
  if (bufferedOpening) {
    assert.equal(await page.evaluate(() => window.connection.connected), false)
    const wave = [...readFileSync(process.env.THREADLIGHT_LIVE_INITIAL_WAV)]
    await page.evaluate(async (bytes) => {
      window.connection.audio.volume = 0
      const buffer = await window.context.decodeAudioData(new Uint8Array(bytes).buffer)
      const speech = window.context.createBufferSource()
      speech.buffer = buffer
      speech.connect(window.testProcessor)
      await new Promise((resolve) => {
        speech.onended = resolve
        speech.start()
      })
      window.startupBufferedSeconds = window.connection.bufferedSeconds
    }, wave)
    assert.equal(service.current.items.length, 0, 'No speech may be submitted before readiness')
    assert.ok(
      await page.evaluate(() => window.startupBufferedSeconds > 1),
      'Opening audio must be buffered',
    )
    await page.evaluate(async () => {
      window.releaseBufferedConnection()
      await window.connecting
    })
  }
  assert.equal(
    await page.evaluate(() => window.connection.connected),
    true,
    JSON.stringify(await page.evaluate(() => window.phases)),
  )
  assert.equal(service.current.items.length, 0, 'Preparation must not send the opening')
  if (process.env.THREADLIGHT_LIVE_INITIAL_WAV && !bufferedOpening) {
    const wave = [...readFileSync(process.env.THREADLIGHT_LIVE_INITIAL_WAV)]
    await page.evaluate(async (bytes) => {
      window.connection.listen()
      window.connection.audio.volume = 0 // validate received audio without playing the test aloud
      const buffer = await window.context.decodeAudioData(new Uint8Array(bytes).buffer)
      const speech = window.context.createBufferSource()
      speech.buffer = buffer
      speech.connect(window.testProcessor)
      speech.start()
    }, wave)
  } else if (!bufferedOpening) await page.evaluate((text) => window.connection.open(text), message)
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
    const priorReads = service.current.items.filter(
      (i) => i.source?.tool === 'threadlight_read_thread',
    ).length
    if (readProof) {
      assert.ok(priorReads > 0, 'Opening must perform a real read')
      assert.equal(
        (await target.send('Reply exactly: synthetic colour cyan. Do not use tools.')).ok,
        true,
      )
      await waitReady(target)
    }
    const previousReplies = new Set(service.current.items.map((i) => i.id))
    const followupExpected = new RegExp(
      readProof ? 'cyan' : process.env.THREADLIGHT_LIVE_FOLLOWUP_EXPECT || '.+',
      'i',
    )
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
    const followupDeadline = Date.now() + (readProof ? 120000 : 30000)
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
    if (readProof) {
      assert.ok(
        service.current.items.filter((i) => i.source?.tool === 'threadlight_read_thread').length >
          priorReads,
        'Follow-up must perform a new backend read',
      )
      writeFileSync(
        join(folder, 'thread-read-live.json'),
        JSON.stringify(service.current.items, null, 2),
      )
      console.log(
        `PASS: fresh read after changed target on a later spoken turn. Evidence: ${folder}`,
      )
    }
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
  assert.equal(service.current.ended, false, 'Closing voice retains the Agent conversation')
  assert.equal(service.current.conversationId, id)
  const history = await service.read(id)
  assert.ok(
    history.items.some(
      (i) =>
        i.kind === 'you' &&
        (process.env.THREADLIGHT_LIVE_INITIAL_WAV ? expected.test(i.text) : i.text === message),
    ),
  )
  assert.ok(history.items.some((i) => i.kind === 'agent' && i.text.trim()))
  assert.notEqual(service.store.get(id).archiveState, 'archived')
  await service.close()
  assert.equal(service.store.get(id).archiveState, 'archived')
  if (process.env.THREADLIGHT_LIVE_INITIAL_WAV) {
    writeFileSync(
      join(folder, bufferedOpening ? 'buffered-opening.json' : 'native-opening.json'),
      JSON.stringify(
        {
          pass: true,
          bufferedOpening,
          bufferedSeconds: await page.evaluate(() => window.startupBufferedSeconds ?? 0),
          history: history.items,
          stats,
        },
        null,
        2,
      ),
    )
    console.log(
      `PASS: native first spoken turn without a locally transcribed opening. Evidence: ${folder}`,
    )
  }
  console.log(
    'PASS: ChatGPT-authenticated WebRTC, opening sent once, native reply transcript and audio packets, voice history, retained conversation on mic close and archive on End.',
  )
})()
  .catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
  .finally(async () => {
    await service?.close()
    await target?.close()
    readServer?.close()
    await browser?.close()
  })
