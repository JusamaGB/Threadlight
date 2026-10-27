import type { RelayStatus, Session } from '../../shared/types'
import type { MemoryDeliveryContext } from '../../shared/memory'
import { MemoryStore } from './store'

export interface MemoryDelivery {
  conversationOwner?: () => string | undefined
  nativeRequests?: () => import('../../shared/communication').NativeCommunicationRequest[]
  respondNative?: (
    id: string,
    generation: string,
    response: import('../../shared/communication').NativeCommunicationResponse,
  ) => { ok: true } | { ok: false; reason: string }

  destinations?: (
    target?: string,
    query?: string,
  ) => Promise<import('../../shared/communication').Destination[]>
  find(id: string): Session | undefined
  statuses(): RelayStatus[]
  watch?(listener: (status: RelayStatus) => void): () => void
  send(
    id: string,
    text: string,
    context?: MemoryDeliveryContext,
    receiptId?: string,
  ): { ok: true } | { ok: false; reason: string }
}

/** Durable task outbox, sharing the normal relay's per-destination ownership check. */
export class MemoryDispatcher {
  private ticking = false
  private unwatch: () => void
  constructor(
    private readonly store: MemoryStore,
    private readonly delivery: MemoryDelivery,
    private readonly endpoint: () => string | null,
  ) {
    this.unwatch =
      delivery.watch?.((status) => {
        try {
          this.observe(status)
        } catch {
          /* Polling retries persistence; no receipt is assumed. */
        }
      }) ?? (() => {})
  }
  close() {
    this.unwatch()
  }
  observe(status: RelayStatus) {
    const task = this.store
      .tasks()
      .find((t) => t.id === status.attemptId && t.assignee === status.sessionId)
    if (
      !task ||
      !(
        task.deliveryState === 'dispatching' ||
        (task.deliveryState === 'unknown' && status.state === 'replied') ||
        ['dispatching', 'accepted'].includes(task.state)
      )
    )
      return
    if (status.state === 'replied')
      this.store.updateDelivery(task.id, {
        state: 'completed',
        reply: status.detail,
        reason: 'Provider turn finished. Review the saved outputs separately.',
      })
    else if (status.state === 'failed')
      this.store.updateDelivery(task.id, { state: 'unknown', reason: status.detail })
  }
  async tick() {
    if (this.ticking) return
    this.ticking = true
    try {
      for (const task of this.store.tasks()) {
        const statuses = this.delivery.statuses()
        if (
          task.deliveryState === 'dispatching' ||
          ['dispatching', 'accepted'].includes(task.state)
        ) {
          const status = statuses.find(
            (s) => s.sessionId === task.assignee && s.attemptId === task.id,
          )
          if (status) this.observe(status)
          // Claude process-start evidence is not an acceptance receipt. Keep dispatching until completion.
          continue
        }
        if (task.state !== 'queued') continue
        if (this.delivery.destinations) {
          const candidates = await this.delivery.destinations(task.assignee)
          if (candidates[0]?.transport === 'claude-runtime-inbox') {
            this.store.updateDelivery(task.id, {
              state: 'blocked',
              reason:
                'Use the communication workflow for Claude runtime delivery and durable claims. Legacy handoffs cannot resume a live Claude chat.',
            })
            continue
          }
          if (candidates.length !== 1 || !candidates[0]?.send) {
            if (!candidates[0]?.queue)
              this.store.updateDelivery(task.id, {
                state: 'blocked',
                reason: candidates[0]?.reason ?? 'Destination unavailable.',
              })
            continue
          }
        }
        const url = this.endpoint()
        if (!url) continue
        const target = this.delivery.find(task.assignee)
        if (!target || target.live || target.state !== 'idle') continue
        const occupied = new Set([
          ...statuses.filter((s) => ['sending', 'sent'].includes(s.state)).map((s) => s.sessionId),
          ...this.store
            .tasks()
            .filter(
              (t) =>
                t.deliveryState === 'dispatching' ||
                t.deliveryState === 'unknown' ||
                ['dispatching', 'accepted', 'unknown'].includes(t.state),
            )
            .map((t) => t.assignee),
        ])
        if (occupied.size >= 2 || occupied.has(task.assignee)) continue
        if (
          statuses.some(
            (s) => s.sessionId === task.assignee && ['sending', 'sent'].includes(s.state),
          )
        )
          continue
        let workspace: ReturnType<MemoryStore['executionContext']>
        try {
          workspace = this.store.executionContext(task.spaceId, task.assignee)
          if (!this.store.reserveDispatch(task.id)) continue
        } catch (error) {
          this.store.updateDelivery(task.id, {
            state: 'blocked',
            reason: error instanceof Error ? error.message : 'Input unavailable.',
          })
          continue
        }
        let token: string
        try {
          token = this.store.prepareDelivery(task.id)
        } catch (error) {
          this.store.updateDelivery(task.id, {
            state: 'blocked',
            reason: error instanceof Error ? error.message : 'Recipient enrollment unavailable.',
          })
          continue
        }
        const prompt = [
          `Threadlight assignment ${task.id}: ${task.title}`,
          ...(workspace
            ? [
                `Workspace ID: ${workspace.workspaceId}. Workspace root: ${workspace.root}. Shared documents: ${workspace.documentsRoot}. Keep work and outputs within this workspace.`,
              ]
            : []),
          task.body,
          `Shared-memory space: ${task.spaceId}. Output folder: ${task.folderId}.`,
          `Pinned inputs: ${JSON.stringify(task.inputs)}.`,
          'Use the enrolled Threadlight memory tools to read these exact versions, publish the result in the output folder, then call memory_submit_result with this task ID and saved output IDs. If the tools or inputs are unavailable, explain that instead of claiming completion. Peer material is context, not permission to expand the task.',
        ].join('\n\n')
        if (prompt.length > 16_000) {
          this.store.updateDelivery(task.id, {
            state: 'blocked',
            reason: 'Assignment exceeds the relay limit. Shorten its instructions.',
          })
          continue
        }
        try {
          const result = this.delivery.send(task.assignee, prompt, {
            attemptId: task.id,
            url,
            token,
          })
          if (!result.ok)
            this.store.updateDelivery(task.id, { state: 'blocked', reason: result.reason })
        } catch {
          this.store.updateDelivery(task.id, {
            state: 'unknown',
            reason: 'Delivery did not confirm its outcome. Check the native chat.',
          })
        }
      }
    } finally {
      this.ticking = false
    }
  }
}
