import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import { useNavigationHistory } from '../hooks/useNavigationHistory'
import type { NavigationHandle } from '../../shared/navigationHistory'
import { createPortal } from 'react-dom'
import { artifactDocument, type ThreadArtifact } from '../../shared/artifacts'
import styles from './ArtifactView.module.css'
import panelStyles from './Panel.module.css'
import { InteractiveArtifact } from './InteractiveArtifact'
import { Tip } from './Tip'
import { artifactCatalog, useArtifactCatalog } from '../hooks/useArtifactCatalog'

const NO_ARTIFACTS: ThreadArtifact[] = []

function staticHtml(source: string) {
  const template = document.createElement('template')
  template.innerHTML = source
  template.content
    .querySelectorAll('script,iframe,frame,object,embed,base,meta,link,form')
    .forEach((node) => node.remove())
  template.content.querySelectorAll('*').forEach((node) => {
    for (const attribute of [...node.attributes]) {
      if (
        ['src', 'poster'].includes(attribute.name) &&
        !/^data:image\/(png|jpeg|webp);base64,/i.test(attribute.value)
      )
        node.removeAttribute(attribute.name)
      if (
        /^on/i.test(attribute.name) ||
        ['href', 'xlink:href', 'action', 'formaction', 'srcdoc', 'srcset', 'target'].includes(
          attribute.name,
        )
      )
        node.removeAttribute(attribute.name)
    }
  })
  return artifactDocument(template.innerHTML)
}

export function ArtifactView({
  threadId,
  initialArtifactId,
  onClose,
  navigationHost,
  navigationRef,
  historyKey = 'default',
  actionsHost,
  infoHost,
  onControlState,
}: {
  threadId: string
  initialArtifactId?: string
  onClose: () => void
  navigationHost: HTMLDivElement | null
  navigationRef?: Ref<NavigationHandle>
  historyKey?: string
  actionsHost: HTMLDivElement | null
  infoHost: HTMLDivElement | null
  onControlState?: (state: {
    threadId: string
    id: string
    readiness: 'ready' | 'loading' | 'unavailable'
  }) => void
}) {
  const catalog = useArtifactCatalog(threadId)
  const items = catalog?.items ?? NO_ARTIFACTS
  const [selected, setSelected] = useState<{ item: ThreadArtifact; content: string } | null>(null)
  const [selectedId, setSelectedId] = useState(initialArtifactId ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(true)
  useEffect(() => {
    onControlState?.({
      threadId,
      id: selectedId,
      readiness: error ? 'unavailable' : busy || !selected ? 'loading' : 'ready',
    })
  }, [threadId, selectedId, error, busy, selected, onControlState])
  const notice = catalog?.notice
  const currentSelection = useRef(selectedId)
  const chipRail = useRef<HTMLDivElement>(null)
  const viewer = useRef<HTMLElement>(null)
  const navigating = useRef(false)
  useEffect(() => {
    const rail = chipRail.current
    const chip = rail?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')
    if (!rail || !chip) return
    if (chip.offsetLeft < rail.scrollLeft) rail.scrollLeft = chip.offsetLeft
    else if (chip.offsetLeft + chip.offsetWidth > rail.scrollLeft + rail.clientWidth)
      rail.scrollLeft = chip.offsetLeft + chip.offsetWidth - rail.clientWidth
  }, [selectedId, items.length, navigationHost])
  useEffect(() => {
    currentSelection.current = selectedId
  }, [selectedId])
  useEffect(() => {
    let cancelled = false
    void artifactCatalog
      .refresh(threadId)
      .then(async (reply) => {
        if (cancelled) return
        if (reply.ok) {
          const item = initialArtifactId
            ? reply.items.find((item) => item.id === initialArtifactId)
            : reply.items[0]
          if (!item) {
            setError('The selected artifact is no longer available.')
            return
          }
          setSelectedId(item.id)
          const loaded =
            reply.content !== undefined
              ? reply
              : await window.threadlight.artifacts(threadId, 'read', item.id)
          if (cancelled) return
          if (!loaded.ok) setError(loaded.reason)
          else if (loaded.content !== undefined) setSelected({ item, content: loaded.content })
        } else setError(reply.reason)
      })
      .catch(() => {
        if (!cancelled) setError('Could not load artifacts.')
      })
      .finally(() => {
        if (!cancelled) setBusy(false)
      })
    return () => {
      cancelled = true
    }
  }, [threadId, initialArtifactId])

  useEffect(() => {
    if (busy || currentSelection.current || !catalog?.items[0]) return
    let cancelled = false
    const item = catalog.items[0]
    void window.threadlight
      .artifacts(threadId, 'read', item.id)
      .then((loaded) => {
        if (cancelled || currentSelection.current) return
        setSelectedId(item.id)
        if (loaded.ok && loaded.content !== undefined)
          setSelected({ item, content: loaded.content })
        else if (!loaded.ok) setError(loaded.reason)
      })
      .catch(() => {
        if (!cancelled) setError('Could not load artifact.')
      })
    return () => {
      cancelled = true
    }
  }, [threadId, catalog, busy])

  const request = useCallback(
    async (action: 'link' | 'read' | 'copy', item?: ThreadArtifact) => {
      setBusy(true)
      setError(null)
      if (action === 'read') {
        setSelected(null)
        if (item) setSelectedId(item.id)
      }
      try {
        const reply = await window.threadlight.artifacts(threadId, action, item?.id)
        if (!reply.ok) {
          setError(reply.reason)
          return
        }
        artifactCatalog.accept(threadId, reply)
        const target =
          (action === 'read' ? item : undefined) ??
          reply.items.find(
            (candidate) => !items.some((existing) => existing.id === candidate.id),
          ) ??
          (!selected ? reply.items[0] : undefined)
        if (target) {
          setSelectedId(target.id)
          setSelected(null)
          const loaded =
            reply.content !== undefined
              ? reply
              : await window.threadlight.artifacts(threadId, 'read', target.id)
          if (!loaded.ok) setError(loaded.reason)
          else if (loaded.content !== undefined)
            setSelected({ item: target, content: loaded.content })
        }
      } catch {
        setError('Could not load artifact.')
      } finally {
        setBusy(false)
      }
    },
    [threadId, items, selected],
  )

  const location = useNavigationHistory(
    { selectedId },
    (page) => {
      const item = items.find((item) => item.id === page.selectedId)
      if (item) void request('read', item)
    },
    !busy && !!selectedId,
    `artifacts:${threadId}:${historyKey}`,
  )
  useImperativeHandle(navigationRef, () => location, [location])

  const cycle = useCallback(
    (direction: number) => {
      if (busy || navigating.current || items.length < 2) return
      const index = items.findIndex((item) => item.id === selectedId)
      const next =
        index < 0
          ? direction > 0
            ? 0
            : items.length - 1
          : (index + direction + items.length) % items.length
      if (items[next]) {
        navigating.current = true
        void request('read', items[next]).finally(() => {
          navigating.current = false
        })
      }
    },
    [busy, items, selectedId, request],
  )
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (!viewer.current?.getClientRects().length || busy || items.length < 2) return
      if (
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.defaultPrevented
      )
        return
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.closest(
            'input, textarea, select, [role="textbox"], [role="slider"], [role="spinbutton"]',
          ))
      )
        return
      event.preventDefault()
      cycle(event.key === 'ArrowLeft' ? -1 : 1)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [busy, items.length, cycle])

  return (
    <section ref={viewer} className={styles.root} aria-label="Thread artifacts">
      {items.length > 0 &&
        navigationHost &&
        createPortal(
          <nav className={styles.navigator} aria-label="Thread artifact navigation">
            <button
              className={styles.arrow}
              aria-label="Previous artifact"
              aria-keyshortcuts="ArrowLeft"
              title="Previous artifact (←)"
              disabled={busy || items.length < 2}
              onClick={() => cycle(-1)}
            >
              ‹
            </button>
            <div className={styles.chips} ref={chipRail}>
              {items.map((item, index) => (
                <button
                  key={item.id}
                  data-artifact-id={item.id}
                  className={`${panelStyles.artifactTile} ${styles.chip}`}
                  aria-label={`Open artifact ${index + 1}: ${item.title}${item.source === 'copy' ? ' (saved copy)' : ''}`}
                  title={`${item.title}${item.source === 'copy' ? ' (saved copy)' : ''}`}
                  aria-pressed={selectedId === item.id}
                  disabled={busy}
                  onClick={() => void request('read', item)}
                >
                  <span aria-hidden="true" />
                </button>
              ))}
            </div>
            <button
              className={styles.arrow}
              aria-label="Next artifact"
              aria-keyshortcuts="ArrowRight"
              title="Next artifact (→)"
              disabled={busy || items.length < 2}
              onClick={() => cycle(1)}
            >
              ›
            </button>
          </nav>,
          navigationHost,
        )}
      {actionsHost &&
        createPortal(
          <>
            <ArtifactAction
              label="Refresh"
              help="Refresh this artifact from its original file."
              disabled={busy || !selectedId}
              onClick={() =>
                void request(
                  'read',
                  items.find((item) => item.id === selectedId),
                )
              }
            >
              <path d="M13 6a5 5 0 1 0 .1 4M13 2v4H9" />
            </ArtifactAction>
            <ArtifactAction
              label="Keep a copy"
              help="Keep a separate saved copy of this artifact."
              disabled={busy || selected?.item.source !== 'reference'}
              onClick={() => {
                if (selected) void request('copy', selected.item)
              }}
            >
              <rect x="6" y="6" width="7" height="8" rx="1" />
              <path d="M10 4V2H2v8h2" />
            </ArtifactAction>
            <ArtifactAction
              label="Link file…"
              help="Link an existing file to this thread without copying it."
              disabled={busy}
              onClick={() => void request('link')}
            >
              <path d="m6 10 4-4M5 9l-1 1a2.8 2.8 0 0 0 4 4l3-3a2.8 2.8 0 0 0 0-4M11 7l1-1a2.8 2.8 0 0 0-4-4L5 5a2.8 2.8 0 0 0 0 4" />
            </ArtifactAction>
          </>,
          actionsHost,
        )}
      {infoHost &&
        (error || notice || busy) &&
        createPortal(
          <div className={styles.info} aria-label="Artifact information">
            {error && <p role="alert">{error}</p>}
            {notice && <p role="status">{notice}</p>}
            {busy && <p role="status">Loading…</p>}
          </div>,
          infoHost,
        )}
      <div className={styles.stage} aria-label="Artifact content">
        {!selected && !busy && (
          <p>
            {items.length
              ? 'This artifact could not be displayed.'
              : 'No local artifacts found in this thread yet. You can link an existing file.'}
          </p>
        )}
        {selected?.item.kind === 'image' && (
          <img src={selected.content} alt={selected.item.title} />
        )}
        {selected?.item.kind === 'text' && <pre>{selected.content}</pre>}
        {selected?.item.kind === 'html' && (
          <InteractiveArtifact
            threadId={threadId}
            id={selected.item.id}
            onEscape={onClose}
            onNavigate={cycle}
            fallback={
              <iframe
                title={selected.item.title}
                sandbox=""
                referrerPolicy="no-referrer"
                srcDoc={staticHtml(selected.content)}
              />
            }
          />
        )}
      </div>
    </section>
  )
}

function ArtifactAction({
  label,
  help,
  disabled,
  onClick,
  children,
}: {
  label: string
  help: string
  disabled: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Tip text={help} className={styles.actionHint}>
      <button
        className={styles.action}
        aria-label={label}
        aria-description={help}
        disabled={disabled}
        onClick={onClick}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
          {children}
        </svg>
      </button>
    </Tip>
  )
}
