import type {
  Announcement,
  AnnouncementCommand,
  AnnouncementReply,
} from '../../shared/conversationEvents'

const words = (text: string) =>
  text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

/** Native turn boundaries establish pauses. Audio energy only vetoes a pause or proves playback. */
export class LiveAnnouncements {
  private user = new Set<string>()
  private assistant = new Set<string>()
  private boundarySeen = false
  private lastActivity = 0
  private lastInput = 0
  private lastOutput = 0
  private pending?: {
    announcement: Announcement
    at: number
    turn?: string
    done: boolean
    audio: boolean
  }
  private busy = false
  private dirty = true
  invalidate() {
    this.dirty = true
  }
  private closed = false
  private ready = false
  constructor(
    private call: (command: AnnouncementCommand) => Promise<AnnouncementReply>,
    private now = Date.now,
  ) {}
  input(samples: Float32Array) {
    if (samples.some((v) => Math.abs(v) > 0.015)) {
      this.lastInput = this.now()
      if (this.pending) void this.finish('uncertain')
    }
  }
  event(value: unknown) {
    if (!value || typeof value !== 'object' || this.closed) return
    const e = value as {
      type?: string
      turn?: { id?: string; role?: string; transcript?: string }
      turn_id?: string
    }
    const turn = e.turn
    if (e.type === 'input_transcript.added') {
      this.lastInput = this.now()
      if (this.pending) void this.finish('uncertain')
    }
    if (!turn?.id || !['user', 'assistant'].includes(turn.role ?? '')) return
    if (e.type !== 'turn.created' && e.type !== 'turn.done') return
    this.lastActivity = this.now()
    const set = turn.role === 'user' ? this.user : this.assistant
    if (e.type === 'turn.created') {
      set.add(turn.id)
      if (turn.role === 'user') {
        if (this.pending) void this.finish('uncertain')
      } else if (this.pending) {
        if (this.pending.turn && this.pending.turn !== turn.id) void this.finish('uncertain')
        else this.pending.turn = turn.id
      }
    } else {
      set.delete(turn.id)
      this.boundarySeen = true
      if (turn.role === 'assistant' && this.pending?.turn === turn.id) {
        if (words(turn.transcript ?? '') === words(this.pending.announcement.text))
          this.pending.done = true
        else void this.finish('uncertain')
      }
    }
  }
  async tick(ready: boolean, outputLevel: number) {
    if (this.closed) return
    this.ready = ready
    const now = this.now()
    if (outputLevel > 0.015) {
      this.lastOutput = now
      if (this.pending && ready) this.pending.audio = true
    }
    if (this.pending) {
      if (!ready || now - this.pending.at > 45000) {
        await this.finish('uncertain')
        return
      }
      if (
        this.pending.done &&
        this.pending.audio &&
        !this.user.size &&
        !this.assistant.size &&
        now - Math.max(this.lastOutput, this.lastActivity, this.lastInput) >= 800
      )
        await this.finish('announced')
      return
    }
    if (
      this.busy ||
      !this.dirty ||
      !ready ||
      !this.boundarySeen ||
      this.user.size ||
      this.assistant.size ||
      now - Math.max(this.lastActivity, this.lastInput, this.lastOutput) < 800
    )
      return
    this.busy = true
    this.dirty = false
    try {
      const result = await this.call({ action: 'next' })
      if (!result.ok || !result.announcement) return
      const a = result.announcement
      if (
        this.closed ||
        !this.ready ||
        this.user.size ||
        this.assistant.size ||
        this.now() - Math.max(this.lastActivity, this.lastInput, this.lastOutput) < 800
      ) {
        await this.call({ action: 'settle', id: a.id, outcome: 'deferred' })
        this.dirty = true
        return
      }
      this.pending = { announcement: a, at: this.now(), done: false, audio: false }
      const sent = await this.call({ action: 'speak', id: a.id })
      if (!sent.ok) await this.finish('uncertain')
    } catch {
      await this.finish('uncertain')
    } finally {
      this.busy = false
    }
  }
  private async finish(outcome: 'announced' | 'uncertain') {
    const pending = this.pending
    this.pending = undefined
    if (pending)
      await this.call({ action: 'settle', id: pending.announcement.id, outcome }).catch(() => {})
  }
  close() {
    this.closed = true
    void this.finish('uncertain')
  }
}
