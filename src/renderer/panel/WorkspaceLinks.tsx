import { useEffect, useRef, useState, type RefObject } from 'react'
import { WORKSPACE_GUTTER } from '../../shared/attentionMotion'
import {
  CENTRE_HALF,
  rightWireGutter,
  routeWorkspaceWires,
  type CentreMember,
} from '../../shared/workspaceWires'
import { HeaderWire } from '../motion/HeaderWire'
import { ContextMenu } from './ContextMenu'
import styles from './WorkspaceLinks.module.css'

const colours = ['#80c5b5', '#b2a1e4', '#d1b480', '#7fb9d7']
const colourOf = (key: string) =>
  colours[[...key].reduce((hash, c) => (hash * 31 + c.charCodeAt(0)) >>> 0, 0) % colours.length]!

/** Measure the actual listed rows, including expanded/nested rows and scroll offsets. */
export function WorkspaceLinks({
  card,
  enabled,
  centre = false,
  onRightGutter,
  onToggle,
  home,
  activePin,
}: {
  card: RefObject<HTMLDivElement | null>
  enabled: boolean
  /** Two columns: exclusive groups outside their provider, shared groups at the divider. */
  centre?: boolean
  onRightGutter: (width: number) => void
  onToggle: () => Promise<void>
  home?: { label: string; onSelect: () => void }
  activePin: { enabled: boolean; onToggle: () => Promise<void> }
}) {
  const host = useRef<HTMLDivElement>(null)
  const control = useRef<HTMLButtonElement>(null)
  const [saving, setSaving] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const closeMenu = () => {
    setMenu(null)
    control.current?.focus({ preventScroll: true })
  }
  useEffect(() => {
    const panel = card.current,
      overlay = host.current
    if (!panel || !overlay) return
    let frame = 0,
      held: string | null = null,
      hovered: string | null = null,
      focused: string | null = null
    let pointer: { x: number; y: number } | null = null
    let refreshHover = false
    let previousControl = ''
    let previousGutter = -1
    const gutter = (width: number) => {
      if (width === previousGutter) return
      previousGutter = width
      onRightGutter(width)
    }
    const keyOf = (target: EventTarget | null) =>
      target instanceof Element
        ? target.closest<HTMLElement>('[data-workspace-folder]')?.dataset.workspaceFolder || null
        : null
    const highlight = () => {
      const candidate =
        held ?? hovered ?? (document.activeElement?.matches(':focus-visible') ? focused : null)
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
      trace(active)
    }
    // While a wire is lit, the threads on it are marked and every other thread's text dims.
    const trace = (active: string | null) => {
      const list = panel.querySelector<HTMLElement>('[data-workspace-thread-list]')
      if (!list) return
      list.toggleAttribute('data-wire-trace', !!active)
      for (const row of list.querySelectorAll<HTMLElement>('[data-workspace-folder]'))
        row.toggleAttribute('data-wire-linked', !!active && row.dataset.workspaceFolder === active)
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
      if (!enabled || !list || !list.clientHeight) {
        gutter(0)
        return trace(null)
      }
      const top = list.getBoundingClientRect().top
      overlay.style.top = `${top - overlay.parentElement!.getBoundingClientRect().top}px`
      overlay.style.height = `${list.clientHeight}px`
      // One overlay covers both outer gutters and the divider without intercepting card clicks.
      const divider = centre
        ? list.querySelector<HTMLElement>('[data-dual-right]')?.getBoundingClientRect().left
        : undefined
      const frameLeft = overlay.parentElement!.getBoundingClientRect().left
      const cardBox = panel.getBoundingClientRect()
      const left = cardBox.left - frameLeft - WORKSPACE_GUTTER
      overlay.style.left = `${left}px`
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
            // Column membership stays stable while row transforms animate between layouts.
            side: divider !== undefined && row.closest('[data-dual-right]') ? 1 : -1,
          },
        ])
      }
      for (const members of groups.values()) members.sort((a, b) => a.y - b.y)
      const linked = [...groups].filter(([, members]) => members.length > 1)
      // A click holds the group only while its Smart Thread is still expanded.
      // Collapsing it must return control to hover, even if the button keeps focus.
      if (
        held &&
        (!linked.some(([key]) => key === held) ||
          ![...list.querySelectorAll('[data-workspace-folder]')].some(
            (row) =>
              keyOf(row) === held && row.querySelector('button[aria-expanded="true"]') !== null,
          ))
      )
        held = null
      const routes = routeWorkspaceWires(
        linked.map(([key, members]) => ({ key, members })),
        divider !== undefined,
      )
      const right = rightWireGutter(routes)
      gutter(right)
      const width =
        divider === undefined ? WORKSPACE_GUTTER : cardBox.width + WORKSPACE_GUTTER + right
      overlay.style.width = `${width}px`
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      svg.setAttribute('viewBox', `0 0 ${width} ${list.clientHeight}`)
      svg.setAttribute('width', String(width))
      svg.setAttribute('height', String(list.clientHeight))
      for (const { key, zone, path, lane, x } of routes) {
        const members = groups.get(key)!
        const group = document.createElementNS(svg.namespaceURI, 'g')
        group.setAttribute('data-wire-key', key)
        group.setAttribute('data-wire-zone', zone)
        group.setAttribute('data-members', String(members.length))
        group.setAttribute('data-lane', String(lane))
        group.setAttribute('data-rail-x', String(x))
        group.setAttribute('stroke', colourOf(key))
        const zoneLeft =
          zone === 'right'
            ? cardBox.width + WORKSPACE_GUTTER
            : zone === 'centre'
              ? divider! - frameLeft - left - CENTRE_HALF
              : 0
        group.setAttribute('transform', `translate(${zoneLeft} 0)`)
        for (const className of ['back', 'wire']) {
          const line = document.createElementNS(svg.namespaceURI, 'path')
          line.setAttribute('d', path)
          line.setAttribute('class', styles[className]!)
          group.append(line)
        }
        svg.append(group)
      }
      overlay.append(svg)
      if (refreshHover) {
        hovered = pointer ? keyOf(document.elementFromPoint(pointer.x, pointer.y)) : null
        refreshHover = false
      }
      highlight()
      // Row transforms do not resize their boxes. Follow finite layout animations through
      // their final frame so wires settle on the actual anchors even when list height is fixed.
      if (
        panel
          .getAnimations({ subtree: true })
          .some(
            (animation) =>
              animation.playState === 'running' &&
              animation.effect?.getTiming().iterations !== Infinity,
          )
      )
        frame = requestAnimationFrame(draw)
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
      attributeFilter: [
        'data-workspace-folder',
        'data-session-id',
        'style',
        'hidden',
        'aria-expanded',
      ],
    })
    const over = (event: PointerEvent) => {
      pointer = { x: event.clientX, y: event.clientY }
      hovered = keyOf(event.target)
      highlight()
    }
    const out = (event: PointerEvent) => {
      if (!(event.relatedTarget instanceof Node) || !panel.contains(event.relatedTarget))
        pointer = null
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
      // React commits the row's expanded state after this native bubbling listener.
      schedule()
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        held = hovered = focused = null
        highlight()
      }
    }
    const scroll = () => {
      refreshHover = true
      schedule()
    }
    panel.addEventListener('pointerover', over)
    panel.addEventListener('pointermove', over)
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
      panel.removeEventListener('pointermove', over)
      panel.removeEventListener('pointerout', out)
      panel.removeEventListener('focusin', focus)
      panel.removeEventListener('focusout', blur)
      panel.removeEventListener('click', click)
      document.removeEventListener('keydown', escape)
      panel.removeEventListener('scroll', scroll, true)
      window.removeEventListener('resize', schedule)
      trace(null)
      window.threadlight.setWorkspaceWireControl(null)
    }
  }, [card, enabled, centre, onRightGutter])
  const label = home?.label ?? (enabled ? 'Hide workspace wires' : 'Show workspace wires')
  return (
    <>
      <button
        ref={control}
        className={styles.toggle}
        data-wire-toggle
        data-connected={enabled}
        data-active-pinned={activePin.enabled || undefined}
        aria-label={label}
        aria-description="Right-click or press Shift+F10 to pin or unpin Active threads."
        title={label}
        aria-pressed={home ? undefined : enabled}
        disabled={saving}
        onContextMenu={(event) => {
          event.preventDefault()
          event.stopPropagation()
          setMenu({ x: event.clientX, y: event.clientY })
        }}
        onKeyDown={(event) => {
          if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
          event.preventDefault()
          event.stopPropagation()
          const box = event.currentTarget.getBoundingClientRect()
          setMenu({ x: box.left, y: box.bottom })
        }}
        onClick={async () => {
          if (home) {
            home.onSelect()
            return
          }
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
      {menu && (
        <ContextMenu
          label="Wire menu"
          x={menu.x}
          y={menu.y}
          items={[
            {
              label: activePin.enabled ? 'Unpin active threads' : 'Pin active threads',
              disabled: saving,
              onSelect: () => {
                setSaving(true)
                void activePin.onToggle().finally(() => setSaving(false))
              },
            },
          ]}
          onClose={closeMenu}
        />
      )}
      <div ref={host} className={styles.links} data-workspace-links aria-hidden />
    </>
  )
}
