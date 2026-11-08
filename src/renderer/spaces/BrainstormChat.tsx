import { useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from 'react'
import { BRAINSTORM_HOTKEY } from '../../shared/accelerator'
import type { SpaceIdea } from '../../shared/spaces'
import { AgentView, type AgentNavigation } from '../panel/AgentView'
import { BrainstormAgent } from './brainstormAgent'
import { CodeLineLinks } from './CodeLineLinks'
import { SourceLinks } from './BrainstormContext'
import styles from './SharedSpacesView.module.css'

export interface BrainstormNavigation {
  back: () => boolean
  showCurrent: () => void
}

/** Project binding around the ordinary Agent conversation; no separate voice controller. */
export function BrainstormChat({
  client,
  discussions,
  requestedId,
  visible,
  voiceActive,
  onVoiceToggle,
  renderDiscussion,
  navigationRef,
}: {
  client: BrainstormAgent
  discussions: SpaceIdea[]
  requestedId: string | null
  visible: boolean
  voiceActive: boolean
  onVoiceToggle: (client: BrainstormAgent) => void
  renderDiscussion: (discussion: SpaceIdea) => ReactNode
  navigationRef: Ref<BrainstormNavigation>
}) {
  const [selection, setSelection] = useState(client.selection)
  const lastRequested = useRef<string | null>(null)
  const navigation = useRef<AgentNavigation>(null)
  useEffect(() => client.onSelection(setSelection), [client])
  useEffect(() => {
    if (requestedId && requestedId !== lastRequested.current) client.select(requestedId)
    lastRequested.current = requestedId
  }, [requestedId, client])
  useImperativeHandle(
    navigationRef,
    () => ({
      back: () => navigation.current?.navigate('back') ?? false,
      showCurrent: () => navigation.current?.showCurrent(),
    }),
    [],
  )
  const discussion = discussions.find((d) => d.id === selection)
  return (
    <section className={styles.brainstormChat} aria-label="Brainstorm chat">
      <AgentView
        key={`agent:${selection ?? 'new'}`}
        historyKey={`brainstorm-reading:${client.spaceId}:${selection ?? 'new'}`}
        client={client}
        navigationRef={navigation}
        visible={visible}
        shortcut={BRAINSTORM_HOTKEY}
        onVoiceToggle={() => onVoiceToggle(client)}
        voiceActive={voiceActive}
        discussionStatus={(historyId) => {
          const current = historyId ? discussions.find((d) => d.id === historyId) : discussion
          const pin = current?.sourcePin
          if (!current || !pin) return null
          return (
            <small aria-live="polite">
              {pin.filename} · v{pin.revision} ·{' '}
              {current.sourceReadThrough === undefined
                ? 'Waiting for file read'
                : pin.totalLines === 0
                  ? 'Empty file'
                  : `Lines 1–${current.sourceReadThrough} of ${pin.totalLines} returned to Brainstorm`}{' '}
              · No tests run
            </small>
          )
        }}
        formatText={(text, historyId) => {
          const id = historyId ?? selection
          if (!id) return text
          return discussions.find((d) => d.id === id)?.sourcePin ? (
            <CodeLineLinks discussionId={id} text={text} />
          ) : (
            <SourceLinks discussionId={id} text={text} />
          )
        }}
      />
      {discussion && renderDiscussion(discussion)}
    </section>
  )
}
