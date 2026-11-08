import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { LiveVoiceConnection } from '../src/renderer/lib/liveVoice'
import { LiveAudioBuffer } from '../src/renderer/lib/liveAudioBuffer'
class Peer {
  static current
  static earlyStart = false
  connectionState = 'new'
  localDescription = { sdp: 'v=0' }
  channel = {
    readyState: 'connecting',
    onmessage: undefined,
    onopen: undefined,
    onclose: undefined,
  }
  constructor() {
    Peer.current = this
  }
  addTrack() {}
  createDataChannel() {
    return this.channel
  }
  async createOffer() {
    return this.localDescription
  }
  async setLocalDescription() {}
  async setRemoteDescription() {
    this.connectionState = 'connected'
    this.channel.readyState = 'open'
    if (Peer.earlyStart) this.event('session.started')
  }
  event(type) {
    this.channel.onmessage?.({ data: JSON.stringify({ type }) })
  }
  close() {
    this.connectionState = 'closed'
  }
}
const api = {
  agentLiveStart: vi.fn(async () => ({ ok: true, sdp: 'v=0' })),
  agentLiveOpen: vi.fn(async () => ({ ok: true })),
  agentLiveStop: vi.fn(),
  getAgent: vi.fn(async () => ({ status: 'ready', live: 'active' })),
  livePlaybackBoundary: vi.fn(),
  onAgentLive: vi.fn(() => () => {}),
}
const state = vi.fn()
let connection
let playback
beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  api.getAgent.mockResolvedValue({ status: 'ready', live: 'active' })
  Peer.earlyStart = false
  vi.stubGlobal('RTCPeerConnection', Peer)
  playback = { play: vi.fn(async () => {}), pause: vi.fn() }
  vi.stubGlobal('Audio', function Audio() {
    return playback
  })
  vi.stubGlobal('window', { threadlight: api })
  connection = new LiveVoiceConnection({ getAudioTracks: () => [{}] }, 16000, state)
})
afterEach(() => {
  connection.stop()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
async function transport() {
  const starting = connection.start()
  await vi.advanceTimersByTimeAsync(0)
  return { starting, peer: Peer.current }
}
async function ready() {
  const { starting, peer } = await transport()
  peer.event('session.started')
  await starting
  return peer
}
it.each(['native', 'acknowledged opening'])(
  'allows remote reply playback during %s and silences it on pause or stop',
  async (entry) => {
    const peer = await ready()
    const remote = {}
    peer.ontrack({ streams: [remote] })
    expect(playback.srcObject).toBe(remote)
    expect(playback.play).toHaveBeenCalledTimes(1)
    expect(playback.muted).toBe(true)
    if (entry === 'native') connection.listen()
    else await connection.open('Can you hear me?')
    expect(playback.muted).toBe(false)
    connection.setPaused(true)
    expect(playback.muted).toBe(true)
    connection.setPaused(false)
    expect(playback.muted).toBe(false)
    connection.stop()
    expect(playback.pause).toHaveBeenCalledTimes(1)
    expect(playback.srcObject).toBeNull()
  },
)
it('silences just the interrupted narration and plays the next distinct response', async () => {
  const peer = await ready()
  connection.listen()
  const notify = api.onAgentLive.mock.calls[0][0]
  const start = (id) =>
    peer.channel.onmessage({
      data: JSON.stringify({ type: 'turn.created', turn: { role: 'assistant', id } }),
    })
  start('one')
  notify({ sessionId: connection.id, type: 'interrupt-narration', turnId: 'other' })
  expect(playback.muted).toBe(false)
  notify({ sessionId: connection.id, type: 'interrupt-narration', turnId: 'one' })
  expect(playback.muted).toBe(true)
  start('two')
  expect(playback.muted).toBe(false)
  expect(api.livePlaybackBoundary).toHaveBeenCalledWith(connection.id, 'assistant', 'two')
})
it('passes the native words on the completed playback boundary for the active assistant turn', async () => {
  const peer = await ready()
  connection.listen()
  const send = (type, id, transcript) =>
    peer.channel.onmessage({
      data: JSON.stringify({ type, turn: { id, role: 'assistant', transcript } }),
    })
  send('turn.created', 'progress')
  for (const role of ['user', 'tool']) {
    peer.channel.onmessage({
      data: JSON.stringify({
        type: 'turn.done',
        turn: { id: 'progress', role, transcript: 'I’ll check the current buffer.' },
      }),
    })
  }
  expect(api.livePlaybackBoundary.mock.calls.filter(([, kind]) => kind === 'done')).toHaveLength(0)
  send('turn.done', 'stale', 'An unrelated completion.')
  expect(api.livePlaybackBoundary).not.toHaveBeenCalledWith(
    connection.id,
    'done',
    'stale',
    expect.anything(),
  )
  send('turn.done', 'progress', 'I’ll check the current buffer.')
  expect(api.livePlaybackBoundary).toHaveBeenCalledWith(
    connection.id,
    'done',
    'progress',
    'I’ll check the current buffer.',
  )
})

it('sends silence during composer dictation while keeping remote audio and the connection active', async () => {
  const peer = await ready()
  connection.listen()
  const input = new Float32Array([0.2, 0.5])
  const output = new Float32Array(input)
  connection.setInputMuted(true)
  connection.process(input, output)
  expect([...output]).toEqual([0, 0])
  expect(connection.bufferedSeconds).toBe(0)
  expect(playback.muted).toBe(false)
  expect(peer.connectionState).toBe('connected')
  connection.setInputMuted(false)
  connection.process(input, output)
  expect(output).toEqual(input)
})
it('stops only the playing reply, keeps input and speaker toggles independent and ignores repeated turn events', async () => {
  const peer = await ready()
  connection.listen()
  const turn = (id) =>
    peer.channel.onmessage({
      data: JSON.stringify({ type: 'turn.created', turn: { id, role: 'assistant' } }),
    })
  turn('first')
  connection.stopSpeaking()
  expect(playback.muted).toBe(true)
  connection.setInputMuted(true)
  connection.setOutputMuted(true)
  turn('second')
  expect(playback.muted).toBe(true)
  connection.setOutputMuted(false)
  expect(playback.muted).toBe(false)
  const frame = new Float32Array([0.25]),
    out = new Float32Array(1)
  connection.process(frame, out)
  expect(out[0]).toBe(0)
  connection.setInputMuted(false)
  connection.stopSpeaking()
  turn('second')
  expect(playback.muted).toBe(true)
  connection.process(frame, out)
  expect(out[0]).toBe(0.25)
  turn('third')
  expect(playback.muted).toBe(false)
  expect(peer.connectionState).toBe('connected')
})
it('native listening sends audio from the first turn without a text opening', async () => {
  connection.listen()
  expect(connection.active).toBe(false)
  await ready()
  connection.listen()
  const output = new Float32Array(2)
  connection.process(new Float32Array([0.2, 0.3]), output)
  expect([...output]).toEqual([...new Float32Array([0.2, 0.3])])
  expect(api.agentLiveOpen).not.toHaveBeenCalled()
  expect(state).toHaveBeenLastCalledWith('live')
  connection.listen()
  expect(api.agentLiveOpen).not.toHaveBeenCalled()
})
it('routes Brainstorm audio and cancellation through its own port without Agent announcements', async () => {
  connection.stop()
  vi.clearAllMocks()
  const port = {
    start: vi.fn(async () => ({ ok: true, sdp: 'v=0' })),
    open: vi.fn(),
    stop: vi.fn(),
    subscribe: vi.fn(() => () => {}),
    state: vi.fn(),
  }
  api.agentAnnouncement = vi.fn()
  connection = new LiveVoiceConnection(
    { getAudioTracks: () => [{}] },
    16000,
    state,
    undefined,
    port,
  )
  await ready()
  connection.listen()
  const output = new Float32Array(2)
  connection.process(new Float32Array([0.3, 0.5]), output)
  expect([...output]).toEqual([...new Float32Array([0.3, 0.5])])
  connection.stop()
  expect(port.start).toHaveBeenCalledWith(connection.id, 'v=0')
  expect(port.stop).toHaveBeenCalledWith(connection.id)
  expect(api.agentLiveStart).not.toHaveBeenCalled()
  expect(api.agentLiveStop).not.toHaveBeenCalled()
  expect(api.agentAnnouncement).not.toHaveBeenCalled()
  delete api.agentAnnouncement
})
it('holds startup speech until service readiness, then delivers old and new audio once in order', async () => {
  const starting = connection.start({ bufferAudio: true })
  await vi.advanceTimersByTimeAsync(0)
  const output = new Float32Array(2)
  connection.process(new Float32Array([1, 2]), output)
  expect([...output]).toEqual([0, 0])
  connection.process(new Float32Array([3, 4]), output)
  expect([...output]).toEqual([0, 0])
  Peer.current.event('session.started')
  await starting
  connection.process(new Float32Array([5, 6]), output)
  expect([...output]).toEqual([1, 2])
  connection.process(new Float32Array([7, 8]), output)
  expect([...output]).toEqual([3, 4])
  connection.process(new Float32Array([0, 0]), output)
  expect([...output]).toEqual([5, 6])
  connection.process(new Float32Array([0, 0]), output)
  expect([...output]).toEqual([7, 8])
  expect(api.agentLiveOpen).not.toHaveBeenCalled()
})
it.each(['constant', 'two codes', 'three codes', 'stationary noise'])(
  'drains %s without skipping the quiet first utterance or shortening its samples',
  async (shape) => {
    const starting = connection.start({ bufferAudio: true })
    await vi.advanceTimersByTimeAsync(0)
    const size = 256,
      frames = 282,
      output = new Float32Array(size),
      expected = []
    for (let n = 0; n < frames; n++) {
      const speech = Float32Array.from(
        { length: size },
        (_, i) => 0.00025 * Math.sin((n * size + i) * 0.12),
      )
      expected.push(...speech)
      connection.process(speech, output)
    }
    expect(connection.bufferedSeconds).toBeCloseTo(4.512)
    Peer.current.event('session.started')
    await starting
    let seed = 19
    const floor = Float32Array.from({ length: size }, (_, i) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      const code =
        shape === 'constant'
          ? 3
          : shape === 'two codes'
            ? 3 + (i % 2)
            : shape === 'three codes'
              ? 3 + (i % 3)
              : 3 + (seed % 9)
      return code / 32768
    })
    const played = []
    let drainedAt
    for (let n = 0; n < 3750; n++) {
      connection.process(floor, output)
      if (n < frames) played.push(...output)
      if (drainedAt === undefined && !connection.bufferedSeconds)
        drainedAt = ((n + 1) * size) / 16000
    }
    expect(played.length).toBe(expected.length)
    expect(played.every((v, i) => v === expected[i])).toBe(true)
    expect(drainedAt).toBeGreaterThanOrEqual(5)
    expect(drainedAt).toBeLessThan(5.04)
    expect(connection.bufferedSeconds).toBe(0)
  },
)
it('retains the pause boundary and delayed first input when the native session is ready before microphone permission', async () => {
  const starting = connection.start({ bufferAudio: true })
  await vi.advanceTimersByTimeAsync(0)
  Peer.current.event('session.started')
  await starting
  connection.microphoneReady()
  const samples = Float32Array.of(0.00008, -0.00009, 0.00008, -0.00009),
    output = new Float32Array(4)
  connection.process(samples, output)
  expect([...output]).toEqual([...samples])
  expect(connection.bufferedSeconds).toBe(0)
})
it('discards startup audio on cancellation and ignores a late connection', async () => {
  const starting = connection.start({ bufferAudio: true })
  await vi.advanceTimersByTimeAsync(0)
  const output = new Float32Array(2)
  connection.process(new Float32Array([1, 2]), output)
  expect(connection.bufferedSeconds).toBeGreaterThan(0)
  connection.stop()
  Peer.current.event('session.started')
  await starting
  connection.process(new Float32Array([3, 4]), output)
  expect([...output]).toEqual([0, 0])
  expect(connection.bufferedSeconds).toBe(0)
})
it('bounds startup audio without sending a truncated opening', async () => {
  const starting = connection.start({ bufferAudio: true })
  await vi.advanceTimersByTimeAsync(0)
  const output = new Float32Array(512)
  connection.process(new Float32Array(16000 * 30 + 1).fill(0.1), output)
  expect(output.every((value) => value === 0)).toBe(true)
  expect(connection.bufferedSeconds).toBe(0)
  expect(state).toHaveBeenLastCalledWith('error', expect.stringContaining('discarded'))
  await starting
})
it('applies the startup deadline while waiting for the provider, not only after SDP', async () => {
  let resolve
  api.agentLiveStart.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done
      }),
  )
  const starting = connection.start({ bufferAudio: true })
  await vi.advanceTimersByTimeAsync(0)
  connection.process(new Float32Array([1]), new Float32Array(1))
  await vi.advanceTimersByTimeAsync(30000)
  expect(state).toHaveBeenLastCalledWith('error', expect.stringContaining('discarded'))
  expect(connection.bufferedSeconds).toBe(0)
  resolve({ ok: true, sdp: 'v=0' })
  await starting
  expect(connection.active).toBe(false)
})
it('compacts only extended digital silence and catches up without altering quiet speech', () => {
  const buffer = new LiveAudioBuffer(8)
  expect(buffer.append(new Float32Array([0.000001, 0.2]), true)).toBe(true)
  buffer.append(new Float32Array(12), true)
  buffer.append(new Float32Array([0.3]), true)
  const output = new Float32Array(7)
  buffer.read(output)
  expect([...output]).toEqual([...new Float32Array([0.000001, 0.2, 0, 0, 0, 0, 0.3])])
  expect(buffer.length).toBe(0)
  buffer.append(new Float32Array([0.4, 0.5, 0.6]), false)
  buffer.read(new Float32Array(1))
  const tail = new Float32Array(2)
  buffer.read(tail)
  expect([...tail]).toEqual([...new Float32Array([0.5, 0.6])])
})
it('waits for service readiness even after WebRTC and the data channel connect', async () => {
  const { starting, peer } = await transport()
  expect(peer.connectionState).toBe('connected')
  expect(connection.connected).toBe(false)
  await connection.open('Seattle time?')
  expect(api.agentLiveOpen).not.toHaveBeenCalled()
  peer.event('session.started')
  await starting
  expect(connection.connected).toBe(true)
  await connection.open('Seattle time?')
  expect(state).toHaveBeenLastCalledWith('waiting')
  peer.event('output_transcript.added')
  expect(state).toHaveBeenLastCalledWith('live')
  await connection.open('Do not duplicate')
  expect(api.agentLiveOpen).toHaveBeenCalledTimes(1)
})
it('remembers a session-start signal arriving during SDP negotiation', async () => {
  Peer.earlyStart = true
  await connection.start()
  expect(connection.connected).toBe(true)
})
it('cancels while waiting for the service and ignores late startup events', async () => {
  const { starting, peer } = await transport()
  connection.stop()
  peer.event('session.started')
  await starting
  await connection.open('Do not send')
  expect(connection.connected).toBe(false)
  expect(api.agentLiveOpen).not.toHaveBeenCalled()
})
it('times out a connected transport whose service never starts', async () => {
  const { starting } = await transport()
  await vi.advanceTimersByTimeAsync(30_000)
  await starting
  expect(state).toHaveBeenLastCalledWith(
    'error',
    expect.stringContaining('did not connect in time'),
  )
  expect(api.agentLiveOpen).not.toHaveBeenCalled()
})
it('reports an acknowledged opening with no reply, without resending', async () => {
  await ready()
  await connection.open('Seattle time?')
  await vi.advanceTimersByTimeAsync(30_000)
  expect(state).toHaveBeenLastCalledWith('error', expect.stringContaining('did not respond'))
  expect(api.agentLiveOpen).toHaveBeenCalledTimes(1)
  expect(Peer.current.connectionState).toBe('closed')
})
it('keeps a responding conversation open past the first-reply deadline', async () => {
  const peer = await ready()
  await connection.open('Seattle time?')
  peer.event('turn.created')
  await vi.advanceTimersByTimeAsync(40_000)
  expect(connection.active).toBe(true)
  expect(state).toHaveBeenLastCalledWith('live')
})
it('allows a delegated task to keep working beyond the spoken-reply deadline', async () => {
  const peer = await ready()
  await connection.open('A long task')
  api.getAgent.mockResolvedValue({ status: 'waiting', live: 'active' })
  await vi.advanceTimersByTimeAsync(40_000)
  expect(connection.active).toBe(true)
  expect(state).toHaveBeenLastCalledWith('waiting')
  peer.event('output_transcript.added')
  expect(state).toHaveBeenLastCalledWith('live')
})
it('surfaces errors reported only on the data channel', async () => {
  const { starting, peer } = await transport()
  peer.event('session.error')
  await starting
  expect(state).toHaveBeenLastCalledWith('error', expect.stringContaining('connection error'))
  expect(connection.connected).toBe(false)
})
it('buffers audio after the opening while its acknowledgement is pending', async () => {
  const peer = await ready()
  let acknowledge
  api.agentLiveOpen.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        acknowledge = () => resolve({ ok: true })
      }),
  )
  const opening = connection.open('Seattle time?')
  const output = new Float32Array(2)
  connection.process(new Float32Array([1, 2]), output)
  expect([...output]).toEqual([0, 0])
  peer.event('turn.created') // output can precede the app-server acknowledgement
  acknowledge()
  await opening
  connection.process(new Float32Array([3, 4]), output)
  expect([...output]).toEqual([1, 2])
  expect(state).toHaveBeenLastCalledWith('live')
  await vi.advanceTimersByTimeAsync(40_000)
  expect(connection.active).toBe(true)
})
