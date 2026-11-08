import { useEffect, useSyncExternalStore } from 'react'
import { CHAT_RATE_LIMITED } from '../../shared/accountChats'
import type {
  ChatCommand,
  ChatReply,
  ChatSource,
  ChatSummary,
  SharedDeliveryStatus,
} from '../../shared/accountChats'
import { accountChatDraft, clearSentAccountChatDraft } from '../lib/accountChatDraft'

type HealthOperation = 'Discovery' | 'History' | 'Messaging' | 'Capability' | 'Shared message'
interface HealthIssue {
  reason: string
  since: number
}
interface SourceState {
  issues: Partial<Record<HealthOperation, HealthIssue>>
  lastListSuccess: number
  chats: ChatSummary[]
  headIds: string[]
  busy: boolean
  background: boolean
  loaded: boolean
  error: string
  hasMore: boolean
  checkedAt: number
  retryAt: number
  revision: number
  sendingId: string | null
  sendError: { id: string; reason: string } | null
}
const empty = (): SourceState => ({
  issues: {},
  lastListSuccess: 0,
  chats: [],
  headIds: [],
  busy: false,
  background: false,
  loaded: false,
  error: '',
  hasMore: false,
  checkedAt: 0,
  retryAt: 0,
  revision: 0,
  sendingId: null,
  sendError: null,
})
let state: Record<ChatSource, SourceState> = { chatgpt: empty(), perplexity: empty() }
const listeners = new Set<() => void>()
const flights: Record<ChatSource, Promise<void>> = {
  chatgpt: Promise.resolve(),
  perplexity: Promise.resolve(),
}
let menuOpen = false
export function holdAccountChat(_id: string | null, menu = false) {
  menuOpen = menu
}
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
function update(source: ChatSource, patch: Partial<SourceState>) {
  state = { ...state, [source]: { ...state[source], ...patch } }
  listeners.forEach((listener) => listener())
}
function recordHealth(source: ChatSource, operation: HealthOperation, reason?: string) {
  const issues = { ...state[source].issues }
  if (issues[operation]?.reason === reason) return
  if (reason) issues[operation] = { reason, since: Date.now() }
  else delete issues[operation]
  update(source, { issues })
}
const deliverySequence: Partial<Record<ChatSource, number>> = {}
function observeDelivery(status: SharedDeliveryStatus) {
  if (status.sequence <= (deliverySequence[status.source] ?? 0)) return
  deliverySequence[status.source] = status.sequence
  recordHealth(
    status.source,
    'Shared message',
    status.failed ? 'The last shared message failed. Check its delivery record.' : undefined,
  )
}
export function useAccountChatState() {
  return useSyncExternalStore(subscribe, () => state)
}
export async function accountChatRequest(
  source: ChatSource,
  command: ChatCommand,
  background = false,
): Promise<ChatReply | null> {
  if (background && Date.now() < state[source].retryAt) return null
  // Background reads may skip a busy connection. Explicit actions wait their turn.
  while (state[source].busy) {
    if (background) return null
    await flights[source]
  }
  let finished!: () => void
  flights[source] = new Promise<void>((resolve) => {
    finished = resolve
  })
  update(source, { busy: true, background })
  const operation =
    command.action === 'list'
      ? 'Discovery'
      : command.action === 'read'
        ? 'History'
        : command.action === 'send' || command.action === 'confirm-delivery'
          ? 'Messaging'
          : undefined
  try {
    const reply = await window.threadlight.accountChats(command)
    if (!reply.ok && reply.busy) return reply
    if (operation) recordHealth(source, operation, reply.ok ? undefined : reply.reason)
    update(source, {
      error: reply.ok ? '' : reply.reason,
      ...(!reply.ok && reply.retryAt && { retryAt: reply.retryAt }),
    })
    if (
      reply.ok &&
      command.action === 'confirm-delivery' &&
      state[source].sendError?.id === command.id
    )
      update(source, { sendError: null })
    if (
      reply.ok &&
      reply.kind === 'read' &&
      reply.page.activity &&
      command.action === 'read' &&
      !command.older
    ) {
      const activity = reply.page.activity
      update(source, {
        chats: state[source].chats.map((chat) =>
          chat.id === reply.page.id ? { ...chat, activity } : chat,
        ),
      })
    }
    return reply
  } catch {
    const reason = 'Chat connection unavailable. Retry in Settings.'
    if (operation) recordHealth(source, operation, reason)
    update(source, { error: reason })
    return { ok: false, reason }
  } finally {
    update(source, { busy: false, background: false })
    finished()
  }
}
export async function sendAccountChat(source: ChatSource, id: string) {
  if (state[source].sendingId) return null
  const draft = accountChatDraft(source, id)
  if (!draft.text.trim()) return null
  update(source, { sendingId: id, sendError: null })
  try {
    const reply = await accountChatRequest(source, {
      action: 'send',
      source,
      id,
      message: draft.text.trim(),
      operationId: crypto.randomUUID(),
    })
    if (reply?.ok && reply.kind === 'sent') clearSentAccountChatDraft(source, id, draft)
    else
      update(source, {
        sendError: { id, reason: reply && !reply.ok ? reply.reason : 'Could not send. Try again.' },
      })
    return reply
  } finally {
    update(source, { sendingId: null })
  }
}
const listFlights = new Map<string, Promise<void>>()
export function refreshAccountChats(source: ChatSource, more = false, poll = false) {
  const key = [source, more, poll].join(':')
  const flight = listFlights.get(key)
  if (flight) return flight
  const pending = refreshList(source, more, poll).finally(() => listFlights.delete(key))
  listFlights.set(key, pending)
  return pending
}
async function refreshList(source: ChatSource, more: boolean, poll: boolean) {
  const reply = await accountChatRequest(source, { action: 'list', source, more, poll }, poll)
  if (!reply) return
  if (reply.ok && reply.kind === 'list') {
    if (reply.sharedDelivery) observeDelivery(reply.sharedDelivery)
    recordHealth(
      source,
      'Capability',
      reply.repliesAvailable === false
        ? 'The desktop app does not advertise chat replies.'
        : undefined,
    )
    update(source, {
      lastListSuccess: Date.now(),
      chats: poll
        ? [
            ...new Map(
              [
                ...state[source].chats.filter((chat) => !state[source].headIds.includes(chat.id)),
                ...reply.chats,
              ].map((chat) => [chat.id, chat]),
            ).values(),
          ]
        : more
          ? [...state[source].chats, ...reply.chats]
          : reply.chats,
      hasMore: reply.hasMore,
      headIds: more ? state[source].headIds : reply.chats.map((chat) => chat.id),
      loaded: true,
      checkedAt: Date.now(),
      revision: state[source].revision + (more || poll ? 0 : 1),
    })
  } else if (!reply.ok && !reply.busy) {
    update(source, { hasMore: false, loaded: true, checkedAt: Date.now() })
  }
}
/** One shared read connection per source; Settings and rows never compete for ownership. */
export function useAccountChatDiscovery(
  settingsReady: boolean,
  sources: ChatSource[],
  listVisible: boolean,
) {
  const key = sources.join(',')
  useEffect(() => window.threadlight.onSharedDeliveryStatus?.(observeDelivery), [])
  useEffect(() => {
    if (!settingsReady) return
    const selected = key.split(',').filter(Boolean) as ChatSource[]
    if (typeof window.threadlight.accountChats !== 'function') {
      for (const source of selected)
        recordHealth(source, 'Discovery', 'Chat connection is unavailable in this build.')
      return
    }
    const refresh = () => {
      if (menuOpen) return
      for (const source of selected) {
        const current = state[source],
          now = Date.now()
        // Check enabled sources once at startup. A visible non-list page can recover
        // an outstanding problem, but never needs a healthy ChatGPT list every minute.
        if (source === 'chatgpt' && current.loaded && !current.issues.Discovery && !listVisible)
          continue
        const cadence =
          source === 'chatgpt' || current.issues.Discovery || !listVisible ? 60000 : 5000
        if (
          !current.busy &&
          (!document.hidden || !current.loaded) &&
          now >= current.retryAt &&
          now - current.checkedAt >= cadence
        )
          void refreshAccountChats(
            source,
            false,
            state[source].loaded &&
              (!state[source].issues.Discovery ||
                (state[source].lastListSuccess > 0 &&
                  state[source].issues.Discovery.reason === CHAT_RATE_LIMITED)),
          )
      }
    }
    refresh()
    const timer = window.setInterval(refresh, 5000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [settingsReady, listVisible, key])
}
