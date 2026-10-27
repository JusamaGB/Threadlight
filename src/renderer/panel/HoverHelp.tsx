import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { HelpModeContext, type HelpMode } from './helpMode'
import { hasDockedHover, HoverInfo, type HoverPoint } from './HoverInfo'
import styles from './Panel.module.css'

/** One policy for custom hints and legacy native titles throughout the panel and its portals. */
export function HoverHelp({ mode, children }: { mode: HelpMode; children: ReactNode }) {
  return (
    <HelpModeContext.Provider value={mode}>
      {children}
      <NativeHints key={mode} mode={mode} />
    </HelpModeContext.Provider>
  )
}

function NativeHints({ mode }: { mode: HelpMode }) {
  const anchor = useRef<HTMLElement | null>(null)
  const [hint, setHint] = useState<{ text: string; point: HoverPoint; help: boolean } | null>(null)
  const lastPointer = useRef<HoverPoint | null>(null)
  useLayoutEffect(() => {
    if (mode === 'info') return
    const titles = new Map<HTMLElement, string>()
    const suppress = (element: HTMLElement) => {
      const title = element.getAttribute('title')
      if (!title) return
      titles.set(element, title)
      element.setAttribute('title', '')
    }
    const scan = (element: Element) => {
      if (element instanceof HTMLElement) suppress(element)
      element.querySelectorAll<HTMLElement>('[title]').forEach(suppress)
    }
    scan(document.body)
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'attributes' && record.target instanceof HTMLElement)
          suppress(record.target)
        else for (const node of record.addedNodes) if (node instanceof Element) scan(node)
      }
    })
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['title'],
    })
    const clear = () => {
      anchor.current?.removeAttribute('data-native-help-anchor')
      anchor.current?.removeAttribute('data-tip-anchor')
      anchor.current = null
      setHint(null)
    }
    const track = (event: MouseEvent) => {
      if (mode !== 'tour' || !(event.target instanceof Element)) return
      if (event.target.closest('[role="tooltip"]')) return
      if (
        hasDockedHover(anchor.current) &&
        lastPointer.current?.screenX === event.screenX &&
        lastPointer.current?.screenY === event.screenY
      )
        return
      let target: HTMLElement | null = null
      for (let element: Element | null = event.target; element; element = element.parentElement) {
        if (
          element.hasAttribute('data-tip-anchor') &&
          !element.hasAttribute('data-native-help-anchor')
        )
          break
        if (element instanceof HTMLElement && (titles.has(element) || element.dataset.tourHelp)) {
          target = element
          break
        }
        if (element.hasAttribute('data-tip-anchor')) break
      }
      if (!target) {
        clear()
        return
      }
      if (anchor.current !== target) {
        anchor.current?.removeAttribute('data-native-help-anchor')
        anchor.current?.removeAttribute('data-tip-anchor')
      }
      anchor.current = target
      target.setAttribute('data-native-help-anchor', '')
      target.setAttribute('data-tip-anchor', '')
      const at = target.getBoundingClientRect()
      const point = {
        x: event.clientX - at.left,
        y: event.clientY - at.top,
        screenX: event.screenX,
        screenY: event.screenY,
      }
      lastPointer.current = point
      setHint({
        text: titles.get(target) ?? target.dataset.tourHelp!,
        point,
        help: !titles.has(target),
      })
    }
    const click = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('[role="tooltip"]')) clear()
    }
    document.addEventListener('mouseover', track, true)
    document.addEventListener('mousemove', track, true)
    document.addEventListener('mousedown', click, true)
    document.addEventListener('mouseleave', clear)
    return () => {
      observer.disconnect()
      document.removeEventListener('mouseover', track, true)
      document.removeEventListener('mousemove', track, true)
      document.removeEventListener('mousedown', click, true)
      document.removeEventListener('mouseleave', clear)
      anchor.current?.removeAttribute('data-native-help-anchor')
      anchor.current?.removeAttribute('data-tip-anchor')
      for (const [element, title] of titles)
        if (element.getAttribute('title') === '') element.setAttribute('title', title)
    }
  }, [mode])
  return mode === 'tour' && hint ? (
    <HoverInfo anchor={anchor} point={hint.point} onDismiss={() => setHint(null)}>
      <span className={hint.help ? styles.tipHelp : undefined}>{hint.text}</span>
    </HoverInfo>
  ) : null
}
