import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react'

import type { Session } from '../../shared/types'
import { StatusDot } from '../dot/Dot'
import { useNow } from '../hooks/useNow'
import { useSessions } from '../hooks/useSessions'
import { en } from '../i18n/en'
import { ContextMenu, type MenuItem } from './ContextMenu'
import styles from './Panel.module.css'
import { SessionRow } from './SessionRow'

type View = 'active' | 'all'

const LIST_HOURS = 24
const isActive = (s: Session) => s.state === 'working' || s.state === 'waiting'

interface MenuState {
  x: number
  y: number
  session: Session
}

export function Panel() {
  const sessions = useSessions()
  const now = useNow()
  const [view, setView] = useState<View>('active')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [maxHeight, setMaxHeight] = useState(800)
  const card = useRef<HTMLDivElement>(null)

  // Each time the panel opens it starts fresh on the Active view.
  useEffect(
    () =>
      window.threadlight.onPanelOpened(({ maxHeight }) => {
        setView('active')
        setExpanded(null)
        setMenu(null)
        setMaxHeight(maxHeight)
      }),
    [],
  )

  // The window is sized to the card, so the card reports its height whenever it changes.
  useLayoutEffect(() => {
    const element = card.current
    if (!element) return
    const observer = new ResizeObserver(() =>
      window.threadlight.resizePanel(element.getBoundingClientRect().height),
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (menu) setMenu(null)
      else window.threadlight.closePanel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menu])

  const working = sessions.filter((s) => s.state === 'working').length
  const waiting = sessions.filter((s) => s.state === 'waiting').length
  const shown = view === 'all' ? sessions : sessions.filter(isActive)
  const counts = [
    ...(working ? [en.panel.working(working)] : []),
    ...(waiting ? [en.panel.waiting(waiting)] : []),
    en.panel.recentCount(sessions.length),
  ]

  const openMenu = (event: MouseEvent, session: Session) => {
    event.preventDefault()
    setMenu({ x: event.clientX, y: event.clientY, session })
  }
  const menuItems = (session: Session): MenuItem[] => [
    {
      label: en.menu.openInClaude,
      disabled: !session.appId,
      onSelect: () => session.appId && window.threadlight.openInClaude(session.appId),
    },
  ]

  return (
    <div ref={card} className={styles.card} style={{ maxHeight }}>
      <header className={styles.header}>
        <span className={styles.heading}>
          {view === 'active' ? en.panel.active : en.panel.recent}
        </span>
        <span className={styles.counts}>{counts.join(' · ')}</span>
        <StatusDot
          working={working > 0}
          title={en.panel.toggleView}
          onClick={() => setView(view === 'active' ? 'all' : 'active')}
        />
      </header>

      <div className={styles.list}>
        {shown.length === 0 && (
          <p className={styles.empty}>
            {view === 'active' ? en.panel.nothingWorking : en.panel.noSessions(LIST_HOURS)}
          </p>
        )}
        {shown.map((session) => (
          <SessionRow
            key={session.id}
            session={session}
            now={now}
            expanded={expanded === session.id}
            onToggle={() => setExpanded(expanded === session.id ? null : session.id)}
            onContextMenu={(event) => openMenu(event, session)}
          />
        ))}
        {view === 'active' && sessions.length > shown.length && (
          <button className={styles.more} onClick={() => setView('all')}>
            {en.panel.showAll(sessions.length)}
          </button>
        )}
      </div>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems(menu.session)}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}
