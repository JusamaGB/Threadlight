import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import type { AgentState } from '../shared/agent'
import { RegionReceipts, type RegionResult } from './regionReceipts'
import type { RegionRequest, ScreenImage } from './liveScreen'
import { windowsPowerShell } from './sessions/paths'

/** Local Windows output only. Text enters over stdin so it never appears in the process arguments. */
export class ScreenReplySpeech {
  private child?: ChildProcessWithoutNullStreams
  private replies: string[] = []
  constructor(
    private script: string,
    private onError: (message: string) => void,
  ) {}
  stop() {
    this.replies = []
    const child = this.child
    this.child = undefined
    child?.kill()
  }
  speak(text: string) {
    this.replies.push(text)
    this.playNext()
  }
  private playNext() {
    if (this.child) return
    const text = this.replies.shift()
    if (!text) return
    const child = spawn(
      windowsPowerShell(),
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', this.script],
      { windowsHide: true, stdio: 'pipe' },
    )
    this.child = child
    const finish = (failed: boolean) => {
      if (this.child !== child) return
      this.child = undefined
      if (failed)
        this.onError('Windows could not speak the reply. It is in the Agent conversation.')
      this.playNext()
    }
    child.stdout.resume()
    child.stderr.resume()
    child.stdin.on('error', () => {})
    child.once('error', () => finish(true))
    child.once('close', (code) => finish(code !== 0))
    child.stdin.end(text, 'utf8')
  }
}

interface ScreenHelpOptions {
  available(): boolean
  start(region: RegionRequest): Promise<RegionResult>
  state(): AgentState
  notify(message: string): void
  speak(text: string): void
}

/** Serialize fresh conversations without interrupting a working or approval-pending Agent. */
export class ScreenRegionHelp {
  private queue: (RegionRequest & { key: string })[] = []
  private receipts = new RegionReceipts()
  private awaitingClaude?: string
  private waitingFor?: string
  private starting = false
  private scheduled?: NodeJS.Immediate
  private closed = false
  private enabled = false
  private audible = false
  constructor(private options: ScreenHelpOptions) {}
  configure(enabled: boolean, audible: boolean) {
    this.enabled = enabled
    this.audible = audible
    if (!enabled) {
      for (const r of this.queue) this.receipts.discard(r.key)
      this.queue = []
    }
    this.changed()
  }
  receive(image: ScreenImage) {
    if (!this.enabled || this.closed) return
    const { key, skip } = this.receipts.claim(image)
    if (skip) {
      this.options.notify(skip.ok ? skip.notice! : skip.reason)
      return
    }
    if (this.queue.length >= 3) {
      this.receipts.discard(key)
      this.options.notify(
        'Three screen regions are already waiting. Try again after the Agent replies.',
      )
      return
    }
    this.queue.push({ id: randomUUID(), image, key })
    if (this.waitingFor || !this.options.available())
      this.options.notify('Screen region queued until the Agent is free.')
    else this.options.notify('Screen region captured. Sending to the Agent…')
    this.changed()
  }
  changed() {
    if (this.scheduled || this.closed) return
    this.scheduled = setImmediate(() => {
      this.scheduled = undefined
      void this.advance()
    })
  }
  close() {
    this.closed = true
    this.queue = []
    this.waitingFor = undefined
    if (this.scheduled) clearImmediate(this.scheduled)
  }
  private async advance() {
    if (this.closed || this.starting) return
    if (this.waitingFor) {
      const state = this.options.state()
      if (!state.ended && !['ready', 'error', 'interrupted'].includes(state.status)) return
      const index = state.items.findIndex((item) => item.id === this.waitingFor)
      this.waitingFor = undefined
      if (this.awaitingClaude) {
        const accepted =
          index >= 0 &&
          !state.ended &&
          state.status === 'ready' &&
          state.items.slice(index + 1).some((i) => i.kind === 'agent' && i.text.trim())
        this.receipts.finish(
          this.awaitingClaude,
          accepted ? { ok: true } : { ok: false, uncertain: true, reason: 'Unconfirmed delivery' },
        )
        this.awaitingClaude = undefined
        if (accepted) this.options.notify('Screen region sent to a new Agent conversation.')
      }
      if (index >= 0 && state.status === 'ready' && !state.ended) {
        const following = state.items.slice(index + 1)
        const end = following.findIndex((item) => item.kind === 'you')
        const reply = (end < 0 ? following : following.slice(0, end)).findLast(
          (item) => item.kind === 'agent' && item.text.trim(),
        )
        if (reply && this.enabled && this.audible) this.options.speak(reply.text)
      } else if (state.error) this.options.notify(state.error)
    }
    if (!this.enabled || !this.options.available()) return
    const region = this.queue.shift()
    if (!region) return
    this.starting = true
    this.waitingFor = region.id
    try {
      const result = await this.options.start(region)
      if (this.closed) return
      if (result.ok && this.options.state().provider === 'claude') this.awaitingClaude = region.key
      else {
        this.receipts.finish(region.key, result)
        if (result.ok) this.options.notify('Screen region sent to a new Agent conversation.')
        else {
          this.waitingFor = undefined
          this.options.notify(result.reason)
        }
      }
    } catch {
      this.receipts.finish(region.key, {
        ok: false,
        reason: 'Unconfirmed delivery',
        uncertain: true,
      })
      this.waitingFor = undefined
      if (!this.closed) this.options.notify('Could not start the screen-region conversation.')
    } finally {
      this.starting = false
      this.changed()
    }
  }
}
