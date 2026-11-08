import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createConnection, type Socket } from 'node:net'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { guideEvent, type CoachCommand, type GuideEvent } from '../shared/editorCoach'

const descriptor = z.object({ id: z.string().uuid(), token: z.string().regex(/^[a-f0-9]{64}$/) })
const disconnected =
  'In desktop VS Code, run “Threadlight: Start Live Coaching” in the window you want to share.'
const reviewUpgrade =
  'This VS Code window is running a companion without whole-file review. Zero lines reviewed. Use Live Coach 0.3.0 or newer, then run Developer: Reload Window and Threadlight: Start Live Coaching in that window after your session ends.'
type Session = {
  id: string
  address: string
  socket: Socket
  actions?: string[]
  version?: string
  traceSupported?: boolean
  lifecycle?: boolean
  delivery: Promise<void>
  visibleProposal?: string
  proposalToken?: string
  proposalSpeech?: Promise<void>
  reviewSupported?: boolean
  plan?: {
    id: string
    steps: Extract<CoachCommand, { action: 'guide' }>['steps']
    next: number
    event?: GuideEvent
    narration?: Promise<void>
  }
}

/** Only the foreground Live owner can send requests to the explicitly enabled editor window. */
export class EditorCoach {
  private session?: Session
  private pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>()
  private busy = false
  constructor(
    private current: () => string | null,
    private speak: (id: string, text: string, first: boolean, proposal?: boolean) => Promise<void>,
    private file = join(homedir(), '.threadlight', 'editor-coach.json'),
    private notify?: (id: string, event: GuideEvent) => Promise<void>,
    private interruptProposal?: (id: string) => void,
  ) {}
  availability() {
    if (!this.current()) return { available: false, reason: 'Start the foreground GPT Live Agent.' }
    return existsSync(this.file) ? { available: true } : { available: false, reason: disconnected }
  }
  sync() {
    if (this.session && this.session.id !== this.current()) this.close()
  }
  close() {
    const old = this.session
    if (old?.plan?.event && this.current() === old.id)
      this.deliver(old, { ...old.plan.event, status: 'disconnected' })
    if (old?.proposalToken) this.interruptProposal?.(old.id)
    old?.socket.destroy()
    this.session = undefined
    for (const request of this.pending.values())
      request.reject(new Error('Editor coaching disconnected.'))
    this.pending.clear()
  }
  private async connect(id: string) {
    this.sync()
    if (id !== this.current()) throw new Error('Live has closed.')
    const address = descriptor.parse(
      JSON.parse(
        await readFile(this.file, 'utf8').catch(() => {
          throw new Error(disconnected)
        }),
      ),
    )
    if (id !== this.current()) throw new Error('Live has closed.')
    if (this.session?.address === address.id) return this.session
    this.close()
    const socket = createConnection('\\\\.\\pipe\\threadlight-coach-' + address.id)
    const session: Session = { id, socket, address: address.id, delivery: Promise.resolve() }
    this.session = session
    let buffer = ''
    socket.setEncoding('utf8')
    socket.on('data', (chunk: string) => {
      if (this.session !== session) return
      buffer += chunk
      // A bounded excerpt and its exact selection can both contain JSON-escaped text.
      if (buffer.length > 256000) return this.close()
      let end: number
      while ((end = buffer.indexOf('\n')) >= 0) {
        try {
          const msg = JSON.parse(buffer.slice(0, end))
          buffer = buffer.slice(end + 1)
          if (msg.proposalState && this.current() === session.id) {
            const state = msg.proposalState
            session.visibleProposal = state.status === 'shown' ? state.token : undefined
            if (session.proposalToken && session.proposalToken !== state.token)
              this.interruptProposal?.(session.id)
            session.proposalToken = undefined
            if (state.status === 'shown' && msg.narrate && typeof state.explanation === 'string') {
              const token = (session.proposalToken = state.token)
              const speech = (session.proposalSpeech ?? Promise.resolve())
                .catch(() => {})
                .then(async () => {
                  if (
                    this.session === session &&
                    session.proposalToken === token &&
                    this.current() === session.id
                  ) {
                    // Speech can wait behind an earlier delivery while the learner keeps typing.
                    const visible = (await this.request(session, {
                      action: 'proposal_status',
                    })) as { status: string; token?: string }
                    if (
                      visible.status === 'shown' &&
                      visible.token === token &&
                      session.proposalToken === token &&
                      this.session === session &&
                      this.current() === session.id
                    )
                      await this.speak(session.id, state.explanation.slice(0, 400), true, true)
                  }
                })
              session.proposalSpeech = speech
              void speech.catch(() => {
                if (this.session === session && session.proposalToken === token)
                  session.socket.write(JSON.stringify({ proposalSpeechFailed: token }) + '\n')
              })
            }
          }
          if (msg.guideEvent && session.plan && this.current() === session.id) {
            const event = guideEvent.parse(msg.guideEvent)
            if (event.plan === session.plan.id) {
              session.plan.event = event
              this.deliver(session, event)
            }
          }
          const request = this.pending.get(msg.id)
          if (request) {
            this.pending.delete(msg.id)
            if (msg.error) request.reject(new Error(String(msg.error).slice(0, 300)))
            else request.resolve(msg.value)
          } else if (msg.shown && this.current() === session.id) {
            if (session.plan) {
              session.plan.narration = this.narrate(
                session,
                msg.shown.plan,
                msg.shown.index,
                msg.shown.origin === 'voice',
              )
              void session.plan.narration.catch(() => this.closeIfCurrent(session))
            }
          } else if (msg.finished && msg.finished === session.plan?.id) session.plan = undefined
        } catch {
          this.closeIfCurrent(session)
          return
        }
      }
    })
    socket.on('error', () => this.closeIfCurrent(session))
    socket.on('close', () => this.closeIfCurrent(session))
    const hello = await this.request(session, { action: 'hello', token: address.token })
    // Through 0.3.1 all versions replied true, including versions that could review.
    if (hello !== true) {
      const info = z
        .object({ version: z.string().optional(), actions: z.array(z.string()) })
        .parse(hello)
      session.actions = info.actions
      session.version = info.version
      session.reviewSupported = info.actions.includes('review')
      session.lifecycle = info.actions.includes('progress')
      session.traceSupported = info.actions.includes('trace')
    }
    return session
  }
  private closeIfCurrent(session: Session) {
    if (this.session === session) this.close()
  }
  private async request(session: Session, command: unknown): Promise<unknown> {
    const id = randomUUID()
    const frame = JSON.stringify({ id, command }) + '\n'
    if (frame.length > 240000)
      throw new Error('This proposal exceeds the editor message limit. Send a smaller group.')
    const timer = setTimeout(() => this.closeIfCurrent(session), 4000)
    try {
      return await new Promise((resolve, reject) => {
        this.pending.set(id, { resolve, reject })
        session.socket.write(frame)
      })
    } finally {
      clearTimeout(timer)
    }
  }
  private deliver(session: Session, event: GuideEvent) {
    session.delivery = session.delivery
      .then(async () => {
        if (
          this.current() === session.id &&
          (this.session === session || event.status === 'disconnected')
        )
          await this.notify?.(session.id, event)
      })
      .catch(() => {
        if (this.session === session)
          session.socket.write(JSON.stringify({ guideDeliveryFailed: event.token }) + '\n')
      })
  }
  private async narrate(session: Session, planId: unknown, index: unknown, voice = false) {
    const plan = session.plan
    if (
      !plan ||
      plan.id !== planId ||
      plan.next !== index ||
      plan.event?.status === 'paused' ||
      this.current() !== session.id
    )
      return
    const step = plan.steps[plan.next++]
    if (step) {
      await this.speak(session.id, step.explanation, voice || index === 0)
      if (this.session === session)
        session.socket.write(JSON.stringify({ narrated: { plan: planId, index } }) + '\n')
    }
  }
  async run(id: string, command: CoachCommand) {
    if (this.busy) throw new Error('Another editor request is in progress.')
    this.busy = true
    try {
      const session = await this.connect(id)
      if (
        (command.action === 'progress' ||
          command.action === 'guide_status' ||
          (command.action === 'guide' && command.resume)) &&
        !session.lifecycle
      )
        throw new Error(
          'Voice progression and guide refresh require Live Coach 0.4.0 in this window. Reload after the session, then start coaching again.',
        )
      if (command.action === 'capabilities' && !session.actions?.includes('capabilities'))
        return { version: session.version ?? 'legacy', actions: session.actions ?? [] }
      if (
        ['propose', 'proposal_status', 'proposal_next'].includes(command.action) &&
        !session.actions?.includes(command.action)
      )
        throw new Error(
          'This window needs Live Coach 0.6.0 for selection-free proposals. Reload after this session, then start coaching again.',
        )
      if (command.action === 'trace' && !session.traceSupported)
        throw new Error(
          'Trace needs Live Coach 0.5.0 or newer. After this session, reload the VS Code window and start coaching again.',
        )
      if (command.action !== 'guide') {
        if (command.action === 'review' && session.reviewSupported === false)
          throw new Error(reviewUpgrade)
        const result = await this.request(session, command).catch((error: Error) => {
          // Pre-review companions route an unknown action through the guide snapshot check.
          // Only their first-page response is diagnostic. Preserve every continuation error.
          if (
            command.action === 'review' &&
            command.nextPage === undefined &&
            session.reviewSupported === undefined &&
            error.message === 'The active file or its text changed. Read fresh context first.'
          ) {
            session.reviewSupported = false
            throw new Error(reviewUpgrade)
          }
          throw error
        })
        if (this.current() !== id || this.session !== session) throw new Error('Live has closed.')
        if (command.action === 'review') session.reviewSupported = true
        if (command.action === 'propose' || command.action === 'proposal_next') {
          const displayed = result as { status?: string; token?: string }
          let narration: 'submitted' | 'unavailable' | undefined
          if (
            displayed.status === 'shown' &&
            session.proposalToken === displayed.token &&
            session.proposalSpeech
          ) {
            narration = await session.proposalSpeech.then(
              () => 'submitted' as const,
              () => 'unavailable' as const,
            )
          }
          if (
            displayed.status === 'shown' &&
            (session.visibleProposal !== displayed.token ||
              this.session !== session ||
              this.current() !== id)
          )
            return { status: 'interrupted', shown: false }
          if (narration) return { ...displayed, narration }
        }
        if (command.action === 'progress') await session.plan?.narration
        return result
      }
      const previous = session.plan
      if (
        previous &&
        (!command.resume ||
          !previous.event ||
          !['paused', 'refresh_requested'].includes(previous.event.status) ||
          previous.event.token !== command.resume)
      )
        throw new Error(
          'Finish or explicitly refresh the current hint before starting another guide.',
        )
      if (command.resume && !previous) throw new Error('The guide to resume is no longer active.')
      const plan = randomUUID()
      session.plan = { id: plan, steps: command.steps, next: 0 }
      try {
        const shown = await this.request(session, {
          ...command,
          plan,
          steps: command.steps.map(({ line, hint }) => ({ line, hint })),
        })
        if (
          this.session !== session ||
          this.current() !== id ||
          shown !== plan ||
          session.plan?.id !== plan
        )
          throw new Error('Highlight was not confirmed.')
        await this.narrate(session, plan, 0)
        return {
          shown: session.plan.event?.status !== 'paused',
          ...session.plan.event,
          instruction:
            session.plan.event?.status === 'paused'
              ? 'The source changed during narration. Wait for an explicit refresh.'
              : 'The visible step was sent to Live speech. Wait for the learner to click or ask to continue.',
        }
      } catch (error) {
        if (this.session === session && session.plan?.id === plan && !session.plan.event)
          session.plan = previous
        throw error
      }
    } finally {
      this.busy = false
    }
  }
}
