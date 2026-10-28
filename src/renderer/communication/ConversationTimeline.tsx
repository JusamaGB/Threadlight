import { Fragment, useEffect, useState, type ReactNode } from 'react'
import type { AgentItem } from '../../shared/agent'
import type { ConversationCard, ConversationFeed } from '../../shared/conversationEvents'
import { NativeRequest, Question } from './CommunicationView'
import styles from './CommunicationView.module.css'

function Card({
  card,
  owner,
  historical,
}: {
  card: ConversationCard
  owner: string
  historical: boolean
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
      className={styles.root}
      aria-label={`${card.title} ${card.kind} card`}
      data-card-id={card.id}
    >
      <strong>{card.title}</strong>
      <p>
        {card.question
          ? 'Threadlight question'
          : card.source.startsWith('codex:')
            ? 'Codex'
            : 'Claude'}{' '}
        · Local · {card.state.replaceAll('-', ' ')}
      </p>
      {card.state === 'pending' && !historical && card.request ? (
        <NativeRequest
          key={`${card.id}:${card.generation}`}
          request={card.request}
          busy={busy}
          focus={() => call('conversation_focus')}
          answer={(response) =>
            call('conversation_answer', { operationId: crypto.randomUUID(), response })
          }
        />
      ) : card.state === 'pending' && !historical && card.question ? (
        <Question
          title={card.body}
          choices={card.question.choices}
          allowOther={card.question.allowOther}
          busy={busy}
          answer={(answer) =>
            call('conversation_answer', { operationId: crypto.randomUUID(), answer })
          }
        />
      ) : (
        <p className={styles.body}>{card.body}</p>
      )}
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
      {card.speech === 'uncertain' && <p>Spoken update could not be confirmed.</p>}
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
}: {
  owner: string | null
  items: AgentItem[]
  historical?: boolean
  live?: boolean
  lines: (items: AgentItem[]) => ReactNode
}) {
  const [feed, setFeed] = useState<ConversationFeed | null>(null)
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
  const keys = new Set(items.map((item, index) => item.id ?? `line:${index}`))
  const render = (card: ConversationCard) => (
    <Card key={card.id} card={card} owner={owner!} historical={historical} />
  )
  return (
    <>
      {!historical && cards.some((c) => c.speech === 'pending') && (
        <button
          disabled={!live}
          onClick={() =>
            void window.threadlight.communicationRequest({
              action: 'conversation_catchup',
              arguments: { owner },
            })
          }
        >
          {live ? 'Hear pending updates' : 'Pending updates · connect GPT Live to hear them'}
        </button>
      )}
      {cards.filter((c) => !c.anchor || !keys.has(c.anchor)).map(render)}
      {items.map((item, index) => (
        <Fragment key={item.id ?? index}>
          {lines([item])}
          {cards.filter((c) => c.anchor === (item.id ?? `line:${index}`)).map(render)}
        </Fragment>
      ))}
    </>
  )
}
