/* global window, RTCPeerConnection, AudioContext, MediaStream */
// Opt-in. Uses the existing Codex sign-in, an ephemeral thread and muted Chrome output.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const ts = require('typescript')
const transpile = (file) =>
  ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
require.extensions['.ts'] = (module, file) => module._compile(transpile(file), file)
const { CodexClient } = require('../../src/main/agent/codexClient.ts')
const { ScreenReplyVoice } = require('../../src/main/agent/screenReplyVoice.ts')
async function run() {
  if (process.env.THREADLIGHT_LIVE_SMOKE !== '1')
    return console.log('Skipped signed-in speaker check.')
  const pace = process.env.THREADLIGHT_TEST_VOICE_PACE || 'normal'
  const measure = !!process.env.THREADLIGHT_TEST_VOICE_PACE
  const { VOICE_PACES } = require('../../src/shared/voicePace.ts')
  assert.ok(VOICE_PACES.includes(pace))
  const passage =
    'The amber lantern is ready. Look at the first line of the function. Now follow the value down to the return statement. Each step uses the result of the previous step. Which line would you like to look at next?'
  const { chromium } = require(process.env.THREADLIGHT_PLAYWRIGHT || 'playwright')
  const browser = await chromium.launch({
    executablePath: process.env.THREADLIGHT_CHROMIUM,
    args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
  })
  let service
  try {
    const page = await browser.newPage()
    page.on('pageerror', (err) => console.log(err.message))
    await page.route('http://localhost:17896/', (r) =>
      r.fulfill({ contentType: 'text/html', body: '<!doctype html>' }),
    )
    await page.goto('http://localhost:17896/')
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'tl-speaker-'))
    let transcript = '',
      failure = '',
      finished = false
    service = new ScreenReplyVoice(
      async () => {
        const client = new CodexClient(
          { command: process.env.THREADLIGHT_CODEX_CLI, prefixArgs: [] },
          folder,
        )
        await client.initialize()
        return client
      },
      (event) => void page.evaluate((e) => window.playbackEvent(e), event).catch(() => {}),
      (error) => {
        failure = error
      },
      () => pace,
    )
    await page.exposeFunction('command', async (id, action, sdp) => {
      if (action === 'offer') assert.match(sdp, /a=sendrecv/)
      const result = await service.command(id, action, sdp)
      if (!result.ok) console.error(action, result.reason)
      if (action === 'done') finished = true
      return result
    })
    await page.exposeFunction('transcript', (t) => {
      transcript = t
    })
    await page.evaluate((measure) => {
      window.exports = {}
      window.micRequests = 0
      navigator.mediaDevices.getUserMedia = async () => {
        window.micRequests++
        throw Error('Unexpected microphone request')
      }
      const create = RTCPeerConnection.prototype.createDataChannel
      RTCPeerConnection.prototype.createDataChannel = function (...args) {
        if (measure)
          this.addEventListener(
            'track',
            ({ track }) => {
              if (track.kind !== 'audio') return
              const clock = new AudioContext()
              const source = clock.createMediaStreamSource(new MediaStream([track]))
              const analyser = clock.createAnalyser()
              analyser.fftSize = 512
              source.connect(analyser)
              const samples = new Float32Array(analyser.fftSize)
              void clock.resume()
              window.measureTimer = setInterval(() => {
                analyser.getFloatTimeDomainData(samples)
                if (samples.some((value) => Math.abs(value) > 0.005)) {
                  window.firstSound ??= clock.currentTime
                  window.lastSound = clock.currentTime
                }
              }, 10)
            },
            { once: true },
          )
        const channel = create.apply(this, args)
        channel.addEventListener('message', ({ data }) => {
          const e = JSON.parse(data)
          if (e.type === 'turn.done' && e.turn?.role === 'assistant')
            window.transcript(e.turn.transcript)
        })
        return channel
      }
    }, measure)
    await page.addScriptTag({
      content: transpile(path.resolve(__dirname, '../../src/renderer/lib/screenReplyPlayback.ts')),
    })
    await page.evaluate(() =>
      window.exports.watchScreenReplies({
        onScreenVoice(fn) {
          window.playbackEvent = fn
          return () => {}
        },
        screenVoiceCommand: window.command,
      }),
    )
    service.speak(
      measure ? passage : 'The amber lantern is ready. Which window should we look at next?',
    )
    const deadline = Date.now() + 75000
    while (!failure && !finished && Date.now() < deadline)
      await new Promise((r) => setTimeout(r, 250))
    assert.equal(failure, '')
    assert.ok(finished, 'Received and drained non-silent audio before ending playback')
    assert.match(transcript, /amber lantern/i)
    assert.match(transcript, /next/i)
    assert.equal(await page.evaluate(() => window.micRequests), 0)
    if (measure) {
      const seconds = await page.evaluate(() => {
        clearInterval(window.measureTimer)
        return window.lastSound - window.firstSound
      })
      const words = (value) => value.toLowerCase().match(/[a-z]+/g)
      assert.deepEqual(words(transcript), words(passage))
      assert.ok(seconds > 2)
      console.log(JSON.stringify({ pace, decodedSpeechSpanSeconds: seconds }))
    }
    console.log(
      'PASS signed-in GPT voice, expected spoken question, output audio drained, zero mic requests',
    )
  } finally {
    service?.stop()
    await browser.close()
  }
}
run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
