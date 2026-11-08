import { openHeaderPage } from './header-navigation.mjs'
// Real renderer and Web Audio, synthetic IPC and tones; no accounts or microphone access.
/* global window, document, AudioContext, HTMLCanvasElement, RTCPeerConnection */
import assert from 'node:assert/strict'
import { readFileSync, statSync, mkdirSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { join, resolve, extname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import { readMotionFrame } from './motion-pixels.mjs'

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
const { DEFAULT_SETTINGS } = require(join(root, 'src/shared/settings.ts'))
const { IDLE_AGENT } = require(join(root, 'src/shared/agent.ts'))
const { IDLE_MOTION } = require(join(root, 'src/shared/motion.ts'))
const { chromium } = require(process.env.THREADLIGHT_PLAYWRIGHT || 'playwright')
const fixture = await build({
  configFile: false,
  logLevel: 'silent',
  build: {
    write: false,
    lib: {
      entry: join(root, 'test/ui/motion-fixture.mjs'),
      formats: ['es'],
      fileName: 'motion-fixture',
    },
  },
})
const fixtureCode = (Array.isArray(fixture) ? fixture[0] : fixture).output.find(
  (file) => file.type === 'chunk',
).code
const output = resolve(root, 'out/renderer')
const server = createServer((request, response) => {
  if (request.url === '/motion-fixture.js') {
    response.setHeader('Content-Type', 'text/javascript')
    return response.end(fixtureCode)
  }
  const target = resolve(output, '.' + new URL(request.url, 'http://localhost').pathname)
  if (target !== output && !target.startsWith(output + sep)) return response.writeHead(403).end()
  try {
    const file = statSync(target).isDirectory() ? join(target, 'index.html') : target
    response.setHeader(
      'Content-Type',
      { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[extname(file)] ||
        'application/octet-stream',
    )
    response.end(readFileSync(file))
  } catch {
    response.writeHead(404).end()
  }
})
await new Promise((done) => server.listen(0, '127.0.0.1', done))
const url = `http://127.0.0.1:${server.address().port}`
const screenshots = process.env.THREADLIGHT_SCREENSHOTS
if (screenshots) mkdirSync(screenshots, { recursive: true })
let browser, testPage
const errors = []
try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.THREADLIGHT_CHROMIUM || undefined,
    args: ['--mute-audio'],
  })
  const page = await browser.newPage({
    viewport: { width: 440, height: 850 },
    deviceScaleFactor: 2,
  })
  testPage = page
  page.on('pageerror', (error) => errors.push(error.message))
  await page.addInitScript(
    ({ settings, agent, motion }) => {
      const listeners = new Map()
      const emit = (name, value) => {
        for (const fn of listeners.get(name) || []) fn(value)
      }
      settings = { ...settings, voiceTarget: 'agent', talkMode: 'hold', agentProvider: 'claude' }
      const snapshot = {
        sessions: [],
        workspaces: [],
        allWorkspaces: [],
        currentWorkspace: null,
        currentThreadId: null,
      }
      window.motionProof = {
        emit,
        telemetry: motion,
        stopped: 0,
        calls: [],
        agent(patch) {
          agent = { ...agent, ...patch, revision: agent.revision + 1 }
          emit('onAgent', agent)
        },
        settings(patch) {
          settings = { ...settings, ...patch }
          emit('onSettings', settings)
        },
      }
      window.threadlight = new Proxy(
        {
          controlHello: undefined,
          getSettings: async () => settings,
          getSnapshot: async () => snapshot,
          getSessions: async () => [],
          getRelays: async () => [],
          getStt: async () => ({ state: 'ready' }),
          getUsage: async () => null,
          getVersion: async () => 'motion-preview',
          spacesRequest: async () => ({
            ok: true,
            snapshot: {
              ideas: [],
              activeId: null,
              agent,
              workspaces: [],
              spaceOwners: {},
              documents: [],
            },
          }),
          memoryRequest: async () => ({
            ok: false,
            reason: 'No shared memory in this visual test',
          }),
          communicationRequest: async () => ({
            ok: true,
            value: {
              messages: [],
              nativeRequests: [],
              workflows: [],
              assignments: [],
              questions: [],
              events: [],
              cursor: 0,
              snapshotRequired: false,
            },
          }),
          getAgent: async () => agent,
          agentHistory: async () => [],
          agentModels: async () => ({ error: null, models: [] }),
          agentApps: async () => [],
          getOpenMicIndicator: async () => ({ live: false, level: 0 }),
          getMotion: async () => motion,
          getAttentionMotion: async () => ({
            active: window.location.search.includes('attention'),
            provider: 'claude',
            providers: ['claude'],
            width: 140,
            height: 300,
            x: 70,
            y: 11,
            floor: 280,
          }),
          setMotion: (value) => {
            window.motionProof.telemetry = value
          },
          agentSend: async (text) => {
            window.motionProof.agent({
              status: 'working',
              provider: 'claude',
              items: [{ kind: 'you', text }],
            })
            return { ok: true }
          },
          transcribe: () =>
            new Promise((resolve) => {
              window.motionProof.transcribe = resolve
            }),
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
            return (...args) => {
              window.motionProof.calls.push([name, ...args])
            }
          },
        },
      )
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
        configurable: true,
        value: async () => {
          const context = new AudioContext()
          const tone = context.createOscillator()
          tone.frequency.value = 190
          const gain = context.createGain()
          gain.gain.value = window.motionProof.quietInput ? 0 : 0.07
          const destination = context.createMediaStreamDestination()
          tone.connect(gain)
          gain.connect(destination)
          tone.start()
          await context.resume()
          window.motionProof.setLevel = (value) => {
            gain.gain.value = value
          }
          window.motionProof.setFrequency = (value) => {
            tone.frequency.value = value
          }
          for (const track of destination.stream.getTracks()) {
            const stop = track.stop.bind(track)
            track.stop = () => {
              stop()
              tone.stop()
              void context.close()
              window.motionProof.stopped++
            }
          }
          return destination.stream
        },
      })
    },
    { settings: DEFAULT_SETTINGS, agent: IDLE_AGENT, motion: IDLE_MOTION },
  )
  const capture = async (name, locator) => {
    if (screenshots) await locator.screenshot({ path: join(screenshots, `${name}.local.png`) })
  }
  await page.goto(url + '/?view=panel')
  await page.locator('header').waitFor()
  await page.evaluate(() => window.motionProof.settings({ enabledProviders: ['codex'] }))
  await page.locator('[class*="usageTrack"]').waitFor()
  await openHeaderPage(page, 'Agent')
  await page.getByRole('region', { name: 'Voice waveform', exact: true }).waitFor()
  assert.equal(await page.locator('[class*="usageTrack"]').count(), 1)
  await page.waitForTimeout(500)
  const idlePixels = await readMotionFrame(
    page.getByRole('region', { name: 'Voice waveform', exact: true }),
    true,
  )
  assert.ok(idlePixels.span > 0.99, 'quiet header waveform reaches both panel edges')
  const activity = page.getByRole('region', { name: 'Voice activity' })
  assert.equal(await activity.locator('p').count(), 0, 'empty speech has no reserved caption')
  assert.ok(
    (await activity.boundingBox()).height < 38,
    'idle activity reserves only the motion band',
  )
  assert.equal(await activity.getByRole('status').count(), 0)
  assert.equal(
    await page
      .locator('header')
      .getByText(/no active mic/i)
      .count(),
    0,
  )
  assert.equal(await page.getByText(/^Ask it to do something\. Available tools/).count(), 0)
  await capture('agent-idle-header', page.locator('[data-card]'))
  await page.waitForTimeout(1300)
  const drift = await readMotionFrame(
    page.getByRole('region', { name: 'Voice waveform', exact: true }),
  )
  assert.equal(drift.hash, idlePixels.hash, 'the silent header rests')
  await page.getByRole('button', { name: 'Back to sessions', exact: true }).click()
  await page.locator('[class*="usageTrack"]').waitFor()
  assert.equal(await page.getByRole('region', { name: 'Voice waveform', exact: true }).count(), 0)
  await page.evaluate(() => window.motionProof.emit('onTalkHold', 'down'))
  const stage = page.getByRole('region', { name: 'Voice activity' })
  await stage.waitFor({ state: 'attached' })
  const ribbon = page.getByRole('region', { name: 'Voice waveform', exact: true })
  await ribbon.waitFor()
  assert.equal(await stage.locator('canvas').count(), 0)
  const ribbonBounds = await ribbon.boundingBox()
  const cardBounds = await page.locator('[data-card]').boundingBox()
  const headerBounds = await page.locator('header[aria-label="Panel header"]').boundingBox()
  assert.equal(ribbonBounds.height, 36)
  assert.equal(ribbonBounds.width, cardBounds.width - 2)
  assert.equal(ribbonBounds.y + 9, headerBounds.y + headerBounds.height - 1)
  assert.equal(
    await page.locator('header').getByRole('region', { name: 'Voice waveform' }).count(),
    1,
  )
  assert.equal(
    await page.getByRole('status', { name: 'Claude microphone listening', exact: true }).count(),
    0,
  )
  assert.equal(await page.locator('[class*="usageTrack"]').count(), 1)
  await page.waitForFunction(() => window.motionProof.telemetry.input.level > 0.2)
  assert.equal(await ribbon.locator('[data-renderer]').getAttribute('data-renderer'), 'webgl')
  assert.equal(await stage.getByRole('status').count(), 0)
  assert.equal(await page.locator('header').getByText('no active Mic', { exact: true }).count(), 0)
  const first = await ribbon.locator('canvas').screenshot()
  await page.waitForTimeout(150)
  assert.notDeepEqual(await ribbon.locator('canvas').screenshot(), first)
  const speechPixels = await readMotionFrame(ribbon)
  assert.ok(speechPixels.bottom - speechPixels.top > 6, 'speech opens visibly around the divider')
  assert.ok(speechPixels.top >= 0, 'upper crests remain inside their header band')
  await capture('thread-view-speaking', page.locator('[data-card]'))
  assert.ok(
    speechPixels.orange > 0 && speechPixels.blue > 0,
    'microphone speech retains its palette',
  )
  await page.evaluate(() => {
    window.motionProof.setLevel(0.006)
    window.motionProof.setFrequency(1000)
  })
  await page.waitForFunction(() => {
    const input = window.motionProof.telemetry.input
    return input.level > 0.02 && input.level < 0.06 && input.mid > input.level * 0.8
  })
  await page.waitForTimeout(350)
  let quietSpeech
  // A waveform passes through smaller poses between crests; sample its motion
  // rather than requiring a randomly captured frame to be a peak.
  for (let attempt = 0; attempt < 6; attempt++) {
    quietSpeech = await readMotionFrame(ribbon)
    if (quietSpeech.bottom - quietSpeech.top > 5) break
    await page.waitForTimeout(80)
  }
  assert.ok(
    quietSpeech.bottom - quietSpeech.top > 5,
    'ordinary quiet speech remains visibly amplified',
  )
  await capture('quiet-speech-eq', page.locator('[data-card]'))
  await page.evaluate(() => {
    window.motionProof.setLevel(0.07)
    window.motionProof.setFrequency(190)
  })
  await openHeaderPage(page, 'Agent')
  assert.equal(await page.locator('[data-card] canvas').count(), 1)
  assert.equal(await stage.locator('canvas').count(), 0)
  await capture('agent-view-speaking', page.locator('[data-card]'))
  await page.getByRole('button', { name: 'Back to sessions', exact: true }).click()
  assert.equal(await page.locator('header canvas').count(), 1)
  await page.evaluate(() => window.motionProof.setLevel(0))
  await page.waitForFunction(() => window.motionProof.telemetry.input.level === 0)
  assert.equal(await stage.getByRole('status').count(), 0)
  await capture('listening', ribbon)
  await page.evaluate(() => window.motionProof.emit('onTalkHold', 'up'))
  await stage.getByRole('status').filter({ hasText: 'Finishing transcription' }).waitFor()
  await page.locator('header').getByText('no active Mic', { exact: true }).waitFor()
  await page.waitForFunction(() => typeof window.motionProof.transcribe === 'function')
  await page.evaluate(() =>
    window.motionProof.transcribe('Show me how the voice ribbon becomes a Catherine wheel.'),
  )
  await page.waitForFunction(() => window.motionProof.telemetry.mode === 'thinking')
  await page.waitForTimeout(1000)
  await page
    .locator('[data-agent-conversation] [data-kind="you"]')
    .filter({ hasText: 'Show me how the voice ribbon becomes a Catherine wheel.' })
    .waitFor()
  assert.equal(
    await stage.locator('p').count(),
    0,
    'the transcript carries the submitted speech without a duplicate caption',
  )
  assert.equal(await page.evaluate(() => window.motionProof.stopped), 1)
  await capture('thinking', page.locator('[data-card]'))
  const resting = await readMotionFrame(ribbon, true)
  assert.ok(resting.span > 0.98, 'the silent header stays wide during work')
  const work = page.getByRole('img', { name: 'Agent working', exact: true })
  await work.waitFor()
  const spin = await work.locator('canvas').screenshot()
  await page.waitForTimeout(160)
  assert.notDeepEqual(await work.locator('canvas').screenshot(), spin)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.waitForTimeout(1600)
  const still = await ribbon.locator('canvas').screenshot()
  await page.waitForTimeout(200)
  assert.deepEqual(await ribbon.locator('canvas').screenshot(), still)
  await page.evaluate(() => window.motionProof.agent({ status: 'waiting' }))
  await page.waitForFunction(() => window.motionProof.telemetry.mode === 'waiting')
  await work.waitFor({ state: 'detached' })
  await page.evaluate(() => window.motionProof.agent({ status: 'ready' }))
  assert.equal(await stage.getByRole('status').count(), 0)
  await page.emulateMedia({ reducedMotion: 'no-preference' })

  // Force a real GPU context loss, then verify the replacement canvas still animates.
  await ribbon
    .locator('canvas')
    .evaluate((canvas) =>
      canvas.getContext('webgl').getExtension('WEBGL_lose_context').loseContext(),
    )
  await page.waitForFunction(
    () =>
      document.querySelector('[aria-label="Voice waveform"] [data-renderer]')?.dataset.renderer ===
      'canvas',
  )
  await page.evaluate(() => window.motionProof.agent({ status: 'working' }))
  await page.waitForTimeout(500)
  await capture('canvas-fallback', page.locator('[data-card]'))
  assert.ok(
    await ribbon.locator('canvas').evaluate((canvas) =>
      canvas
        .getContext('2d')
        .getImageData(0, 0, canvas.width, canvas.height)
        .data.some((x) => x > 0),
    ),
  )

  // Actual remote WebRTC audio goes through the real LiveVoiceConnection analysis branch.
  await page.evaluate(async () => {
    const { LiveVoiceConnection } = await import('/motion-fixture.js')
    const audioContext = new AudioContext()
    await audioContext.resume()
    const oscillator = audioContext.createOscillator()
    oscillator.frequency.value = 440
    const gain = audioContext.createGain()
    gain.gain.value = 0.08
    const destination = audioContext.createMediaStreamDestination()
    oscillator.connect(gain)
    gain.connect(destination)
    oscillator.start()
    const remote = new RTCPeerConnection()
    remote.addTrack(destination.stream.getAudioTracks()[0], destination.stream)
    remote.ondatachannel = ({ channel }) => {
      channel.onopen = () => channel.send(JSON.stringify({ type: 'session.started' }))
    }
    window.threadlight.agentLiveStart = async (_id, sdp) => {
      await remote.setRemoteDescription({ type: 'offer', sdp })
      await remote.setLocalDescription(await remote.createAnswer())
      await new Promise((resolve) => {
        if (remote.iceGatheringState === 'complete') return resolve()
        remote.onicegatheringstatechange = () => {
          if (remote.iceGatheringState === 'complete') resolve()
        }
      })
      return { ok: true, sdp: remote.localDescription.sdp }
    }
    window.threadlight.agentLiveOpen = async () => ({ ok: true })
    const input = audioContext.createMediaStreamDestination()
    const connection = new LiveVoiceConnection(
      input.stream,
      audioContext.sampleRate,
      () => {},
      audioContext,
    )
    await connection.start()
    if (!connection.connected) throw new Error('Synthetic WebRTC did not connect')
    // Incoming audio must remain visually silent until the opening handoff completes.
    if (connection.outputEnergy.level !== 0) throw new Error('Muted playback produced motion')
    await connection.open('Synthetic voice test')
    connection.setPaused(false)
    window.motionProof.remote = { connection, remote, audioContext, oscillator, gain }
  })
  await page.waitForFunction(() => window.motionProof.remote.connection.outputEnergy.level > 0.1)
  await page.evaluate(() => {
    const e = window.motionProof.remote.connection.outputEnergy
    window.motionProof.emit('onMotion', {
      mode: 'listening',
      input: { level: 0, low: 0, mid: 0, high: 0 },
      output: e,
    })
    window.motionProof.remote.connection.setPaused(true)
  })
  assert.equal(
    await page.evaluate(() => window.motionProof.remote.connection.outputEnergy.level),
    0,
  )
  await page.evaluate(() => {
    const { connection, remote, audioContext, oscillator } = window.motionProof.remote
    connection.stop()
    remote.close()
    oscillator.stop()
    void audioContext.close()
  })
  assert.equal(
    await page.evaluate(() => window.motionProof.remote.connection.outputEnergy.level),
    0,
  )

  // Exercise actual GPT Live hook -> WebRTC analyser -> motion source -> header pixels.
  await page.evaluate(async () => {
    window.motionProof.quietInput = true
    const context = new AudioContext()
    await context.resume()
    const oscillator = context.createOscillator()
    oscillator.frequency.value = 1000
    const gain = context.createGain()
    gain.gain.value = 0.016
    const destination = context.createMediaStreamDestination()
    oscillator.connect(gain)
    gain.connect(destination)
    oscillator.start()
    const remote = new RTCPeerConnection()
    remote.addTrack(destination.stream.getAudioTracks()[0], destination.stream)
    remote.ondatachannel = ({ channel }) => {
      channel.onopen = () => channel.send(JSON.stringify({ type: 'session.started' }))
    }
    window.threadlight.agentLiveStart = async (_id, sdp) => {
      await remote.setRemoteDescription({ type: 'offer', sdp })
      await remote.setLocalDescription(await remote.createAnswer())
      await new Promise((resolve) => {
        if (remote.iceGatheringState === 'complete') return resolve()
        remote.onicegatheringstatechange = () => {
          if (remote.iceGatheringState === 'complete') resolve()
        }
      })
      return { ok: true, sdp: remote.localDescription.sdp }
    }
    window.motionProof.nativeLive = { context, oscillator, gain, remote }
    window.motionProof.settings({
      voiceMode: 'gpt-live',
      talkMode: 'toggle',
      agentProvider: 'codex',
    })
    window.motionProof.agent({ provider: 'codex', status: 'ready' })
  })
  await ribbon.locator('[data-provider="codex"]').waitFor()
  await page.evaluate(() => window.motionProof.emit('onTalkToggle'))
  await page.waitForFunction(() => window.motionProof.telemetry.output.level > 0.035)
  await ribbon.locator('[data-provider="codex"]').waitFor()
  await page.waitForTimeout(700)
  const agentSpeech = await readMotionFrame(ribbon)
  assert.ok(agentSpeech.blue > agentSpeech.orange * 3, 'GPT Live playback fades into Codex blue')
  assert.ok(
    agentSpeech.bottom - agentSpeech.top > 5,
    'actual playback drives amplified header motion',
  )
  await capture('gpt-live-provider-speech', page.locator('[data-card]'))
  for (const [band, frequency] of [
    ['low', 180],
    ['mid', 1000],
    ['high', 4500],
  ]) {
    await page.evaluate((frequency) => {
      window.motionProof.nativeLive.oscillator.frequency.value = frequency
    }, frequency)
    await page.waitForFunction((band) => {
      const output = window.motionProof.telemetry.output
      return output.level > 0.02 && output[band] > output.level * 0.75
    }, band)
  }
  await page.evaluate(() => {
    window.motionProof.nativeLive.gain.gain.value = 0
  })
  await page.waitForFunction(() => window.motionProof.telemetry.output.level === 0)
  await page.waitForTimeout(1000)
  const afterSpeech = await readMotionFrame(ribbon)
  assert.ok(
    afterSpeech.orange === 0 && afterSpeech.blue < agentSpeech.blue,
    'silence restores the resting ribbon after playback',
  )
  await capture('gpt-live-provider-silence', page.locator('[data-card]'))
  await page.evaluate(() => window.motionProof.emit('onStopOpenMic'))
  await page.waitForFunction(() => document.documentElement.dataset.openMic === 'off')
  await page.evaluate(() => {
    const { context, oscillator, remote } = window.motionProof.nativeLive
    remote.close()
    oscillator.stop()
    void context.close()
  })

  await page.goto(url + '/?view=dot')
  await page.getByRole('status').waitFor()
  await page.waitForTimeout(500)
  await capture('idle-dot', page.locator('#root'))
  await page.evaluate(() =>
    window.motionProof.emit('onMotion', {
      mode: 'thinking',
      input: { level: 0, low: 0, mid: 0, high: 0 },
      output: { level: 0, low: 0, mid: 0, high: 0 },
    }),
  )
  await page.waitForTimeout(500)
  await capture('thinking-dot', page.locator('#root'))
  let activeColours
  for (let attempt = 0; attempt < 16; attempt++) {
    activeColours = await readMotionFrame(page.locator('#root'))
    if (activeColours.orange > 0 && activeColours.blue > 0) break
    await page.waitForTimeout(100)
  }
  assert.ok(
    activeColours.orange > 0 && activeColours.blue > 0,
    `active dot renders orange strands and a blue shine: ${JSON.stringify(activeColours)}`,
  )
  await capture('thinking-dot-blue-orange', page.locator('#root'))
  await page.evaluate(() => {
    window.motionProof.emit('onOpenMicLive', true)
    window.motionProof.emit('onMotion', {
      mode: 'listening',
      input: { level: 0, low: 0, mid: 0, high: 0 },
      output: { level: 0.65, low: 0.4, mid: 0.5, high: 0.2 },
    })
  })
  const pill = page.getByRole('group', { name: 'Microphone is open', exact: true })
  await pill.getByRole('img', { name: 'Agent speaking', exact: true }).waitFor()
  assert.equal((await pill.boundingBox()).width, 92)
  assert.equal((await pill.boundingBox()).height, 24)
  await page.waitForTimeout(350)
  await capture('agent-speaking-pill', pill)
  await pill.getByRole('button', { name: 'End voice call', exact: true }).click()
  assert.ok(
    await page.evaluate(() => window.motionProof.calls.some(([name]) => name === 'stopOpenMic')),
  )

  await page.addInitScript(() => {
    const native = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      return type === 'webgl' ? null : native.call(this, type, ...args)
    }
  })
  await page.reload()
  await page.waitForFunction(
    () => document.querySelector('[data-renderer]')?.dataset.renderer === 'canvas',
  )
  await page.addInitScript(() => {
    if (window.location.search.includes('attention'))
      // Milliseconds. One thread: a drip leaves every 6 s, the first at 0, so 1297 ms is 1.3 s
      // into it, with the pool still forming.
      Date.now = () => window.motionProof.attentionClock ?? 1297
  })
  await page.goto(url + '/?view=attention')
  const attention = page.locator('[data-attention-provider]')
  await attention.waitFor()
  // The wheel has its own colours (and a shimmer that moves with the clock), so the liquid is
  // measured with the wheel hidden.
  const liquidOnly = async () => {
    const hide = await page.addStyleTag({
      content: '[data-attention-provider] canvas:first-child { visibility: hidden }',
    })
    try {
      return await readMotionFrame(attention)
    } finally {
      await hide.evaluate((element) => element.remove())
    }
  }
  let painted = await liquidOnly()
  assert.ok(painted.orange > painted.blue, 'Claude attention uses the orange provider palette')
  const claudeFrame = painted
  await capture('claude-attention-pool', attention)
  await page.evaluate(() =>
    window.motionProof.emit('onAttentionMotion', {
      active: true,
      provider: 'codex',
      providers: ['codex'],
      width: 140,
      height: 300,
      x: 70,
      y: 11,
      floor: 280,
    }),
  )
  await page.locator('[data-attention-provider="codex"]').waitFor()
  // A drip takes its thread's colour as it is born, so the next one (at 6 s) is the Codex one.
  await page.evaluate(() => {
    window.motionProof.attentionClock = 7300
  })
  await page.waitForTimeout(150)
  painted = await liquidOnly()
  // The wheel keeps its own Claude-orange design for every provider; only the liquid changes.
  assert.ok(painted.blue > painted.orange, 'Codex attention liquid uses the blue provider palette')
  assert.ok(painted.blue > claudeFrame.blue, 'and Claude liquid has none of it')
  await capture('codex-attention-pool', attention)
  await page.evaluate(() => {
    window.motionProof.attentionClock = 8200
  })
  await page.waitForTimeout(100)
  painted = await readMotionFrame(attention)
  assert.ok(
    painted.bottom > 260,
    'the production liquid reaches its native taskbar collision plane',
  )
  await capture('codex-attention-splash', attention)

  // Four threads wait, so a drip leaves every 1.5 s and a Codex splash is still settling as the
  // next Claude drop forms. The wheel is orange either way, so measure the liquid layer alone.
  const waiting = (providers) =>
    page.evaluate(
      (providers) =>
        window.motionProof.emit('onAttentionMotion', {
          active: true,
          provider: providers[0],
          providers,
          width: 140,
          height: 300,
          x: 70,
          y: 11,
          floor: 280,
        }),
      providers,
    )
  // The list changes first and the clock jumps after, so the drips are rebuilt from the new list.
  await waiting(['claude', 'claude', 'claude', 'claude'])
  await page.waitForFunction(
    () => document.querySelector('[aria-label="4 threads need input"]') !== null,
  )
  await page.evaluate(() => {
    window.motionProof.attentionClock = 1500900
  })
  await page.waitForTimeout(150)
  const allClaude = await liquidOnly()
  assert.ok(allClaude.orange > 20 && allClaude.blue < 5, 'four Claude threads drip only orange')
  // Drops already falling keep their colour, so the next one (at 1501.5 s) is the Codex drop and
  // the Claude drop before it is still settling.
  await waiting(['claude', 'codex', 'claude', 'codex'])
  await page.evaluate(() => {
    window.motionProof.attentionClock = 1502400
  })
  await page.waitForTimeout(150)
  const mixed = await liquidOnly()
  assert.ok(
    mixed.orange > 20 && mixed.blue > 20,
    "several drips run at once, each in its own thread's colour",
  )
  await capture('mixed-attention-drips', attention)
  await waiting(['codex'])
  await page.evaluate(() => {
    window.motionProof.attentionClock = 8200
  })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.waitForTimeout(150)
  const hanging = await attention.screenshot()
  await page.evaluate(() => {
    window.motionProof.attentionClock = 50000
  })
  await page.waitForTimeout(150)
  assert.deepEqual(
    await attention.screenshot(),
    hanging,
    'reduced motion holds a provider-coloured wheel and bead steady',
  )
  await page.evaluate(async () =>
    window.motionProof.emit('onAttentionMotion', {
      ...(await window.threadlight.getAttentionMotion()),
      provider: 'codex',
      active: false,
    }),
  )
  await page.waitForFunction(
    () =>
      document.querySelector('[data-attention-provider]')?.getAttribute('aria-hidden') === 'true',
  )
  const paused = await attention.screenshot()
  assert.deepEqual(paused, hanging, 'the last painted attention frame survives the native hide')
  await page.waitForTimeout(150)
  assert.deepEqual(
    await attention.screenshot(),
    paused,
    'inactive attention retains a painted, paused frame',
  )
  assert.deepEqual(errors, [])
  console.log(
    'PASS: real microphone analysis, speech/silence, content-sized captions, separate thinking mark and resting audio ribbon, reduced motion, context loss, native WebRTC playback/mute/stop, compact pill and unavailable-WebGL fallback.',
  )
} catch (error) {
  console.error('Browser errors:', errors)
  console.error((await testPage?.locator('body').innerText())?.slice(0, 1800))
  if (screenshots) await testPage?.screenshot({ path: join(screenshots, 'motion-error.local.png') })
  throw error
} finally {
  await browser?.close()
  await new Promise((done) => server.close(done))
}
