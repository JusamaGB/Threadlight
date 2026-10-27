import { useLayoutEffect, useRef } from 'react'
import { useHelpMode } from './helpMode'
import styles from './Panel.module.css'

/** Keep the bars' layout stable between hint owners, including while a hint leaves. */
export function HoverFooter() {
  const frame = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const ghost = useRef<HTMLDivElement>(null)
  const mode = useHelpMode()
  useLayoutEffect(() => {
    const outer = frame.current!,
      live = content.current!,
      outgoing = ghost.current!
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    let signature = ''
    let snapshot: HTMLElement | null = null
    let animations: Animation[] = []
    let generation = 0
    const cancel = () => {
      for (const animation of animations) animation.cancel()
      animations = []
    }
    const sync = () => {
      const next = live.firstElementChild as HTMLElement | null
      const text = next?.textContent ?? ''
      outer.style.height = `${mode === 'off' ? 0 : live.getBoundingClientRect().height}px`
      if (text === signature && mode !== 'off' && !reduced.matches) return
      signature = text
      const previous = outgoing.firstElementChild?.cloneNode(true) ?? snapshot
      const opacity = outgoing.firstElementChild ? Number(getComputedStyle(outgoing).opacity) : 1
      cancel()
      outgoing.replaceChildren()
      const turn = ++generation
      if (mode !== 'off' && !reduced.matches) {
        if (previous) {
          outgoing.append(previous)
          const exit = outgoing.animate([{ opacity }, { opacity: 0 }], {
            duration: 65,
            fill: 'both',
          })
          animations.push(exit)
          void exit.finished
            .then(() => {
              if (generation === turn) outgoing.replaceChildren()
            })
            .catch(() => {})
        }
        if (next)
          animations.push(
            next.animate([{ opacity: 0 }, { opacity: 1 }], {
              duration: 110,
              delay: previous ? 65 : 0,
              fill: 'both',
            }),
          )
      }
      snapshot = next ? (next.cloneNode(true) as HTMLElement) : null
      // The outgoing copy is visual only; the current owner remains the sole interactive tooltip.
      if (snapshot) {
        snapshot.removeAttribute('role')
        snapshot.removeAttribute('tabindex')
        snapshot.querySelectorAll('[role], [tabindex]').forEach((e) => {
          e.removeAttribute('role')
          e.removeAttribute('tabindex')
        })
      }
    }
    const changes = new MutationObserver(sync)
    changes.observe(live, { childList: true, characterData: true, subtree: true })
    const sizes = new ResizeObserver(sync)
    sizes.observe(live)
    reduced.addEventListener('change', sync)
    sync()
    return () => {
      changes.disconnect()
      sizes.disconnect()
      reduced.removeEventListener('change', sync)
      generation++
      cancel()
      outgoing.replaceChildren()
    }
  }, [mode])
  return (
    <div
      ref={frame}
      className={styles.hoverMessage}
      data-hover-footer=""
      data-help-off={mode === 'off' || undefined}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <div ref={content} className={styles.hoverMessageContent} data-hover-message="" />
      <div ref={ghost} className={styles.hoverMessageGhost} aria-hidden="true" inert />
    </div>
  )
}
