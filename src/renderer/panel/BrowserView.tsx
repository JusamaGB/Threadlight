import { useCallback, useEffect, useRef, useState } from 'react'
import type { BrowserState, BrowserUiRequest } from '../../shared/browser'
import styles from './BrowserView.module.css'
import { ContextMenu } from './ContextMenu'
import { VideoGrips } from './VideoGrips'
const spiral = new URL('../assets/browser-spiral.png', import.meta.url).href

export function BrowserView({ threadId }: { threadId: string }) {
  const [state, setState] = useState<BrowserState>()
  const [address, setAddress] = useState('')
  const [error, setError] = useState('')
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const covered = useRef(false)
  useEffect(() => {
    covered.current = !!menu || !!error
  }, [menu, error])
  const [generation, setGeneration] = useState(0)
  const stage = useRef<HTMLDivElement>(null)
  const [card, setCard] = useState<HTMLElement | null>(null)
  const attachStage = useCallback((element: HTMLDivElement | null) => {
    stage.current = element
    setCard(element?.closest<HTMLElement>('[data-card]') ?? null)
  }, [])
  const editingAddress = useRef(false)
  const active = useRef<BrowserState | undefined>(undefined)
  const apply = (value: BrowserState) => {
    if (!editingAddress.current && active.current?.url !== value.url)
      setAddress(value.url === 'about:blank' ? '' : value.url)
    active.current = value
    setState(value)
  }
  useEffect(() => {
    const token = crypto.randomUUID()
    let stopped = false
    let browserId = ''
    let frame = 0
    let previous = ''
    const unsubscribe = window.threadlight.onBrowserChanged((value) => {
      if (!stopped && value.threadId === threadId) apply(value)
    })
    const update = () => {
      if (stopped) return
      const element = stage.current
      if (element && browserId) {
        const rect = element.getBoundingClientRect()
        let left = Math.max(0, rect.left),
          top = Math.max(0, rect.top)
        let right = Math.min(innerWidth, rect.right),
          bottom = Math.min(innerHeight, rect.bottom)
        for (let parent = element.parentElement; parent; parent = parent.parentElement) {
          const style = getComputedStyle(parent)
          if (/(auto|scroll|hidden|clip)/.test(`${style.overflowX} ${style.overflowY}`)) {
            const clip = parent.getBoundingClientRect()
            left = Math.max(left, clip.left)
            top = Math.max(top, clip.top)
            right = Math.min(right, clip.right)
            bottom = Math.min(bottom, clip.bottom)
          }
        }
        const bounds = {
          x: left,
          y: top,
          width: Math.max(0, right - left),
          height: Math.max(0, bottom - top),
        }
        // The footer can change height while the browser is away. Measure the
        // space around the player once the fullscreen sizing styles are in use.
        const videoInsets =
          active.current?.videoSized &&
          bounds.width &&
          bounds.height &&
          element.closest('[data-card]')?.parentElement?.querySelector('[data-video-sized]')
            ? { width: innerWidth - bounds.width, height: innerHeight - bounds.height }
            : undefined
        const key = JSON.stringify([bounds, covered.current, videoInsets])
        if (key !== previous) {
          previous = key
          void window.threadlight
            .browserRequest({
              action: 'bounds',
              browserId,
              token,
              bounds,
              videoInsets,
              covered: covered.current,
            })
            .catch(() => {})
        }
      }
      frame = requestAnimationFrame(update)
    }
    void window.threadlight
      .browserRequest({ action: 'attach', threadId, token })
      .then((reply) => {
        browserId = reply.state?.id ?? ''
        if (stopped) {
          if (browserId)
            void window.threadlight.browserRequest({ action: 'detach', browserId, token })
          return
        }
        if (reply.state) apply(reply.state)
        if (!reply.ok) setError(reply.reason ?? 'Browser unavailable.')
        update()
      })
      .catch(() => setError('Browser unavailable.'))
    return () => {
      stopped = true
      cancelAnimationFrame(frame)
      unsubscribe()
      if (browserId) void window.threadlight.browserRequest({ action: 'detach', browserId, token })
    }
  }, [threadId, generation])
  async function request(input: BrowserUiRequest) {
    setError('')
    try {
      const reply = await window.threadlight.browserRequest(input)
      if (!reply.ok) setError(reply.reason ?? 'Browser action failed.')
      if (reply.state) apply(reply.state)
      return reply
    } catch {
      setError('Browser action failed.')
      return undefined
    }
  }
  const action = (
    name: 'back' | 'forward' | 'reload' | 'fullscreen' | 'takeover' | 'external' | 'local',
  ) => {
    if (state) void request({ action: name, browserId: state.id })
  }
  const failed = error || state?.error
  const empty = !state || state.url === 'about:blank'
  return (
    <div
      className={styles.root}
      aria-label="Shared browser"
      onContextMenu={(event) => {
        event.preventDefault()
        event.stopPropagation()
        setMenu({ x: event.clientX, y: event.clientY })
      }}
    >
      {(!state?.fullscreen || state.controller) && (
        <div className={styles.toolbar}>
          {!state?.fullscreen && (
            <>
              <button
                aria-label="Back"
                title="Back"
                disabled={!state?.back}
                onClick={() => action('back')}
              >
                ←
              </button>
              <button
                aria-label="Forward"
                title="Forward"
                disabled={!state?.forward}
                onClick={() => action('forward')}
              >
                →
              </button>
              <button
                aria-label="Reload"
                title="Reload"
                disabled={!state}
                onClick={() => action('reload')}
              >
                ↻
              </button>
              <form
                onSubmit={(event) => {
                  event.preventDefault()
                  editingAddress.current = false
                  if (state && address.trim())
                    void request({ action: 'navigate', browserId: state.id, url: address.trim() })
                }}
              >
                <input
                  disabled={!state}
                  aria-label="Search or enter address"
                  placeholder="Search or enter address"
                  value={address}
                  onChange={(event) => {
                    editingAddress.current = true
                    setAddress(event.target.value)
                  }}
                  onBlur={() => {
                    editingAddress.current = false
                  }}
                />
                {state?.loading && (
                  <span className={styles.loading} role="status" aria-label="Loading page">
                    <img src={spiral} alt="" />
                  </span>
                )}
              </form>
              <button
                aria-label="Browser options"
                title="Browser options"
                aria-expanded={!!menu}
                onClick={(event) => {
                  const bounds = event.currentTarget.getBoundingClientRect()
                  setMenu(menu ? null : { x: bounds.right, y: bounds.bottom })
                }}
              >
                ⋯
              </button>
            </>
          )}
          {state?.controller && (
            <button
              title={`${state.controller} is controlling the browser`}
              onClick={() => action('takeover')}
            >
              Take control
            </button>
          )}
        </div>
      )}
      <div ref={attachStage} className={styles.stage} aria-label="Browser page">
        {(empty || failed) && (
          <div className={styles.idle}>
            <img className={styles.spiral} src={spiral} alt="Threadlight" />
            {failed && (
              <div className={styles.failure} role="alert">
                <p title={failed}>Couldn’t open this page.</p>
                <button
                  onClick={() => {
                    if (state && address.trim())
                      void request({ action: 'navigate', browserId: state.id, url: address.trim() })
                    else action('reload')
                  }}
                >
                  Retry
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      {card && state?.visible && state.fullscreen && state.videoAspect && !failed && (
        <VideoGrips card={card} state={state} />
      )}
      {menu && (
        <ContextMenu
          label="Browser options"
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { label: 'Open HTML…', disabled: !state, onSelect: () => action('local') },
            {
              label: 'Open externally',
              disabled: !state?.url.startsWith('http'),
              onSelect: () => action('external'),
            },
            {
              label: 'Reset browser',
              disabled: !state,
              onSelect: () => {
                if (state)
                  void request({ action: 'close', browserId: state.id }).then((reply) => {
                    if (reply?.ok) {
                      setState(undefined)
                      active.current = undefined
                      setAddress('')
                      setGeneration((value) => value + 1)
                    }
                  })
              },
            },
          ]}
        />
      )}
    </div>
  )
}
