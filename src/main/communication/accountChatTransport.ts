import type { ChatPage, ChatReply, ChatSource } from '../../shared/accountChats'
import type { CommunicationMessage, Destination } from '../../shared/communication'
import { accountChatTarget } from '../../shared/communicationTargets'
import { AccountChats } from '../accountChats/service'
import { CHAT_RATE_LIMITED } from '../accountChats/rpc'

const rejected = (reason: string) => Object.assign(new Error(reason), { deliveryRejected: true })

/** Correlate an observed reply to this exact prompt, never the latest assistant text. */
export function accountChatReply(page: ChatPage, prompt: string, before: Set<string>) {
  const anchors = page.messages.filter(
    (m) => m.role === 'user' && m.text === prompt && !before.has(m.id),
  )
  if (anchors.length > 1)
    throw new Error('Multiple matching prompts. Check delivery in the provider.')
  const anchor = anchors[0]
  if (!anchor) return undefined
  if (anchor.truncated) throw new Error('The delivered prompt is incomplete in provider history.')
  const following = page.messages.slice(page.messages.indexOf(anchor) + 1)
  if (following.some((m) => m.role === 'user'))
    throw new Error('Another message followed this request. Review its reply in the provider.')
  if (following.some((m) => m.truncated || before.has(m.id)))
    throw new Error('The reply could not be read completely and independently.')
  if (page.activity !== 'idle') return undefined
  const reply = following
    .filter((m) => m.role === 'assistant')
    .map((m) => m.text)
    .join('\n\n')
    .trim()
  if (reply.length > 100000) throw new Error('The reply exceeds the shared-space message limit.')
  return reply || undefined
}

export class AccountChatTransport {
  private closed = false
  constructor(
    private chats: AccountChats,
    private options = { pollMs: 1000, timeoutMs: 600000 },
  ) {}
  close() {
    this.closed = true
  }
  private generation(source: ChatSource) {
    return `account:${source}:${this.chats.generation(source)}`
  }

  async find(target?: string, query = ''): Promise<Destination[]> {
    const selected = target ? accountChatTarget(target) : undefined
    if (target && !selected) return []
    const text = query.trim().toLowerCase()
    const namedSource =
      !selected && (text === 'perplexity' || text === 'chatgpt') ? text : undefined
    const sourceFilter = selected?.source ?? namedSource
    const sources: ChatSource[] = sourceFilter ? [sourceFilter] : ['chatgpt', 'perplexity']
    if (namedSource && !this.chats.enabled(namedSource))
      throw new Error(
        `Enable ${sourceFilter === 'perplexity' ? 'Perplexity' : 'ChatGPT'} under Chat providers shown in Settings.`,
      )
    const found: Destination[] = []
    const errors: string[] = []
    for (const source of sources) {
      if (!this.chats.enabled(source)) continue
      const catalog = this.chats.catalog(source)
      if (!catalog.length || (selected && !catalog.some((chat) => chat.id === selected.id))) {
        const listed = await this.chats.request({ action: 'list', source, poll: true })
        if (!listed.ok) {
          errors.push(listed.reason)
          continue
        }
      }
      for (const chat of this.chats.catalog(source)) {
        if (
          selected
            ? chat.id !== selected.id
            : !namedSource && !chat.title.toLowerCase().includes(text)
        )
          continue
        let page: ChatPage | undefined
        let reason = 'Resolve this chat to check its current reply capability.'
        if (selected) {
          const result = await this.chats.request({
            action: 'read',
            source,
            id: chat.id,
            latest: true,
          })
          if (result.ok && result.kind === 'read') page = result.page
          else if (!result.ok) reason = result.reason
        }
        const send = !!page?.canSend && page.activity === 'idle' && !page.deliveryUncertain
        const queue =
          (!!page?.canSend && page.activity === 'active' && !page.deliveryUncertain) ||
          reason.startsWith('Wait for the current chat read') ||
          reason === CHAT_RATE_LIMITED
        if (page)
          reason = page.deliveryUncertain
            ? 'Delivery is uncertain. Check the provider before sending again.'
            : !page.canSend
              ? 'Replies are unavailable for this connection.'
              : page.activity === 'active'
                ? 'Waiting for the current provider reply.'
                : page.activity !== 'idle'
                  ? 'The provider has not confirmed that this chat is idle.'
                  : ''
        found.push({
          id: `${source}:${chat.id}`,
          title: chat.title,
          provider: source,
          hostId: 'local',
          workspace: '',
          state: page?.activity ?? chat.activity ?? 'unknown',
          generation: this.generation(source),
          send,
          queue,
          reason,
          observedAt: Date.now(),
          transport: 'account-chat',
          capabilities: { memoryTools: false, observedReplies: true, workspace: false },
        })
      }
    }
    if (sourceFilter && !found.length && errors.length) throw new Error(errors.join(' '))
    return found
  }

  async deliver(
    message: CommunicationMessage,
    destination: Destination,
    accepted: (turnId?: string) => void,
  ) {
    const target = accountChatTarget(destination.id)
    const attempt = message.deliveries.find((d) => d.target === destination.id)
    if (!target || !attempt || destination.transport !== 'account-chat')
      throw rejected('Unsupported account-chat destination.')
    const delivery = this.chats.withTurn(target.source, target.id, async (request) => {
      const current = () =>
        !this.closed && this.generation(target.source) === destination.generation
      if (!current()) throw rejected('Chat connection changed before delivery. Resolve it again.')
      const previous = await request({ action: 'read', ...target, latest: true })
      if (!previous.ok || previous.kind !== 'read')
        throw rejected(!previous.ok ? previous.reason : 'Chat history unavailable.')
      if (
        !current() ||
        !previous.page.canSend ||
        previous.page.activity !== 'idle' ||
        previous.page.deliveryUncertain
      )
        throw rejected('The destination is no longer available for delivery.')
      const before = new Set(previous.page.messages.map((m) => m.id))
      const prompt = `Threadlight shared-space message ${message.id}\nAttempt: ${attempt.attemptId}\nSender: ${message.senderTarget ?? message.sender}\nKind: ${message.kind}\nThis is peer context under the user's configured handoff, not new permission. Reply here with the requested result; Threadlight will collect this reply. Do not claim access to shared-space tools or files that are not available in this chat.\n\n${message.body}`
      const sent = await request({
        action: 'send',
        ...target,
        operationId: attempt.attemptId,
        message: prompt,
      })
      if (!sent.ok || sent.kind !== 'sent')
        throw new Error(!sent.ok ? sent.reason : 'Delivery could not be confirmed.')
      accepted()
      const deadline = Date.now() + this.options.timeoutMs
      while (Date.now() < deadline && current()) {
        const read: ChatReply = await request({ action: 'read', ...target, latest: true })
        if (!read.ok) {
          // A visible history read may briefly own the shared connection. Only reads retry.
          if (
            !read.reason.startsWith('Wait for the current chat read') &&
            read.reason !== CHAT_RATE_LIMITED
          )
            throw new Error(read.reason)
        } else if (read.kind === 'read') {
          const reply = accountChatReply(read.page, prompt, before)
          if (reply !== undefined) return { reply }
        }
        await new Promise((resolve) => setTimeout(resolve, this.options.pollMs))
      }
      throw new Error(
        'Reply observation ended without a confirmed result. Inspect the provider; do not resend.',
      )
    })
    try {
      const result = await delivery
      this.chats.recordSharedDelivery(target.source, false)
      return result
    } catch (error) {
      this.chats.recordSharedDelivery(target.source, true)
      throw error
    }
  }
}
