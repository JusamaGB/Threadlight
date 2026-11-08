import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { AnswerComposer } from '../composer/AnswerComposer'
import { useAccountChatDraft } from '../lib/accountChatDraft'
import type { Session } from '../../shared/types'
import { mergedRecentThreads, type RecentThread } from '../../shared/sessionOrder'
import {
  chatSourceName,
  type ChatMessage,
  type ChatSource,
  type ChatSummary,
} from '../../shared/accountChats'
import {
  accountChatRequest,
  holdAccountChat,
  refreshAccountChats,
  sendAccountChat,
  useAccountChatState,
} from '../hooks/useAccountChats'
import { lastActiveText } from '../lib/format'
import { Tip } from './Tip'
import { ContextMenu, type MenuItem } from './ContextMenu'
import rowStyles from './Panel.module.css'
import styles from './AccountChats.module.css'
import { ChatMessageContent } from './ChatMessageContent'
import { EarlierMessages } from './EarlierMessages'

export type AccountChatRow = ChatSummary & { source: ChatSource }

/** Ordinary thread rows. Provider setup and empty/error diagnostics belong in Settings. */
export function AccountChats({
  visible,
  chats,
  now,
  sessions,
  renderSession,
  limit = 10,
  layoutItems = [],
}: {
  visible: boolean
  chats: AccountChatRow[]
  now: number
  sessions?: Session[]
  renderSession?: (session: Session, index: number) => ReactNode
  limit?: number
  layoutItems?: MenuItem[]
}) {
  const [selected, setSelected] = useState<string | null>(null)
  const [menu, setMenu] = useState<{
    key: string
    chat: AccountChatRow
    x: number
    y: number
    trigger: HTMLElement
  } | null>(null)
  const [refresh, setRefresh] = useState({ key: '', revision: 0 })
  const state = useAccountChatState()
  const rows: (RecentThread & { hidden?: boolean })[] = sessions
    ? mergedRecentThreads(sessions, visible ? chats : [], limit)
    : chats.map((chat) => ({
        kind: 'chat',
        key: `${chat.source}:${chat.id}`,
        at: chat.updatedAt ?? 0,
        chat,
      }))
  const retained = rows.some((row) => row.key === selected) ? selected : null
  // Keep an open reader mounted when a type filter hides it, without using a visible list slot.
  if (sessions)
    for (const chat of chats) {
      const key = `${chat.source}:${chat.id}`
      if (!rows.some((row) => row.key === key))
        rows.push({ kind: 'chat', key, at: chat.updatedAt ?? 0, chat, hidden: true })
    }
  useEffect(() => {
    holdAccountChat(retained, !!menu)
    return () => holdAccountChat(null)
  }, [retained, menu])
  return (
    <div
      hidden={!visible && !sessions}
      data-account-chats=""
      data-merged-recent={sessions ? '' : undefined}
    >
      {rows.map((row, index) => {
        if (row.kind === 'session') return renderSession?.(row.session, index)
        const { chat, key } = row
        const expanded = selected === key
        const name = chatSourceName(chat.source)
        return (
          <div
            key={key}
            hidden={row.hidden}
            data-striped={index % 2 === 1 || undefined}
            data-account-chat={chat.id}
            data-provider={chat.source}
            className={`${rowStyles.row} ${styles.chatRow} ${expanded ? rowStyles.expanded : ''}`}
          >
            {expanded && (
              <>
                <span className={rowStyles.edgeTop} aria-hidden="true" />
                <span className={rowStyles.edgeBottom} aria-hidden="true" />
              </>
            )}
            <Tip
              as="button"
              className={rowStyles.rowButton}
              text={`${name} · ${chat.updatedAt === null ? 'Activity unavailable' : lastActiveText(chat.updatedAt, now)}`}
              aria-description={`${name} chat`}
              aria-haspopup="menu"
              aria-expanded={expanded}
              onClick={() => setSelected(expanded ? null : key)}
              onContextMenu={(event) => {
                event.preventDefault()
                event.stopPropagation()
                setMenu({
                  key,
                  chat,
                  x: event.clientX,
                  y: event.clientY,
                  trigger: event.currentTarget,
                })
              }}
              onKeyDown={(event) => {
                if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
                event.preventDefault()
                event.stopPropagation()
                const box = event.currentTarget.getBoundingClientRect()
                setMenu({ key, chat, x: box.left, y: box.bottom, trigger: event.currentTarget })
              }}
            >
              <span className={rowStyles.rowTop}>
                <span className={rowStyles.dotSlot} aria-hidden="true">
                  <span className={styles.providerDot} />
                </span>
                <span className={rowStyles.title}>{chat.title || 'Untitled chat'}</span>
              </span>
              <span className={rowStyles.rowBottom}>
                <span className={rowStyles.stage}>
                  {name}
                  {chat.activity === 'active' || chat.updatedAt !== null ? ' · ' : ''}
                  {chat.activity === 'active'
                    ? 'Working…'
                    : chat.updatedAt !== null
                      ? lastActiveText(chat.updatedAt, now)
                      : ''}
                </span>
              </span>
            </Tip>
            {expanded && (
              <ChatConversation
                key={`${state[chat.source].revision}:${refresh.key === key ? refresh.revision : 0}`}
                source={chat.source}
                id={chat.id}
                visible={visible && !row.hidden}
              />
            )}
          </div>
        )
      })}
      {menu && visible && rows.some((row) => row.key === menu.key && !row.hidden) && (
        <ContextMenu
          label={`${chatSourceName(menu.chat.source)} chat menu`}
          x={menu.x}
          y={menu.y}
          items={[
            {
              label: selected === menu.key ? 'Close conversation' : 'Read conversation',
              onSelect: () => setSelected(selected === menu.key ? null : menu.key),
            },
            {
              label: 'Refresh conversation',
              disabled: state[menu.chat.source].busy,
              onSelect: () => {
                if (state[menu.chat.source].error) {
                  void refreshAccountChats(menu.chat.source).then(() => setSelected(menu.key))
                  return
                }
                setSelected(menu.key)
                setRefresh((previous) => ({ key: menu.key, revision: previous.revision + 1 }))
              },
            },
            ...(state[menu.chat.source].hasMore
              ? [
                  {
                    label: 'Load older chats',
                    disabled: state[menu.chat.source].busy,
                    onSelect: () => {
                      void refreshAccountChats(menu.chat.source, true)
                    },
                  },
                ]
              : []),
            ...layoutItems,
          ]}
          onClose={() => {
            setMenu(null)
            if (menu.trigger.isConnected) menu.trigger.focus()
          }}
        />
      )}
    </div>
  )
}

function ChatConversation({
  source,
  id,
  visible,
}: {
  source: ChatSource
  id: string
  visible: boolean
}) {
  const name = chatSourceName(source)
  const state = useAccountChatState()[source]
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [older, setOlder] = useState(false)
  const [limited, setLimited] = useState(false)
  const [pages, setPages] = useState(0)
  const [error, setError] = useState('')
  const [canSend, setCanSend] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const sending = state.sendingId === id
  const sendError = state.sendError?.id === id ? state.sendError.reason : ''
  const [loading, setLoading] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const reading = useRef(false)
  const foregroundRead = useRef(false)
  const readFlight = useRef<Promise<void>>(Promise.resolve())
  const { draft, setDraft, saveError } = useAccountChatDraft(source, id)
  const [dictating, setDictating] = useState(false)
  const composing = useCallback((active: boolean) => setDictating(active), [])
  const conversation = useRef<HTMLElement>(null)
  const alive = useRef(true)
  const transcript = useRef<HTMLDivElement>(null)
  const pendingSent = useRef<{ key: string; text: string; known: Set<string> } | null>(null)
  const read = async (loadOlder = false, latest = false) => {
    if (!latest) {
      if (foregroundRead.current) return
      foregroundRead.current = true
      setLoading(true)
      setLoadingOlder(loadOlder)
    }
    while (reading.current) {
      if (latest) return
      await readFlight.current
    }
    reading.current = true
    let finished!: () => void
    readFlight.current = new Promise<void>((resolve) => {
      finished = resolve
    })
    try {
      const reply = await accountChatRequest(
        source,
        { action: 'read', source, id, older: loadOlder, latest },
        latest,
      )
      if (!alive.current || !reply) return
      const before = transcript.current?.scrollHeight ?? 0
      const position = transcript.current?.scrollTop ?? 0
      const follow = before - position - (transcript.current?.clientHeight ?? 0) < 24
      setError('')
      if (!reply.ok) {
        setMessages([])
        setCanSend(false)
        setOlder(false)
        setError(reply.reason)
        return
      }
      if (reply.kind !== 'read' || reply.page.id !== id) return
      setCanSend(!!reply.page.canSend)
      setUncertain(!!reply.page.deliveryUncertain)
      const pending = pendingSent.current
      const replaced =
        pending &&
        reply.page.messages.some(
          (message) =>
            message.role === 'user' &&
            message.text === pending.text &&
            !pending.known.has(message.id),
        )
      if (replaced) pendingSent.current = null
      setMessages((previous) => [
        ...new Map(
          (loadOlder
            ? [...reply.page.messages, ...previous]
            : latest
              ? [
                  ...previous.filter((message) => !replaced || message.id !== pending?.key),
                  ...reply.page.messages,
                ]
              : reply.page.messages
          ).map((m) => [m.id, m]),
        ).values(),
      ])
      if (!latest) setOlder(reply.page.hasMore)
      setLimited(reply.page.limited)
      if (!latest) setPages((previous) => (loadOlder ? previous + 1 : 1))
      requestAnimationFrame(() => {
        if (transcript.current)
          transcript.current.scrollTop = loadOlder
            ? position + transcript.current.scrollHeight - before
            : latest
              ? follow
                ? transcript.current.scrollHeight
                : position
              : transcript.current.scrollHeight
      })
    } finally {
      reading.current = false
      finished()
      if (!latest) foregroundRead.current = false
      if (alive.current && !latest) {
        setLoading(false)
        setLoadingOlder(false)
      }
    }
  }
  useEffect(() => {
    alive.current = true
    void read()
    return () => {
      alive.current = false
    }
    // A conversation is keyed by provider and ID; navigation retains the mounted reader.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, id])
  const latestRead = useRef(read)
  useEffect(() => {
    latestRead.current = read
  })
  useEffect(() => {
    if (!visible) return
    const timer = window.setInterval(() => {
      if (!document.hidden) void latestRead.current(false, true)
    }, 2000)
    return () => window.clearInterval(timer)
  }, [visible])
  const send = async () => {
    if (sending || uncertain || !draft.trim()) return
    const submitted = draft.trim()
    const known = new Set(messages.map((message) => message.id))
    const reply = await sendAccountChat(source, id)
    if (!alive.current) return
    if (reply?.ok && reply.kind === 'sent') {
      const key = `sent:${reply.operationId}`
      pendingSent.current = { key, text: submitted, known }
      setMessages((previous) => [
        ...previous,
        { id: key, role: 'user', text: submitted, truncated: false },
      ])
      await read(false, true)
    } else {
      if (reply && !reply.ok) {
        await refreshAccountChats(source)
        await read(false, true)
      }
    }
  }
  return (
    <section
      ref={conversation}
      className={styles.conversation}
      data-code-thread={source + ':' + id}
      data-code-title={state.chats.find((chat) => chat.id === id)?.title}
      aria-label={`${name} conversation`}
      aria-busy={loading || sending}
    >
      {(sending || (loading && !messages.length)) && (
        <small role="status">{sending ? 'Sending…' : 'Reading…'}</small>
      )}
      {error && <p role="alert">{error}</p>}
      {limited && (
        <Tip
          className={styles.hint}
          text="Some tools, attachments and interactive content are available only in the provider app."
        >
          Limited view
        </Tip>
      )}
      <div
        ref={transcript}
        className={styles.transcript}
        tabIndex={0}
        aria-label={`${name} messages`}
      >
        {older && pages < 10 && (
          <EarlierMessages loading={loadingOlder} onLoad={() => void read(true)} />
        )}
        {older && pages >= 10 && (
          <p className={styles.hint}>More history is available in {name}.</p>
        )}
        {!messages.length && !state.busy && !error && <p>No readable messages returned.</p>}
        {messages.map((message) => (
          <article key={message.id} data-message-id={message.id}>
            <small>{message.role === 'user' ? 'You' : name}</small>
            <ChatMessageContent
              message={message}
              followUpDisabled={!canSend || sending || uncertain || dictating || !!draft.trim()}
              onFollowUp={(text) => {
                if (!canSend || sending || uncertain || dictating || draft.trim()) return
                setDraft(text)
                conversation.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus()
              }}
            />
            {message.truncated && (
              <small>Message shortened · open {name} for the full message.</small>
            )}
          </article>
        ))}
      </div>
      {sendError && <p role="alert">{sendError}</p>}
      {saveError && <p role="status">{saveError}</p>}
      {uncertain && (
        <div>
          <p role="alert">Delivery is uncertain. Check {name} before sending again.</p>
          <button
            disabled={state.busy && !state.background}
            onClick={() =>
              void (async () => {
                const reply = await accountChatRequest(source, {
                  action: 'confirm-delivery',
                  source,
                  id,
                })
                if (reply?.ok) {
                  setUncertain(false)
                }
              })()
            }
          >
            I checked {name}
          </button>
        </div>
      )}
      {canSend && (
        <AnswerComposer
          id={`account-chat:${source}:${id}`}
          label={`Message ${name}`}
          value={draft}
          onChange={setDraft}
          disabled={sending}
          sendDisabled={sending || uncertain}
          sendLabel={`Send to ${name}`}
          placeholder="Type a message…"
          maxLength={20000}
          onSend={() => void send()}
          onActivityChange={composing}
        />
      )}
    </section>
  )
}
