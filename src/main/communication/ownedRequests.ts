import { randomUUID } from 'node:crypto'
import type { AgentService } from '../agent/agentService'
import type {
  NativeCommunicationRequest,
  NativeCommunicationResponse,
} from '../../shared/communication'

/** Pending RPCs remain on their owning runtime. Only ephemeral handles cross the service. */
export class OwnedRequests {
  private handles = new Map<string, { id: string; at: number; owner: AgentService; key: string }>()
  constructor(
    private owners: () => AgentService[],
    private now = Date.now,
  ) {}
  list(): NativeCommunicationRequest[] {
    const live = new Set<string>()
    const result: NativeCommunicationRequest[] = []
    for (const owner of this.owners()) {
      const state = owner.current
      const request = state.requests[0]
      if (!request || !state.sessionId || request.questions?.some((q) => q.secret)) continue
      const key = `${state.conversationId}:${request.id}`
      live.add(key)
      let handle = this.handles.get(key)
      if (!handle) {
        handle = { id: randomUUID(), at: this.now(), owner, key: request.id }
        this.handles.set(key, handle)
      }
      result.push({
        id: handle.id,
        generation: handle.id,
        target: state.provider === 'codex' ? `codex:${state.sessionId}` : state.sessionId,
        kind: request.questions?.length ? 'question' : 'approval',
        title: request.title,
        detail: request.detail,
        startedAt: handle.at,
        expiresAt: handle.at + 60 * 60_000,
        questions: request.questions?.map((q) => ({
          question: q.text,
          options: q.options.map((label) => ({ label })),
        })),
      })
    }
    for (const key of this.handles.keys()) if (!live.has(key)) this.handles.delete(key)
    return result
  }
  respond(id: string, generation: string, response: NativeCommunicationResponse) {
    this.list()
    const handle = [...this.handles.values()].find((h) => h.id === id && h.id === generation)
    if (!handle || this.now() >= handle.at + 60 * 60_000)
      return { ok: false as const, reason: 'The owning runtime no longer has this request.' }
    const request = handle.owner.current.requests.find((r) => r.id === handle.key)
    if (!request) return { ok: false as const, reason: 'That request ended.' }
    if (response.action === 'answer') {
      if (!request.questions?.length || request.questions.some((q) => !response.answers?.[q.text]))
        return { ok: false as const, reason: 'Answer every current question.' }
      return handle.owner.respond(handle.key, {
        action: 'answer',
        answers: Object.fromEntries(
          request.questions.map((q) => [q.id, response.answers![q.text]]),
        ),
      })
    }
    return handle.owner.respond(handle.key, response)
  }
  clear() {
    this.handles.clear()
  }
}
