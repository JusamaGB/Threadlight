import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { LiveVoiceConnection } from '../src/renderer/lib/liveVoice'
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
  onAgentLive: vi.fn(() => () => {}),
}
const state = vi.fn()
let connection
beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  api.getAgent.mockResolvedValue({ status: 'ready', live: 'active' })
  Peer.earlyStart = false
  vi.stubGlobal('RTCPeerConnection', Peer)
  vi.stubGlobal(
    'Audio',
    class {
      play = async () => {}
      pause() {}
    },
  )
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
  expect(state).toHaveBeenLastCalledWith('error', 'Live audio did not connect in time.')
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
