/* global AudioContext, Audio, RTCPeerConnection, window, MediaStream */
// Replays a text-only final-answer event trace into CodexLive. Its speech RPC drives a
// local WebRTC sender with recorded synthetic speech. No account, microphone or speakers.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { performance } from 'node:perf_hooks'
import { setTimeout as wait } from 'node:timers/promises'
const require = createRequire(import.meta.url)
const ts = require('typescript')
require.extensions['.ts'] = (module, file) =>
  module._compile(
    ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    file,
  )
const { CodexLive } = require('../../src/main/agent/codexLive.ts')
const { chromium } = require(process.env.THREADLIGHT_PLAYWRIGHT || 'playwright')
const [traceFile, waveFile] = process.argv.slice(2)
const events = JSON.parse(readFileSync(traceFile, 'utf8'))
const start = events.find((e) => e.event === 'item/started' && e.phase === 'final_answer')
const finish = events.find((e) => e.event === 'turn/completed')
assert.ok(start && finish)
const browser = await chromium.launch({
  executablePath: process.env.THREADLIGHT_CHROMIUM,
  args: ['--autoplay-policy=no-user-gesture-required'],
})
try {
  const page = await browser.newPage()
  await page.goto('about:blank')
  await page.evaluate(async (wav) => {
    const ctx = new AudioContext()
    await ctx.resume()
    const buffer = await ctx.decodeAudioData(
      Uint8Array.from(atob(wav), (c) => c.charCodeAt(0)).buffer,
    )
    const paths = {}
    for (const name of ['early', 'old']) {
      const tx = new RTCPeerConnection(),
        rx = new RTCPeerConnection(),
        stream = ctx.createMediaStreamDestination()
      const meter = ctx.createAnalyser(),
        quiet = ctx.createGain()
      quiet.gain.value = 0
      meter.connect(quiet)
      quiet.connect(ctx.destination)
      const el = new Audio()
      el.muted = true
      rx.ontrack = (e) => {
        const media = new MediaStream([e.track])
        el.srcObject = media
        void el.play()
        ctx.createMediaStreamSource(media).connect(meter)
      }
      tx.addTrack(stream.stream.getAudioTracks()[0], stream.stream)
      const local = async (pc, offer) => {
        await pc.setLocalDescription(offer)
        if (pc.iceGatheringState !== 'complete')
          await new Promise((resolve) =>
            pc.addEventListener('icegatheringstatechange', () => {
              if (pc.iceGatheringState === 'complete') resolve()
            }),
          )
        return pc.localDescription
      }
      await rx.setRemoteDescription(await local(tx, await tx.createOffer()))
      await tx.setRemoteDescription(await local(rx, await rx.createAnswer()))
      paths[name] = { rx, tx, meter, stream, el }
    }
    window.testClock = () => performance.now()
    window.handoff = async (name) => {
      const p = paths[name],
        bytes = async () =>
          [...(await p.rx.getStats()).values()].find(
            (r) => r.type === 'inbound-rtp' && r.kind === 'audio',
          )?.bytesReceived ?? 0
      const before = await bytes(),
        at = performance.now()
      const src = ctx.createBufferSource()
      src.buffer = buffer
      src.connect(p.stream)
      const finished = new Promise((resolve) => {
        src.onended = resolve
      })
      src.start()
      const samples = new Float32Array(1024)
      const result = (p.result = { at })
      for (let n = 0; n < 300 && !(result.packet && result.sound); n++) {
        p.meter.getFloatTimeDomainData(samples)
        if (!result.sound && samples.some((v) => Math.abs(v) > 0.008))
          result.sound = performance.now()
        if (!result.packet && (await bytes()) > before) result.packet = performance.now()
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      await finished
    }
    window.results = () =>
      Object.fromEntries(Object.entries(paths).map(([name, p]) => [name, p.result]))
  }, readFileSync(waveFile).toString('base64'))
  const nativeZero = await page.evaluate(() => window.testClock())
  const zero = performance.now()
  const audio = []
  const stages = {}
  const submitted = []
  const live = new CodexLive(
    {
      request: async (method, params) => {
        assert.equal(method, 'thread/realtime/appendSpeech')
        assert.ok(!params.text.includes('```'))
        const quoted = params.text.split('Do not delegate or execute it: ')[1]
        submitted.push(JSON.parse(quoted))
        if (submitted.length === 1) {
          stages.handoff = Math.round(performance.now() - zero + start.ms)
          audio.push(
            page
              .evaluate(() => window.handoff('early'))
              .then(() => live.playbackBoundary('done', 'fixture-lead')),
          )
          queueMicrotask(() => {
            live.playbackBoundary('assistant', 'fixture-lead')
            live.event('thread/realtime/item/completed', {
              threadId: 'fixture',
              item: {
                id: 'fixture-caption',
                type: 'transcriptSegment',
                role: 'assistant',
                text: submitted[0],
              },
            })
          })
        } else stages.tailHandoff = Math.round(performance.now() - zero + start.ms)
        return {}
      },
    },
    'fixture',
    'voice',
    () => {},
    () => {},
  )
  live.beginTurn('sample')
  let text = ''
  for (const e of events.filter((e) => e.ms >= start.ms)) {
    const delay = e.ms - start.ms - (performance.now() - zero)
    if (delay > 1) await wait(delay)
    if (e.event === 'item/agentMessage/delta' && e.itemId === start.itemId) {
      text += e.text
      live.streamFinal('sample', e.itemId, text)
      if (stages.handoff && !stages.lead) stages.lead = e.ms
      if (text.includes('```') && !stages.example) stages.example = e.ms
    } else if (e.event === 'turn/completed') {
      stages.full = finish.ms
      audio.push(page.evaluate(() => window.handoff('old')))
      await live.finishTurn({
        id: 'sample',
        status: 'completed',
        items: [{ id: start.itemId, type: 'agentMessage', phase: 'final_answer', text }],
      })
    }
  }
  await Promise.all(audio)
  const { spokenProse } = require('../../src/shared/spokenProse.ts')
  assert.equal(submitted.length, 2)
  assert.equal(submitted.join(' ').replace(/\s+/g, ' '), spokenProse(text).replace(/\s+/g, ' '))
  const results = await page.evaluate(() => window.results())
  const measured = {}
  for (const [name, v] of Object.entries(results)) {
    assert.ok(v.packet && v.sound, JSON.stringify({ name, v, results, stages }))
    measured[name] = Object.fromEntries(
      Object.entries(v).map(([k, t]) => [k, Math.round(t - nativeZero + start.ms)]),
    )
  }
  assert.ok(measured.early.sound < stages.full && measured.old.sound >= stages.full)
  console.log(JSON.stringify({ stages, localWebRTC: measured }, null, 2))
} finally {
  await browser.close()
}
