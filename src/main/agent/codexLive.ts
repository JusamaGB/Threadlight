import type { AgentItem } from '../../shared/agent'
import type { CodexTransport } from './codexClient'
import { isObject, str, type JsonObject } from '../sessions/json'

const OPENING_INSTRUCTIONS =
  'You are Threadlight, a concise live voice assistant. The opening user request is already transcribed and will be submitted directly to the backing Codex agent. Do not delegate or execute that opening yourself. Wait silently during preparation. When backend answer text arrives in context, speak that answer to the user immediately, then listen for follow-up speech. Do not wait for additional microphone audio before conveying the backend answer. For subsequent spoken requests use native delegation when tools or current facts are needed. Respect all permissions and approvals. Never invent completion or facts.'

/** Native thread-scoped WebRTC uses the existing ChatGPT sign-in. WebSocket does not. */
export class CodexLive {
  private resolve?: (sdp: string) => void
  private reject?: (error: Error) => void
  private timer?: ReturnType<typeof setTimeout>
  private ended = false
  private stopping?: Promise<void>
  private items = new Map<string, AgentItem>()

  constructor(
    private client: CodexTransport,
    private threadId: string,
    private sessionId: string,
    private onItem: (item: AgentItem, complete: boolean) => void,
    private onEnd: (message?: string) => void,
  ) {}

  async start(sdp: string): Promise<string> {
    const answer = new Promise<string>((resolve, reject) => {
      this.resolve = resolve
      this.reject = reject
      this.timer = setTimeout(() => this.end('Codex Live did not connect in time.'), 30_000)
    })
    // Observe immediately: an error event can precede the request acknowledgement.
    void answer.catch(() => {})
    try {
      await this.client.request('thread/realtime/start', {
        threadId: this.threadId,
        voiceSessionId: this.sessionId,
        outputModality: 'audio',
        version: 'v3',
        transport: { type: 'webrtc', sdp },
        flushTranscriptTailOnSessionEnd: false,
        codexResponseHandoffMode: 'commentary',
        prompt: OPENING_INSTRUCTIONS,
        initialItems: [
          {
            role: 'developer',
            text: OPENING_INSTRUCTIONS,
          },
        ],
      })
      const remote = await answer
      if (this.ended) throw new Error('Live closed during connection setup.')
      return remote
    } catch (error) {
      this.end((error as Error).message)
      throw error
    }
  }

  event(method: string, params: JsonObject): boolean {
    if (!method.startsWith('thread/realtime/') || params.threadId !== this.threadId) return false
    if (this.ended) return true
    if (method === 'thread/realtime/sdp' && str(params.sdp)) {
      clearTimeout(this.timer)
      this.resolve?.(params.sdp as string)
      this.resolve = undefined
      this.reject = undefined
    } else if (method === 'thread/realtime/error') {
      this.end(str(params.message) ?? 'Codex Live disconnected.')
    } else if (method === 'thread/realtime/closed') {
      this.end()
    } else if (
      method === 'thread/realtime/item/started' ||
      method === 'thread/realtime/item/completed'
    ) {
      const item = params.item
      if (isObject(item) && item.type === 'transcriptSegment' && str(item.id)) {
        const view: AgentItem = {
          id: `live:${item.id}`,
          kind: item.role === 'user' ? 'you' : 'agent',
          text: str(item.text) ?? '',
        }
        this.items.set(item.id as string, view)
        this.onItem(view, method.endsWith('/completed'))
      }
    } else if (method === 'thread/realtime/item/transcript/delta') {
      const item = this.items.get(str(params.itemId) ?? '')
      if (item && typeof params.delta === 'string') {
        item.text += params.delta
        this.onItem({ ...item }, false)
      }
    }
    return true
  }

  stop(): Promise<void> {
    return (this.stopping ??= (async () => {
      this.end()
      await this.client
        .request('thread/realtime/stop', { threadId: this.threadId }, 5000)
        .catch(() => {})
    })())
  }

  disconnect(message: string): void {
    this.end(message)
  }

  private end(message?: string): void {
    if (this.ended) return
    this.ended = true
    clearTimeout(this.timer)
    this.reject?.(new Error(message ?? 'Live conversation closed.'))
    this.reject = undefined
    this.resolve = undefined
    this.onEnd(message)
  }
}
