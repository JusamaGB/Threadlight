import { useEffect, useRef, useState, type RefObject } from 'react'
import { WORKSPACE_GUTTER } from '../../shared/attentionMotion'
import {
  CENTRE_HALF,
  centreWirePath,
  layoutWorkspaceWires,
  type CentreMember,
} from '../../shared/workspaceWires'
import { HeaderWire } from '../motion/HeaderWire'
import styles from './WorkspaceLinks.module.css'

const colours = ['#80c5b5', '#b2a1e4', '#d1b480', '#7fb9d7']
const colourOf = (key: string) =>
  colours[[...key].reduce((hash, c) => (hash * 31 + c.charCodeAt(0)) >>> 0, 0) % colours.length]!

/** Measure the actual listed rows, including expanded/nested rows and scroll offsets. */
export function WorkspaceLinks({
  card,
  enabled,
  centre = false,
  onToggle,
}: {
  card: RefObject<HTMLDivElement | null>
  enabled: boolean
  /** Threads sit in two columns: the rail runs down the divider between them. */
  centre?: boolean
  onToggle: () => Promise<void>
}) {
  const host = useRef<HTMLDivElement>(null)
  const control = useRef<HTMLButtonElement>(null)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    const panel = card.current,
      overlay = host.current
    if (!panel || !overlay) return
    let frame = 0,
      held: string | null = null,
      hovered: string | null = null,
      focused: string | null = null
    let previousControl = ''
    const keyOf = (target: EventTarget | null) =>
      target instanceof Element
        ? target.closest<HTMLElement>('[data-workspace-folder]')?.dataset.workspaceFolder || null
        : null
    const highlight = () => {
      const candidate = held ?? hovered ?? focused
      const active = [...overlay.querySelectorAll<SVGGElement>('[data-wire-key]')].some(
        (wire) => wire.dataset.wireKey === candidate,
      )
        ? candidate
        : null
      overlay.toggleAttribute('data-tracing', !!active)
      for (const wire of overlay.querySelectorAll<SVGGElement>('[data-wire-key]'))
        wire.toggleAttribute('data-highlight', wire.dataset.wireKey === active)
      const selected = [...overlay.querySelectorAll<SVGGElement>('[data-wire-key]')].find(
        (wire) => wire.dataset.wireKey === active,
      )
      if (selected) selected.parentElement?.append(selected)
    }
    const draw = () => {
      const header = panel.querySelector('header')
      if (header && control.current) {
        const box = header.getBoundingClientRect()
        control.current.style.top = `${box.top - overlay.parentElement!.getBoundingClientRect().top}px`
        const bounds = { top: box.top, height: header.clientHeight }
        const key = JSON.stringify(bounds)
        if (previousControl !== key) {
          previousControl = key
          window.threadlight.setWorkspaceWireControl(bounds)
        }
      }
      const list = panel.querySelector<HTMLElement>('[data-workspace-thread-list]')
      overlay.replaceChildren()
      if (!enabled || !list || !list.clientHeight) return
      const top = list.getBoundingClientRect().top
      overlay.style.top = `${top - overlay.parentElement!.getBoundingClientRect().top}px`
      overlay.style.height = `${list.clientHeight}px`
      // Beside two columns the overlay is a strip over the divider; otherwise the card's gutter.
      const divider = centre
        ? list.querySelector<HTMLElement>('[data-dual-right]')?.getBoundingClientRect().left
        : undefined
      const width = divider === undefined ? WORKSPACE_GUTTER : CENTRE_HALF * 2
      overlay.style.left =
        divider === undefined
          ? ''
          : `${divider - CENTRE_HALF - overlay.parentElement!.getBoundingClientRect().left}px`
      overlay.style.width = `${width}px`
      // Over the card, not beside it: the divider is inside the card's own background.
      overlay.style.zIndex = divider === undefined ? '' : '1'
      const groups = new Map<string, CentreMember[]>()
      for (const row of list.querySelectorAll<HTMLElement>('[data-workspace-folder]')) {
        const key = row.dataset.workspaceFolder
        if (!key) continue
        const anchor = row.querySelector<HTMLElement>('[data-workspace-anchor]')
        if (!anchor) continue
        const box = anchor.getBoundingClientRect()
        groups.set(key, [
          ...(groups.get(key) ?? []),
          {
            y: box.top + box.height / 2 - top,
            side: divider !== undefined && box.left > divider ? 1 : -1,
          },
        ])
      }
      for (const members of groups.values()) members.sort((a, b) => a.y - b.y)
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      svg.setAttribute('viewBox', `0 0 ${width} ${list.clientHeight}`)
      svg.setAttribute('width', String(width))
      svg.setAttribute('height', String(list.clientHeight))
      const linked = [...groups].filter(([, members]) => members.length > 1)
      const routes = layoutWorkspaceWires(
        linked.map(([key, members]) => ({ key, first: members[0]!.y, last: members.at(-1)!.y })),
      )
      if (held && !linked.some(([key]) => key === held)) held = null
      for (const { key, first, last, lane, x } of routes) {
        const members = groups.get(key)!
        let path: string
        if (divider === undefined) {
          const r = Math.min(3, WORKSPACE_GUTTER - x, (last - first) / 2)
          path = `M 16 ${first} H ${x + r} Q ${x} ${first} ${x} ${first + r} V ${last - r} Q ${x} ${last} ${x + r} ${last} H 16`
          for (const { y } of members.slice(1, -1)) path += ` M ${x} ${y} H 16`
        } else {
          path = centreWirePath(members, lane).path
        }
        const group = document.createElementNS(svg.namespaceURI, 'g')
        group.setAttribute('data-wire-key', key)
        group.setAttribute('data-members', String(members.length))
        group.setAttribute('data-lane', String(lane))
        group.setAttribute('data-rail-x', String(x))
        group.setAttribute('stroke', colourOf(key))
        for (const className of ['back', 'wire']) {
          const line = document.createElementNS(svg.namespaceURI, 'path')
          line.setAttribute('d', path)
          line.setAttribute('class', styles[className]!)
          group.append(line)
        }
        svg.append(group)
      }
      overlay.append(svg)
      highlight()
    }
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(draw)
    }
    const resize = new ResizeObserver(schedule)
    const observe = () => {
      resize.disconnect()
      resize.observe(panel)
      for (const element of panel.querySelectorAll(
        '[data-workspace-thread-list], [data-session-id]',
      ))
        resize.observe(element)
      schedule()
    }
    const mutation = new MutationObserver(observe)
    mutation.observe(panel, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-workspace-folder', 'data-session-id', 'style', 'hidden'],
    })
    const over = (event: PointerEvent) => {
      hovered = keyOf(event.target)
      highlight()
    }
    const out = (event: PointerEvent) => {
      hovered = keyOf(event.relatedTarget)
      highlight()
    }
    const focus = (event: FocusEvent) => {
      focused = keyOf(event.target)
      highlight()
    }
    const blur = (event: FocusEvent) => {
      focused = keyOf(event.relatedTarget)
      highlight()
    }
    const click = (event: MouseEvent) => {
      held = keyOf(event.target)
      highlight()
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        held = hovered = focused = null
        highlight()
      }
    }
    const scroll = () => {
      hovered = null
      schedule()
    }
    panel.addEventListener('pointerover', over)
    panel.addEventListener('pointerout', out)
    panel.addEventListener('focusin', focus)
    panel.addEventListener('focusout', blur)
    panel.addEventListener('click', click)
    document.addEventListener('keydown', escape)
    panel.addEventListener('scroll', scroll, true)
    window.addEventListener('resize', schedule)
    observe()
    return () => {
      cancelAnimationFrame(frame)
      resize.disconnect()
      mutation.disconnect()
      panel.removeEventListener('pointerover', over)
      panel.removeEventListener('pointerout', out)
      panel.removeEventListener('focusin', focus)
      panel.removeEventListener('focusout', blur)
      panel.removeEventListener('click', click)
      document.removeEventListener('keydown', escape)
      panel.removeEventListener('scroll', scroll, true)
      window.removeEventListener('resize', schedule)
      window.threadlight.setWorkspaceWireControl(null)
    }
  }, [card, enabled, centre])
  const label = enabled ? 'Hide workspace wires' : 'Show workspace wires'
  return (
    <>
      <button
        ref={control}
        className={styles.toggle}
        data-wire-toggle
        data-connected={enabled}
        aria-label={label}
        title={label}
        aria-pressed={enabled}
        disabled={saving}
        onClick={async () => {
          setSaving(true)
          try {
            await onToggle()
          } finally {
            setSaving(false)
          }
        }}
      >
        <HeaderWire connected={enabled} />
      </button>
      <div ref={host} className={styles.links} data-workspace-links aria-hidden />
    </>
  )
}
