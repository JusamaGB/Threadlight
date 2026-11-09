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
  private delegatedUser?: string
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
  private questionsOnly = true
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
      item?: { target?: string; user_bidi_turn_id?: string }
    }
    if (
      e.type === 'delegation.created' &&
      e.item?.target === 'client' &&
      e.item.user_bidi_turn_id &&
      this.user.has(e.item.user_bidi_turn_id)
    ) {
      // The service can keep this voice turn open until the backing question is answered.
      this.delegatedUser = e.item.user_bidi_turn_id
      this.lastActivity = this.now()
      this.dirty = true
    }
    const turn = e.turn
    if (e.type === 'input_transcript.added') {
      this.lastInput = this.now()
      if (this.pending) void this.finish('uncertain')
    }
    if (!turn?.id) return
    if (e.type !== 'turn.created' && e.type !== 'turn.done') return
    const role =
      turn.role ??
      (this.user.has(turn.id) ? 'user' : this.assistant.has(turn.id) ? 'assistant' : undefined)
    if (role !== 'user' && role !== 'assistant') return
    this.lastActivity = this.now()
    const set = role === 'user' ? this.user : this.assistant
    if (e.type === 'turn.created') {
      set.add(turn.id)
      if (role === 'user') {
        if (this.pending) void this.finish('uncertain')
      } else if (this.pending) {
        if (this.pending.turn && this.pending.turn !== turn.id) void this.finish('uncertain')
        else this.pending.turn = turn.id
      }
    } else {
      set.delete(turn.id)
      if (this.delegatedUser === turn.id) this.delegatedUser = undefined
      this.boundarySeen = true
      if (role === 'assistant' && this.pending?.turn === turn.id) {
        if (words(turn.transcript ?? '') === words(this.pending.announcement.text))
          this.pending.done = true
        else void this.finish('uncertain')
      }
    }
  }
  private get userSpeaking() {
    return (
      this.user.size > 0 &&
      !(this.user.size === 1 && this.delegatedUser && this.user.has(this.delegatedUser))
    )
  }
  async tick(ready: boolean, outputLevel: number, micMuted = false) {
    if (this.closed) return
    this.ready = ready
    const now = this.now()
    const questionsOnly = !this.boundarySeen || micMuted || this.user.size > 0
    if (questionsOnly !== this.questionsOnly) this.dirty = true
    this.questionsOnly = questionsOnly
    if (outputLevel > 0.015) {
      this.lastOutput = now
      if (this.pending && ready) this.pending.audio = true
    }
    if (this.pending) {
      if (
        !ready ||
        now - this.pending.at > Math.max(45000, this.pending.announcement.text.length * 130)
      ) {
        await this.finish('uncertain')
        return
      }
      if (
        this.pending.done &&
        this.pending.audio &&
        !this.userSpeaking &&
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
      this.userSpeaking ||
      this.assistant.size ||
      now - Math.max(this.lastActivity, this.lastInput, this.lastOutput) < 800
    )
      return
    this.busy = true
    this.dirty = false
    try {
      const result = await this.call(
        questionsOnly ? { action: 'next', questionsOnly: true } : { action: 'next' },
      )
      if (!result.ok || !result.announcement) return
      const a = result.announcement
      if (
        this.closed ||
        !this.ready ||
        (this.questionsOnly && !a.question) ||
        this.userSpeaking ||
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
    this.dirty = true
    if (pending)
      await this.call({ action: 'settle', id: pending.announcement.id, outcome }).catch(() => {})
  }
  close() {
    this.closed = true
    void this.finish('uncertain')
  }
}
