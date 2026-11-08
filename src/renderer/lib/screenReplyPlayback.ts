import type { ThreadlightApi } from '../../shared/ipc'

/** The voice service needs an audio clock. Generate silence locally without opening an input device. */
export function watchScreenReplies(
  api: Pick<ThreadlightApi, 'onScreenVoice' | 'screenVoiceCommand'>,
) {
  let stop: (() => void) | undefined
  let currentId: string | undefined
  const unsubscribe = api.onScreenVoice(({ id, action }) => {
    if (action === 'stop' && id !== currentId) return
    stop?.()
    stop = undefined
    if (action === 'stop') return
    currentId = id
    const peer = new RTCPeerConnection()
    const audio = new Audio()
    const channel = peer.createDataChannel('oai-events')
    const clock = new AudioContext()
    const silence = clock.createConstantSource()
    silence.offset.value = 0
    const output = clock.createMediaStreamDestination()
    silence.connect(output)
    silence.start()
    peer.addTrack(output.stream.getAudioTracks()[0]!, output.stream)
    let closed = false,
      speaking = false,
      connected = false,
      started = false,
      completed = false
    let lastEnergy = 0,
      lastSound = 0,
      polling = false
    const close = () => {
      if (closed) return
      closed = true
      clearInterval(timer)
      audio.pause()
      audio.srcObject = null
      peer.close()
      silence.stop()
      output.stream.getTracks().forEach((track) => track.stop())
      void clock.close().catch(() => {})
    }
    stop = close
    const finish = (failed: boolean) => {
      if (closed) return
      close()
      void api.screenVoiceCommand(id, failed ? 'failed' : 'done').catch(() => {})
    }
    const speak = async () => {
      if (closed || speaking || !connected || !started || channel.readyState !== 'open') return
      speaking = true
      try {
        if (!(await api.screenVoiceCommand(id, 'speak')).ok) finish(true)
      } catch {
        finish(true)
      }
    }
    channel.onmessage = ({ data }) => {
      let event
      try {
        event = JSON.parse(data)
      } catch {
        return
      }
      if (closed || !event || typeof event !== 'object') return
      if (event.type === 'session.started') {
        started = true
        void speak()
      }
      if (speaking && event.type === 'turn.done' && event.turn?.role === 'assistant')
        completed = true
      if (event.type === 'error' || event.type === 'session.error') finish(true)
    }
    channel.onclose = () => finish(true)
    peer.onconnectionstatechange = () => {
      if (['failed', 'disconnected'].includes(peer.connectionState)) finish(true)
    }
    audio.autoplay = true
    peer.ontrack = ({ track, streams }) => {
      audio.srcObject = streams[0] ?? new MediaStream([track])
      void audio.play().catch(() => finish(true))
    }
    // turn.done can precede audible playback. Drain incoming audio before releasing the speaker.
    const timer = setInterval(async () => {
      if (closed || !speaking || polling) return
      polling = true
      try {
        const stats = await peer.getStats()
        stats.forEach((row) => {
          if (
            row.type === 'inbound-rtp' &&
            row.kind === 'audio' &&
            row.totalAudioEnergy > lastEnergy + 0.000001
          ) {
            lastSound = Date.now()
            lastEnergy = row.totalAudioEnergy
          }
        })
        if (completed && lastSound && Date.now() - lastSound > 1800) finish(false)
      } catch {
        finish(true)
      } finally {
        polling = false
      }
    }, 300)
    void (async () => {
      await clock.resume()
      await peer.setLocalDescription(await peer.createOffer())
      if (closed) return
      const result = await api.screenVoiceCommand(id, 'offer', peer.localDescription!.sdp)
      if (closed) return
      if (!result.ok || !('sdp' in result)) throw new Error('Voice connection failed.')
      await peer.setRemoteDescription({ type: 'answer', sdp: result.sdp })
      connected = true
      await speak()
    })().catch(() => finish(true))
  })
  return () => {
    stop?.()
    unsubscribe()
  }
}
