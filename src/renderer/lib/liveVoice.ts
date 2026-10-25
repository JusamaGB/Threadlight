import type { LiveVoicePhase } from '../../shared/liveVoice'

/** Uses the open mic's processed audio track: silence until the initial text is committed. */
export class LiveVoiceConnection {
  readonly id = crypto.randomUUID()
  private peer = new RTCPeerConnection()
  private audio = new Audio()
  private channel: RTCDataChannel
  private unsubscribe: () => void
  private cancelled = false
  private handedOver = false
  private opening = false
  private backlog: Float32Array[] = []
  private buffered = 0
  private ready = false
  private rejectConnection?: (error: Error) => void
  private timer?: ReturnType<typeof setTimeout>

  constructor(
    stream: MediaStream,
    private sampleRate: number,
    private onState: (phase: LiveVoicePhase, error?: string) => void,
  ) {
    this.peer.addTrack(stream.getAudioTracks()[0]!, stream)
    this.channel = this.peer.createDataChannel('oai-events')
    this.audio.autoplay = true
    this.audio.muted = true
    this.peer.ontrack = (event) => {
      this.audio.srcObject = event.streams[0] ?? new MediaStream([event.track])
      void this.audio
        .play()
        .catch(() => this.fail('Audio playback was blocked. Reopen the mic to try again.'))
    }
    this.unsubscribe = window.threadlight.onAgentLive((event) => {
      if (event.sessionId !== this.id || this.cancelled) return
      if (event.type === 'closed') {
        this.stop()
        this.onState('off')
      } else this.fail(event.message ?? 'Live audio disconnected. Reopen the mic to try again.')
    })
  }

  get connected(): boolean {
    return this.ready && !this.cancelled
  }
  get active(): boolean {
    return this.handedOver && !this.cancelled
  }
  setPaused(paused: boolean): void {
    this.audio.muted = paused || !this.handedOver || this.opening
  }

  async start(): Promise<void> {
    this.onState('connecting')
    try {
      await this.peer.setLocalDescription(await this.peer.createOffer())
      if (this.cancelled) return
      const result = await window.threadlight.agentLiveStart(
        this.id,
        this.peer.localDescription!.sdp,
      )
      if (this.cancelled) {
        window.threadlight.agentLiveStop(this.id)
        return
      }
      if (!result.ok) throw new Error(result.reason)
      await this.peer.setRemoteDescription({ type: 'answer', sdp: result.sdp })
      if (this.cancelled) return
      await new Promise<void>((resolve, reject) => {
        this.rejectConnection = reject
        const check = () => {
          if (this.peer.connectionState === 'connected' && this.channel.readyState === 'open') {
            clearTimeout(this.timer)
            this.rejectConnection = undefined
            resolve()
          } else if (['failed', 'closed', 'disconnected'].includes(this.peer.connectionState)) {
            this.fail('Live audio disconnected. Reopen the mic to try again.')
          }
        }
        this.peer.onconnectionstatechange = check
        this.channel.onopen = check
        this.channel.onclose = () => this.fail('Live audio disconnected.')
        this.timer = setTimeout(() => this.fail('Live audio did not connect in time.'), 30_000)
        check()
      })
      if (!this.cancelled) {
        this.ready = true
        this.onState('ready')
      }
    } catch (error) {
      if (!this.cancelled) this.fail((error as Error).message)
    }
  }

  async open(text: string): Promise<void> {
    if (!this.connected || this.handedOver) return
    this.opening = true
    this.onState('connecting')
    // Every subsequent frame belongs to Live, even while the text acknowledgement is pending.
    this.handedOver = true
    try {
      const result = await window.threadlight.agentLiveOpen(this.id, text)
      if (this.cancelled) return
      if (!result.ok) throw new Error(result.reason)
      this.opening = false
      this.onState('live')
    } catch (error) {
      if (!this.cancelled) this.fail((error as Error).message)
    }
  }

  /** Called on the existing audio clock. Bounded buffering preserves the handoff boundary. */
  process(input: Float32Array, output: Float32Array): void {
    output.fill(0)
    if (!this.active) return
    this.backlog.push(new Float32Array(input))
    this.buffered += input.length
    if (this.buffered > this.sampleRate * 5) {
      this.fail('Live is too slow to accept audio. Reopen the mic to try again.')
      return
    }
    if (this.opening) return
    const frame = this.backlog.shift()!
    this.buffered -= frame.length
    output.set(frame)
  }

  stop(): void {
    if (this.cancelled) return
    this.cancelled = true
    clearTimeout(this.timer)
    this.rejectConnection?.(new Error('Live was cancelled.'))
    this.rejectConnection = undefined
    this.unsubscribe()
    this.audio.pause()
    this.audio.srcObject = null
    this.peer.close()
    this.backlog = []
    window.threadlight.agentLiveStop(this.id)
  }

  private fail(message: string): void {
    if (this.cancelled) return
    this.stop()
    this.onState('error', message)
  }
}
