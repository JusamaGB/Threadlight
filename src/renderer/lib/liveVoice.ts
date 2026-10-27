import { LiveAnnouncements } from './liveAnnouncements'
import type { LiveVoicePhase } from '../../shared/liveVoice'
import { SILENT_AUDIO, type AudioEnergy } from '../../shared/motion'
import { AudioEnergyMeter } from './audioEnergy'
import { LiveAudioBuffer } from './liveAudioBuffer'

/** One hotkey-owned transport. Startup speech is held locally until the service is ready. */
export class LiveVoiceConnection {
  readonly id = crypto.randomUUID()
  private peer = new RTCPeerConnection()
  private audio = new Audio()
  private channel: RTCDataChannel
  private unsubscribe: () => void
  private cancelled = false
  private handedOver = false
  private opening = false
  private backlog: LiveAudioBuffer
  private bufferAudio = false
  private paused = false
  private ready = false
  private sessionStarted = false
  private replyStarted = false
  private checkConnection?: () => void
  private rejectConnection?: (error: Error) => void
  private timer?: ReturnType<typeof setTimeout>
  private replyTimer?: ReturnType<typeof setTimeout>
  private meter?: AudioEnergyMeter
  private unsubscribeAnnouncements?: () => void
  private announcements?: LiveAnnouncements
  private announcementTimer?: ReturnType<typeof setInterval>

  constructor(
    stream: MediaStream,
    private sampleRate: number,
    private onState: (phase: LiveVoicePhase, error?: string) => void,
    private audioContext?: AudioContext,
  ) {
    this.backlog = new LiveAudioBuffer(sampleRate)
    if (window.threadlight.agentAnnouncement) {
      this.announcements = new LiveAnnouncements((command) =>
        window.threadlight.agentAnnouncement(this.id, command),
      )
      this.unsubscribeAnnouncements = window.threadlight.onCommunication?.(() =>
        this.announcements?.invalidate(),
      )
      this.announcementTimer = setInterval(
        () =>
          void this.announcements?.tick(
            this.active &&
              !this.paused &&
              !this.opening &&
              this.backlog.length === 0 &&
              !this.audio.paused &&
              !this.audio.muted &&
              !!this.meter &&
              this.audioContext?.state === 'running',
            this.outputEnergy.level,
          ),
        200,
      )
    }
    this.peer.addTrack(stream.getAudioTracks()[0]!, stream)
    this.channel = this.peer.createDataChannel('oai-events')
    // An open transport is not yet a ready model. Register before negotiating so an
    // early session.started cannot be missed, and gate the opening on that signal.
    this.channel.onmessage = ({ data }) => {
      if (this.cancelled) return
      let event: { type?: string }
      try {
        event = JSON.parse(data)
      } catch {
        return
      }
      if (!event || typeof event !== 'object') return
      this.announcements?.event(event)
      if (event.type === 'session.started') {
        this.sessionStarted = true
        this.checkConnection?.()
      } else if (event.type === 'error' || event.type === 'session.error') {
        this.fail('Live reported a connection error. Reopen the mic to try again.')
      } else if (event.type === 'session.closed') {
        if (!this.handedOver) this.fail('Live closed before the opening message could be sent.')
        else {
          this.stop()
          this.onState('off')
        }
      } else if (
        this.handedOver &&
        !this.replyStarted &&
        (event.type === 'output_transcript.added' || event.type === 'turn.created')
      ) {
        this.replyStarted = true
        clearTimeout(this.replyTimer)
        if (!this.opening) this.onState('live')
      }
    }
    this.audio.autoplay = true
    this.audio.muted = true
    this.peer.ontrack = (event) => {
      if (this.cancelled) return
      const remote = event.streams[0] ?? new MediaStream([event.track])
      this.audio.srcObject = remote
      // Analysis is a silent branch. The existing audio element remains the only playback path.
      this.meter?.dispose()
      this.meter = undefined
      if (this.audioContext) {
        try {
          this.meter = new AudioEnergyMeter(
            this.audioContext.createMediaStreamSource(remote),
            this.audioContext,
          )
        } catch {
          /* Visual telemetry must never interrupt an otherwise working voice call. */
        }
      }
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
  get bufferedSeconds(): number {
    return this.backlog.length / this.sampleRate
  }
  get outputEnergy(): AudioEnergy {
    if (
      this.cancelled ||
      this.audio.paused ||
      this.audio.muted ||
      this.audioContext?.state !== 'running'
    )
      return SILENT_AUDIO
    return this.meter?.read() ?? SILENT_AUDIO
  }
  setPaused(paused: boolean): void {
    this.paused = paused
    this.audio.muted = paused || !this.handedOver || this.opening
  }

  async start({ bufferAudio = false }: { bufferAudio?: boolean } = {}): Promise<void> {
    if (this.cancelled) return
    this.bufferAudio = bufferAudio
    this.onState('connecting')
    this.timer = setTimeout(
      () =>
        this.fail(
          'Live did not connect in time. Buffered speech was discarded; reopen the mic and repeat your request.',
        ),
      30_000,
    )
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
          if (
            this.peer.connectionState === 'connected' &&
            this.channel.readyState === 'open' &&
            this.sessionStarted
          ) {
            clearTimeout(this.timer)
            this.rejectConnection = undefined
            resolve()
          } else if (['failed', 'closed', 'disconnected'].includes(this.peer.connectionState)) {
            this.fail('Live audio disconnected. Reopen the mic to try again.')
          }
        }
        this.checkConnection = check
        this.peer.onconnectionstatechange = check
        this.channel.onopen = check
        this.channel.onclose = () => this.fail('Live audio disconnected.')
        check()
      })
      if (!this.cancelled) {
        this.ready = true
        this.onState('ready')
        if (this.bufferAudio) this.listen()
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
      this.onState(this.replyStarted ? 'live' : 'waiting')
      if (!this.replyStarted) this.waitForReply()
    } catch (error) {
      if (!this.cancelled) this.fail((error as Error).message)
    }
  }

  /** Native audio from the first spoken turn; no locally transcribed opening is submitted. */
  listen(): void {
    if (!this.connected || this.handedOver) return
    this.handedOver = true
    this.audio.muted = this.paused
    this.onState('live')
  }

  private waitForReply(): void {
    this.replyTimer = setTimeout(async () => {
      const state = await window.threadlight.getAgent().catch(() => null)
      if (this.cancelled || this.replyStarted) return
      // Tool work and approval waits can legitimately outlast the voice deadline.
      if (state?.live && ['starting', 'working', 'waiting', 'stopping'].includes(state.status)) {
        this.waitForReply()
        return
      }
      this.fail(
        'Live connected but did not respond to the opening message. It was not sent again. Check Earlier before retrying.',
      )
    }, 30_000)
  }

  /** Called on the existing audio clock. Bounded buffering preserves the handoff boundary. */
  process(input: Float32Array, output: Float32Array): void {
    output.fill(0)
    if (!this.paused && this.active) this.announcements?.input(input)
    if (this.cancelled || this.paused || (!this.active && !this.bufferAudio)) return
    if (
      !this.backlog.append(input, this.bufferAudio && (!this.active || this.backlog.length > 0))
    ) {
      this.fail(
        'Live could not keep up. Buffered speech was discarded; reopen the mic and repeat your request.',
      )
      return
    }
    if (!this.active || this.opening) return
    this.backlog.read(output)
  }

  stop(): void {
    if (this.cancelled) return
    this.cancelled = true
    clearInterval(this.announcementTimer)
    this.announcements?.close()
    this.unsubscribeAnnouncements?.()
    clearTimeout(this.timer)
    clearTimeout(this.replyTimer)
    this.checkConnection = undefined
    this.rejectConnection?.(new Error('Live was cancelled.'))
    this.rejectConnection = undefined
    this.unsubscribe()
    this.audio.pause()
    this.audio.srcObject = null
    this.meter?.dispose()
    this.meter = undefined
    this.peer.close()
    this.backlog.clear()
    window.threadlight.agentLiveStop(this.id)
  }

  private fail(message: string): void {
    if (this.cancelled) return
    this.stop()
    this.onState('error', message)
  }
}
