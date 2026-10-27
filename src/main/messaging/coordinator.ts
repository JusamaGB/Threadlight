import { MESSAGE_LIMIT, type MessageOperation } from '../../shared/messaging'
import { MessageStore } from './store'

export interface DeliveryCapability {
  epoch: string
  state: 'idle' | 'working' | 'waiting' | 'unavailable'
  /** True only after idle-only dispatch races have been verified for this transport. */
  queue: boolean
  reason?: string
}

export type SubmissionReceipt =
  | { kind: 'accepted'; turnId: string }
  | { kind: 'rejected'; reason: string }
  | { kind: 'unknown'; reason: string }

/** A future desktop adapter must preserve ownership and enforce idle-only submission. */
export interface DesktopDelivery {
  capability(target: string): Promise<DeliveryCapability>
  submit(operation: MessageOperation): Promise<SubmissionReceipt>
  /** Read-only, identifier-based reconciliation; unavailable evidence stays unknown. */
  reconcile?(operation: MessageOperation): Promise<{
    phase: 'accepted' | 'completed' | 'failed'
    turnId: string
    epoch: string
    reason?: string
  } | null>
}

/** Not enabled for real desktop writes until the independent-connection gate passes. */
export class MessageCoordinator {
  private tail: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly store: MessageStore,
    private readonly delivery: DesktopDelivery,
    private readonly changed: () => void = () => {},
    private readonly now = Date.now,
  ) {}

  submit(input: Pick<MessageOperation, 'id' | 'target' | 'text' | 'intent'>) {
    return this.serial(async () => {
      const previous = this.store.list().find((op) => op.id === input.id)
      if (previous) {
        if (
          previous.target !== input.target ||
          previous.text !== input.text ||
          previous.intent !== input.intent
        )
          throw new Error('This operation ID already belongs to another message.')
        return previous
      }
      if (!input.text.trim() || input.text.length > MESSAGE_LIMIT)
        throw new Error('Enter a message up to 16000 characters.')
      if (
        this.store
          .list()
          .some(
            (op) =>
              op.target === input.target &&
              ['queued', 'held', 'submitting', 'accepted', 'unknown'].includes(op.phase),
          )
      )
        throw new Error('Resolve the previous message for this chat first.')
      const capability = await this.delivery.capability(input.target)
      if (capability.state === 'unavailable' || capability.state === 'waiting')
        throw new Error(
          capability.reason || 'This chat cannot receive an ordinary message right now.',
        )
      if (capability.state === 'working' && (input.intent !== 'queue' || !capability.queue))
        throw new Error('This chat is working. Your draft has not been sent.')
      const operation: MessageOperation = {
        ...input,
        epoch: capability.epoch,
        updatedAt: this.now(),
        phase: capability.state === 'working' ? 'queued' : 'submitting',
      }
      await this.save(operation)
      return operation.phase === 'queued' ? operation : this.dispatch(operation)
    })
  }

  /** Called after authoritative runtime state changes. Never replays uncertain writes. */
  refresh() {
    return this.serial(async () => {
      for (const op of this.store.list().filter((item) => item.phase === 'queued')) {
        const cap = await this.capability(op.target)
        if (cap.epoch !== op.epoch || cap.state === 'unavailable' || !cap.queue) {
          await this.save({
            ...op,
            phase: 'held',
            reason: 'Connection changed. Resume this message explicitly.',
          })
        } else if (cap.state === 'idle') {
          await this.dispatch(op)
        }
      }
    })
  }

  cancel(id: string) {
    return this.serial(async () => {
      const op = this.find(id)
      if (!['queued', 'held'].includes(op.phase))
        throw new Error('This message may already have been sent.')
      return this.save({ ...op, phase: 'cancelled' })
    })
  }

  edit(id: string, text: string) {
    return this.serial(async () => {
      const op = this.find(id)
      if (!['queued', 'held'].includes(op.phase))
        throw new Error('Only an unsent message can be edited.')
      if (!text.trim() || text.length > MESSAGE_LIMIT) throw new Error('Invalid message.')
      return this.save({ ...op, text })
    })
  }

  resume(id: string) {
    return this.serial(async () => {
      const op = this.find(id)
      if (op.phase !== 'held') throw new Error('Only a held, unsent message can be resumed.')
      const cap = await this.delivery.capability(op.target)
      if (!['idle', 'working'].includes(cap.state) || !cap.queue)
        throw new Error('Queueing is unavailable for this chat.')
      const next = await this.save({ ...op, epoch: cap.epoch, phase: 'queued', reason: undefined })
      return cap.state === 'idle' ? this.dispatch(next) : next
    })
  }

  /** Correlated provider events only. Text similarity is never a delivery receipt. */
  complete(target: string, epoch: string, turnId: string, failure?: string) {
    return this.serial(async () => {
      const op = this.store
        .list()
        .find(
          (item) =>
            item.target === target &&
            item.epoch === epoch &&
            item.turnId === turnId &&
            item.phase === 'accepted',
        )
      if (op) await this.save({ ...op, phase: failure ? 'failed' : 'completed', reason: failure })
    })
  }

  reconcile(id: string) {
    return this.serial(async () => {
      const op = this.find(id)
      if (!['unknown', 'accepted'].includes(op.phase) || !this.delivery.reconcile) return op
      const result = await this.delivery.reconcile(op)
      if (!result) return op
      if (!result.turnId || (op.turnId && op.turnId !== result.turnId))
        throw new Error('Recovery evidence does not match the accepted turn.')
      return this.save({ ...op, ...result })
    })
  }

  private async dispatch(op: MessageOperation): Promise<MessageOperation> {
    // The adapter must also enforce this at dispatch; this check alone cannot prevent desktop races.
    const cap = await this.capability(op.target)
    if (cap.epoch !== op.epoch || cap.state !== 'idle')
      return this.save({
        ...op,
        phase: 'held',
        reason: 'The chat changed before sending. Review and resume the message.',
      })
    const pending = await this.save({ ...op, phase: 'submitting', reason: undefined })
    let receipt: SubmissionReceipt
    try {
      receipt = await this.delivery.submit(pending)
    } catch {
      receipt = {
        kind: 'unknown',
        reason: 'Delivery could not be confirmed. Check Codex before resending.',
      }
    }
    return this.save({
      ...pending,
      phase: receipt.kind,
      ...(receipt.kind === 'accepted' ? { turnId: receipt.turnId } : { reason: receipt.reason }),
    })
  }

  private find(id: string) {
    const op = this.store.list().find((item) => item.id === id)
    if (!op) throw new Error('Message not found.')
    return op
  }
  private async capability(target: string): Promise<DeliveryCapability> {
    try {
      return await this.delivery.capability(target)
    } catch {
      return { epoch: '', state: 'unavailable', queue: false }
    }
  }
  private async save(op: MessageOperation) {
    const saved = await this.store.put({ ...op, updatedAt: this.now() })
    this.changed()
    return saved
  }
  private serial<T>(action: () => Promise<T>): Promise<T> {
    const next = this.tail.then(action)
    this.tail = next.catch(() => {})
    return next
  }
}
