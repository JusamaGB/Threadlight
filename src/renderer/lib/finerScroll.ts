/**
 * One notch of a mouse wheel scrolls about 100 px, which is a lot in a card this small. This
 * takes the wheel's steps down to a quarter, everywhere in the app. Touchpads already send
 * small, frequent steps, so they are left alone.
 */
export const WHEEL_SCALE = 0.25
/** A mouse notch arrives as a step of at least this many pixels; a touchpad's are smaller. */
const NOTCH = 50
/** What a "line" is, for a wheel that reports lines instead of pixels. */
const LINE = 40

type Axis = 'x' | 'y'
const CONTAINED = Symbol('scroll boundary')

/** Find a scroll target without crossing the browser's CSS overscroll boundaries. */
function scroller(
  start: EventTarget | null,
  axis: Axis,
  delta: number,
): HTMLElement | typeof CONTAINED | null {
  for (let node = start instanceof Element ? start : null; node; node = node.parentElement) {
    const style = getComputedStyle(node)
    const overflow = axis === 'y' ? style.overflowY : style.overflowX
    const scrollable = overflow === 'auto' || overflow === 'scroll'
    if (scrollable) {
      const [size, view, at] =
        axis === 'y'
          ? [node.scrollHeight, node.clientHeight, node.scrollTop]
          : [node.scrollWidth, node.clientWidth, node.scrollLeft]
      if (size > view + 1 && (delta < 0 ? at > 0 : at + view < size - 1)) return node as HTMLElement
    }
    const boundary = axis === 'y' ? style.overscrollBehaviorY : style.overscrollBehaviorX
    if ((scrollable || overflow === 'hidden') && (boundary === 'contain' || boundary === 'none'))
      return CONTAINED
  }
  return null
}

export function installFinerScroll(target: Window = window): () => void {
  const onWheel = (event: WheelEvent) => {
    // Zoom, a handler that took the wheel for itself, and page-sized steps are not ours.
    if (event.defaultPrevented || event.ctrlKey || event.deltaMode === 2) return
    const unit = event.deltaMode === 1 ? LINE : 1
    const dx = event.deltaX * unit
    const dy = event.deltaY * unit
    if (Math.max(Math.abs(dx), Math.abs(dy)) < NOTCH) return
    const vertical = dy ? scroller(event.target, 'y', dy) : null
    const horizontal = dx ? scroller(event.target, 'x', dx) : null
    if (!vertical && !horizontal) return
    event.preventDefault()
    if (vertical !== CONTAINED) vertical?.scrollBy({ top: dy * WHEEL_SCALE, behavior: 'instant' })
    if (horizontal !== CONTAINED)
      horizontal?.scrollBy({ left: dx * WHEEL_SCALE, behavior: 'instant' })
  }
  target.addEventListener('wheel', onWheel, { passive: false })
  return () => target.removeEventListener('wheel', onWheel)
}
