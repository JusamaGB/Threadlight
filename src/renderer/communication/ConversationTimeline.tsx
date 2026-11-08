import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import type { AgentItem } from '../../shared/agent'
import { agentTranscript } from '../../shared/agentTranscript'
import type { ConversationCard, ConversationFeed } from '../../shared/conversationEvents'
import { NativeRequest, Question } from './CommunicationView'
import { ActivityDisclosure } from '../panel/ThreadActivity'
import { AgentMessageContent } from '../panel/AgentMessageContent'
import { ContextMenu } from '../panel/ContextMenu'
import { Tip } from '../panel/Tip'
import styles from '../panel/AgentThread.module.css'

function provider(source: string) {
  if (source.startsWith('codex:')) return 'Codex'
  if (source.startsWith('perplexity:')) return 'Perplexity'
  if (source.startsWith('chatgpt:')) return 'ChatGPT'
  if (/^[a-f0-9-]{36}$/i.test(source)) return 'Claude'
  return 'Threadlight'
}

const stateLabel = (state: string) =>
  ({
    pending: 'Needs you',
    completed: 'Received',
    submitting: 'Sending',
    unknown: 'Unconfirmed',
    'response-uncertain': 'Unconfirmed',
    'answered-here': 'Answered',
    expired: 'Expired',
    unavailable: 'Unavailable',
  })[state] ?? state.replaceAll('-', ' ')

function Card({
  card,
  owner,
  historical,
  target,
}: {
  card: ConversationCard
  owner: string
  historical: boolean
  target?: string | null
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  async function call(action: string, extra: Record<string, unknown> = {}) {
    setBusy(true)
    setError('')
    try {
      const result = await window.threadlight.communicationRequest({
        action,
        arguments: { owner, cardId: card.id, revision: card.revision, ...extra },
      })
      if (!result.ok) setError(result.reason)
      return result.ok
    } catch {
      setError('Response not confirmed. Check the current card before retrying.')
      return false
    } finally {
      setBusy(false)
    }
  }
  return (
    <section
      className={styles.card}
      aria-label={`${card.title} ${card.kind} card`}
      data-card-id={card.id}
      data-card-state={card.state}
    >
      {!(card.state === 'pending' && !historical && (card.request || card.question)) && (
        <div className={styles.cardHead}>
          <strong>{card.request?.title ?? card.title}</strong>
        </div>
      )}
      <div className={styles.cardMeta}>
        <span>{provider(card.source)}</span>
        {card.request && card.title !== card.request.title && <span>{card.title}</span>}
        <span className={styles.state}>
          {historical && card.state === 'pending' ? 'Earlier' : stateLabel(card.state)}
        </span>
      </div>
      {card.state === 'pending' && !historical && card.request ? (
        <NativeRequest
          key={`${card.id}:${card.generation}`}
          request={card.request}
          direct={card.request.target === target}
          busy={busy}
          focus={() => call('conversation_focus')}
          answer={(response) =>
            call('conversation_answer', { operationId: crypto.randomUUID(), response })
          }
        />
      ) : card.state === 'pending' && !historical && card.question ? (
        <Question
          key={`${card.id}:${card.generation}`}
          title={card.body}
          choices={card.question.choices}
          allowOther={card.question.allowOther}
          busy={busy}
          answer={(answer) =>
            call('conversation_answer', { operationId: crypto.randomUUID(), answer })
          }
        />
      ) : card.body !== (card.request?.title ?? card.title) ? (
        <AgentMessageContent text={card.body} />
      ) : null}
      {card.recordedAnswer && <p style={{ whiteSpace: 'pre-wrap' }}>{card.recordedAnswer}</p>}
      <details className={styles.cardDetails}>
        <summary>Details</summary>
        <p>
          {card.state.replaceAll('-', ' ')}
          {card.at ? ` · ${new Date(card.at).toLocaleString()}` : ''}
        </p>
        <button
          onClick={() =>
            void window.threadlight
              .communicationRequest({
                action: 'conversation_open',
                arguments: { owner, cardId: card.id },
              })
              .then((result) => {
                if (result.ok && typeof result.value === 'string')
                  window.threadlight.openInClaude(result.value)
                else if (!result.ok) setError(result.reason)
              })
              .catch(() => setError('Source chat is unavailable.'))
          }
        >
          Open source chat
        </button>
      </details>
      {card.speech === 'uncertain' && (
        <p className={styles.warning}>Spoken update could not be confirmed.</p>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  )
}

/** Uses existing cards; anchors external events to the conversation line present on arrival. */
export function ConversationTimeline({
  owner,
  items,
  historical = false,
  live = false,
  lines,
  tail,
  target,
}: {
  owner: string | null
  items: AgentItem[]
  historical?: boolean
  live?: boolean
  lines: (items: AgentItem[], itemKey?: string) => ReactNode
  tail?: ReactNode
  target?: string | null
}) {
  const [feed, setFeed] = useState<ConversationFeed | null>(null)
  const [copyMenu, setCopyMenu] = useState<{ x: number; y: number; text: string } | null>(null)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let live = true,
      refreshing = false,
      again = false
    const refresh = async () => {
      if (!owner || !window.threadlight.communicationRequest) return
      if (refreshing) {
        again = true
        return
      }
      refreshing = true
      try {
        do {
          again = false
          const result = await window.threadlight.communicationRequest({
            action: 'conversation_feed',
            arguments: { owner },
          })
          if (live && result.ok) setFeed(result.value as ConversationFeed)
        } while (live && again)
      } finally {
        refreshing = false
      }
    }
    void refresh().catch(() => {})
    const unsubscribe = window.threadlight.onCommunication?.(() => void refresh().catch(() => {}))
    const timer = setInterval(() => void refresh().catch(() => {}), 1000)
    return () => {
      live = false
      clearInterval(timer)
      unsubscribe?.()
    }
  }, [owner])
  const cards = feed?.owner === owner ? feed.cards : []
  const pendingSpeech = cards.filter((card) => card.speech === 'pending').length
  const visible = new Set(items.map((item, index) => item.id ?? 'line:' + index))
  const anchored: ConversationCard[] = [],
    pending: ConversationCard[] = [],
    saved: ConversationCard[] = []
  for (const card of cards) {
    if (!historical && card.state === 'pending' && (card.request || card.question))
      pending.push(card)
    else if (card.anchor && visible.has(card.anchor)) anchored.push(card)
    else if (card.afterLiveItem && visible.has(card.afterLiveItem))
      anchored.push({ ...card, anchor: card.afterLiveItem })
    else saved.push(card)
  }
  // Several off-page decisions may share the same surviving transcript segment.
  anchored.sort((a, b) => a.at - b.at)
  saved.sort((a, b) => a.at - b.at)
  const renderCard = (card: ConversationCard) => (
    <Card
      key={'card:' + card.id}
      card={card}
      owner={owner ?? 'new'}
      historical={historical}
      target={target}
    />
  )
  const rows = agentTranscript(items, anchored, historical)
  const content = rows.map((row) => {
    if (row.kind === 'card') return renderCard(row.card)
    if (row.kind === 'activity')
      return (
        <ActivityDisclosure key={row.key} label={row.items.at(-1)!.text} active={false}>
          <div className={styles.activityBody}>{lines(row.items)}</div>
        </ActivityDisclosure>
      )
    return <Fragment key={'message:' + row.key}>{lines([row.item], row.key)}</Fragment>
  })
  content.push(...pending.map(renderCard))
  content.push(<Fragment key="tail">{tail}</Fragment>)
  const selectedText = () => {
    const selection = window.getSelection()
    return selection &&
      !selection.isCollapsed &&
      root.current?.contains(selection.anchorNode) &&
      root.current.contains(selection.focusNode)
      ? selection.toString()
      : ''
  }
  return (
    <div
      className={styles.thread}
      ref={root}
      role="region"
      aria-label="Conversation messages"
      data-code-thread={owner ?? undefined}
      tabIndex={0}
      onContextMenu={(event) => {
        const text = selectedText()
        if (!text) return
        event.preventDefault()
        event.stopPropagation()
        setCopyMenu({ x: event.clientX, y: event.clientY, text })
      }}
      onKeyDown={(event) => {
        if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
        const text = selectedText()
        if (!text) return
        event.preventDefault()
        event.stopPropagation()
        const rect = window.getSelection()!.getRangeAt(0).getBoundingClientRect()
        setCopyMenu({ x: rect.left, y: rect.bottom, text })
      }}
    >
      {!historical && pendingSpeech > 0 && (
        <div className={styles.announcement}>
          <span>
            {pendingSpeech} {pendingSpeech === 1 ? 'update' : 'updates'} waiting
          </span>
          <Tip
            text={live ? 'Hear the pending updates.' : 'Connect GPT Live to hear pending updates.'}
          >
            <button
              disabled={!live}
              onClick={() =>
                void window.threadlight.communicationRequest({
                  action: 'conversation_catchup',
                  arguments: { owner },
                })
              }
            >
              Hear pending updates
            </button>
          </Tip>
        </div>
      )}
      {saved.length > 0 && (
        <details className={styles.cardDetails}>
          <summary>Saved cards ({saved.length})</summary>
          {saved.map(renderCard)}
        </details>
      )}
      {content}
      {copyMenu && (
        <ContextMenu
          label="Text actions"
          x={copyMenu.x}
          y={copyMenu.y}
          onClose={() => {
            setCopyMenu(null)
            root.current?.focus({ preventScroll: true })
          }}
          items={[{ label: 'Copy', onSelect: () => window.threadlight.copyText(copyMenu.text) }]}
        />
      )}
    </div>
  )
}
