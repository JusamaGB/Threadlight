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
  browser = await chromium.launch({ headless: true, args: ['--mute-audio'] })
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
          getAgent: async () => agent,
          agentHistory: async () => [],
          agentModels: async () => ({ error: null, models: [] }),
          agentApps: async () => [],
          getOpenMicIndicator: async () => ({ live: false, level: 0 }),
          getMotion: async () => motion,
          getAttentionMotion: async () => ({
            active: window.location.search.includes('attention'),
            provider: 'claude',
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
          gain.gain.value = 0.07
          const destination = context.createMediaStreamDestination()
          tone.connect(gain)
          gain.connect(destination)
          tone.start()
          await context.resume()
          window.motionProof.setLevel = (value) => {
            gain.gain.value = value
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
  await page.getByRole('button', { name: 'Agent: ask it to do something', exact: true }).waitFor()
  await page.evaluate(() => window.motionProof.settings({ enabledProviders: ['codex'] }))
  await page.locator('[class*="usageTrack"]').waitFor()
  await page.getByRole('button', { name: 'Agent: ask it to do something', exact: true }).click()
  await page.getByRole('region', { name: 'Voice waveform', exact: true }).waitFor()
  assert.equal(await page.locator('[class*="usageTrack"]').count(), 1)
  await page.waitForTimeout(500)
  const idlePixels = await readMotionFrame(
    page.getByRole('region', { name: 'Voice waveform', exact: true }),
  )
  assert.ok(idlePixels.span > 0.99, 'quiet header waveform reaches both panel edges')
  const activity = page.getByRole('region', { name: 'Voice activity' })
  assert.equal(await activity.locator('p').count(), 0, 'empty speech has no reserved caption')
  assert.ok(
    (await activity.boundingBox()).height < 38,
    'idle activity reserves only the motion band',
  )
  await activity
    .getByRole('status')
    .filter({ hasText: /^Ready - No active Mic$/ })
    .waitFor()
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
  assert.notEqual(drift.hash, idlePixels.hash, 'quiet header colours continue evolving')
  await page.getByRole('button', { name: 'Back to sessions', exact: true }).click()
  await page.locator('[class*="usageTrack"]').waitFor()
  assert.equal(await page.getByRole('region', { name: 'Voice waveform', exact: true }).count(), 0)
  await page.evaluate(() => window.motionProof.emit('onTalkHold', 'down'))
  const stage = page.getByRole('region', { name: 'Voice activity' })
  await stage.waitFor()
  const ribbon = page.getByRole('region', { name: 'Voice waveform', exact: true })
  await ribbon.waitFor()
  assert.equal(await stage.locator('canvas').count(), 0)
  const ribbonBounds = await ribbon.boundingBox()
  const cardBounds = await page.locator('[data-card]').boundingBox()
  const headerBounds = await page.locator('[data-card] > header').boundingBox()
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
  await stage.getByRole('status').filter({ hasText: 'You speaking' }).waitFor()
  assert.equal(await page.locator('header').getByText('no active Mic', { exact: true }).count(), 0)
  const first = await ribbon.locator('canvas').screenshot()
  await page.waitForTimeout(150)
  assert.notDeepEqual(await ribbon.locator('canvas').screenshot(), first)
  const speechPixels = await readMotionFrame(ribbon)
  assert.ok(speechPixels.bottom - speechPixels.top > 6, 'speech opens visibly around the divider')
  assert.ok(speechPixels.top >= 0, 'upper crests remain inside their header band')
  await capture('thread-view-speaking', page.locator('[data-card]'))
  await page.getByRole('button', { name: 'Agent: ask it to do something', exact: true }).click()
  assert.equal(await page.locator('[data-card] canvas').count(), 1)
  assert.equal(await stage.locator('canvas').count(), 0)
  await capture('agent-view-speaking', page.locator('[data-card]'))
  await page.getByRole('button', { name: 'Back to sessions', exact: true }).click()
  assert.equal(await page.locator('header canvas').count(), 1)
  await page.evaluate(() => window.motionProof.setLevel(0))
  await page.waitForFunction(() => window.motionProof.telemetry.input.level === 0)
  await stage
    .getByRole('status')
    .filter({ hasText: /^Listening$/ })
    .waitFor()
  await capture('listening', stage)
  const before = await stage.boundingBox()
  await page.evaluate(() => window.motionProof.emit('onTalkHold', 'up'))
  await stage.getByRole('status').filter({ hasText: 'Finishing transcription' }).waitFor()
  await page.locator('header').getByText('no active Mic', { exact: true }).waitFor()
  await page.waitForFunction(() => typeof window.motionProof.transcribe === 'function')
  await page.evaluate(() =>
    window.motionProof.transcribe('Show me how the voice ribbon becomes a Catherine wheel.'),
  )
  await stage.getByRole('status').filter({ hasText: 'Thinking' }).waitFor()
  await page.waitForTimeout(1000)
  assert.ok((await stage.boundingBox()).height > before.height, 'speech grows the caption area')
  assert.equal(
    await stage.locator('p').innerText(),
    'Show me how the voice ribbon becomes a Catherine wheel.',
  )
  assert.ok((await stage.locator('p').boundingBox()).height <= 52, 'long captions stay bounded')
  assert.equal(await page.evaluate(() => window.motionProof.stopped), 1)
  await capture('thinking', page.locator('[data-card]'))
  const wheelPixels = await readMotionFrame(ribbon)
  assert.ok(
    wheelPixels.top < 9 && wheelPixels.bottom > 9,
    `thinking wheel is centred on the divider: ${JSON.stringify(wheelPixels)}`,
  )
  assert.ok(wheelPixels.left < 3 && wheelPixels.right < 18, 'wheel hugs the left wall')
  assert.ok(wheelPixels.span < 0.08, 'thinking settles into the connected compact wheel')
  const spin = await ribbon.locator('canvas').screenshot()
  await page.waitForTimeout(160)
  assert.notDeepEqual(await ribbon.locator('canvas').screenshot(), spin)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.waitForTimeout(1600)
  const still = await ribbon.locator('canvas').screenshot()
  await page.waitForTimeout(200)
  assert.deepEqual(await ribbon.locator('canvas').screenshot(), still)
  await page.evaluate(() => window.motionProof.agent({ status: 'waiting' }))
  await stage.getByRole('status').filter({ hasText: 'Waiting for you' }).waitFor()
  await page.evaluate(() => window.motionProof.agent({ status: 'ready' }))
  await stage.getByRole('status').filter({ hasText: 'Ready' }).waitFor()
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
  assert.equal((await pill.boundingBox()).height, 18)
  await page.waitForTimeout(350)
  await capture('agent-speaking-pill', pill)
  await pill.getByRole('button', { name: 'Close microphone', exact: true }).click()
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
      Date.now = () => window.motionProof.attentionClock ?? 1300
  })
  await page.goto(url + '/?view=attention')
  const attention = page.locator('[data-attention-provider]')
  await attention.waitFor()
  let painted = await readMotionFrame(attention)
  assert.ok(painted.orange > painted.blue, 'Claude attention uses the orange provider palette')
  await capture('claude-attention-pool', attention)
  await page.evaluate(() =>
    window.motionProof.emit('onAttentionMotion', {
      active: true,
      provider: 'codex',
      width: 140,
      height: 300,
      x: 70,
      y: 11,
      floor: 280,
    }),
  )
  await page.locator('[data-attention-provider="codex"]').waitFor()
  painted = await readMotionFrame(attention)
  assert.ok(painted.blue > painted.orange, 'Codex attention uses the blue provider palette')
  await capture('codex-attention-pool', attention)
  await page.evaluate(() => {
    window.motionProof.attentionClock = 2150
  })
  await page.waitForTimeout(100)
  painted = await readMotionFrame(attention)
  assert.ok(
    painted.bottom > 260,
    'the production liquid reaches its native taskbar collision plane',
  )
  await capture('codex-attention-splash', attention)
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
  await page.evaluate(() => window.motionProof.emit('onAttentionMotion', { active: false }))
  await page.waitForFunction(() => !document.querySelector('[data-attention-provider]'))
  assert.deepEqual(errors, [])
  console.log(
    'PASS: real microphone analysis, speech/silence, content-sized captions, thinking morph, reduced motion, context loss, native WebRTC playback/mute/stop, compact pill and unavailable-WebGL fallback.',
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
