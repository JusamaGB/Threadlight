import type { AgentItem } from '../../shared/agent'
import type { CodexTransport } from './codexClient'
import { isObject, str, type JsonObject } from '../sessions/json'

/** Native thread-scoped WebRTC uses the existing ChatGPT sign-in. WebSocket does not. */
export class CodexLive {
  private resolve?: (sdp: string) => void
  private reject?: (error: Error) => void
  private timer?: ReturnType<typeof setTimeout>
  private ended = false
  private opened = false
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
        initialItems: [
          {
            role: 'developer',
            text: 'Wait silently for the first user message. This microphone session is a conversation, not a command interface. Keep spoken replies concise. Use the backing Codex agent for tasks and respect its approval decisions.',
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

  /** The opening transcript is submitted once; an uncertain acknowledgement is never retried. */
  async open(text: string): Promise<void> {
    if (this.ended || this.opened) throw new Error('This Live opening was already sent or closed.')
    this.opened = true
    await this.client.request('thread/realtime/appendText', {
      threadId: this.threadId,
      role: 'user',
      text,
    })
    if (this.ended) throw new Error('Live closed while sending. Check Earlier before retrying.')
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
