import type { VoicePace } from '../../shared/voicePace'
import { randomUUID } from 'node:crypto'
import { validVoiceOffer, type ScreenVoiceEvent } from '../../shared/liveVoice'
import { isObject, str } from '../sessions/json'
import { CodexLive, requireLiveAccount } from './codexLive'
import type { CodexTransport } from './codexClient'

interface Playback {
  id: string
  text: string
  negotiating?: boolean
  speaking?: boolean
  live?: CodexLive
  client?: CodexTransport
  timer?: NodeJS.Timeout
}

/** A disposable speaker session. The crop and its conversation stay in the original Agent. */
export class ScreenReplyVoice {
  private queue: string[] = []
  private active?: Playback
  constructor(
    private connect: () => Promise<CodexTransport>,
    private emit: (event: ScreenVoiceEvent) => void,
    private notify: (message: string) => void,
    private pace: () => VoicePace = () => 'normal',
  ) {}

  speak(text: string) {
    this.queue.push(text)
    this.next()
  }
  private next() {
    if (this.active) return
    const text = this.queue.shift()
    if (!text) return
    const job: Playback = { id: randomUUID(), text }
    this.active = job
    job.timer = setTimeout(() => this.finish(job, true), 45_000)
    this.emit({ id: job.id, action: 'start' })
  }
  async command(id: unknown, action: unknown, sdp: unknown) {
    const job = this.active
    if (!job || id !== job.id) return { ok: false, reason: 'That reply has ended.' } as const
    try {
      if (action === 'offer' && !job.negotiating && validVoiceOffer(sdp)) {
        job.negotiating = true
        const client = await this.connect()
        if (job !== this.active) {
          await client.close()
          throw new Error('Playback stopped.')
        }
        job.client = client
        client.onFailure = () => this.finish(job, true)
        await requireLiveAccount(client)
        if (job !== this.active) throw new Error('Playback stopped.')
        const { thread } = await client.request('thread/start', {
          ephemeral: true,
          sandbox: 'read-only',
          approvalPolicy: 'never',
        })
        const threadId = isObject(thread) && str(thread.id)
        if (!threadId || job !== this.active) throw new Error('Playback stopped.')
        job.live = new CodexLive(
          client,
          threadId,
          job.id,
          () => {},
          () => this.finish(job, true),
        )
        client.onEvent = (method, params) => {
          job.live?.event(method, params)
        }
        return { ok: true, sdp: await job.live.start(sdp, true, this.pace()) } as const
      }
      if (action === 'speak' && job.live && !job.speaking) {
        job.speaking = true
        clearTimeout(job.timer)
        job.timer = setTimeout(
          () => this.finish(job, true),
          Math.max(90_000, job.text.length * 150),
        )
        await job.live.speakAnswer(job.text)
      } else if (action === 'done' || action === 'failed') this.finish(job, action === 'failed')
      else throw new Error('Invalid playback command.')
      return { ok: true } as const
    } catch (error) {
      this.finish(job, true)
      return { ok: false, reason: (error as Error).message } as const
    }
  }
  stop() {
    this.queue = []
    if (this.active) this.finish(this.active, false)
  }
  private finish(job: Playback, failed: boolean) {
    if (this.active !== job) return
    this.active = undefined
    clearTimeout(job.timer)
    this.emit({ id: job.id, action: 'stop' })
    void (async () => {
      try {
        await job.live?.stop()
      } finally {
        await job.client?.close()
      }
    })().catch(() => {})
    if (failed) this.notify('GPT Live could not play the reply. Open the Agent diamond to read it.')
    this.next()
  }
}
