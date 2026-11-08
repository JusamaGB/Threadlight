const ROW_FLIP_MS = 560
const MAX_ANIMATED_ROWS = 120
const running = new WeakMap<HTMLElement, Animation[]>()

export function cancelListLayout(list: HTMLElement): void {
  running.get(list)?.forEach((animation) => animation.cancel())
  running.delete(list)
}

/** Keep the scroll surface and visible threads continuous while their columns change. */
export function animateListLayout(
  list: HTMLElement,
  update: () => void,
  order: 'sideways-first' | 'vertical-first',
): void {
  const content = list.firstElementChild as HTMLElement | null
  if (!content || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    cancelListLayout(list)
    update()
    return
  }
  const viewport = list.getBoundingClientRect()
  const before = new Map(
    [...list.querySelectorAll<HTMLElement>('[data-session-id]')].map((row) => [
      row.dataset.sessionId!,
      row.getBoundingClientRect(),
    ]),
  )
  const heightBefore = content.getBoundingClientRect().height
  // Read the displayed positions before cancelling an interrupted transition.
  cancelListLayout(list)
  update()
  const heightAfter = content.getBoundingClientRect().height
  const moves = [...list.querySelectorAll<HTMLElement>('[data-session-id]')].flatMap((row) => {
    const from = before.get(row.dataset.sessionId!)
    if (!from) return []
    const to = row.getBoundingClientRect()
    const dx = from.left - to.left
    const dy = from.top - to.top
    // Bound animation work by what crosses the viewport, not the total workspace history.
    if (
      (!dx && !dy) ||
      Math.max(from.bottom, to.bottom) <= viewport.top ||
      Math.min(from.top, to.top) >= viewport.bottom
    )
      return []
    const visible =
      (from.bottom > viewport.top && from.top < viewport.bottom) ||
      (to.bottom > viewport.top && to.top < viewport.bottom)
    return [{ row, dx, dy, visible }]
  })
  const animations: Animation[] = []
  // Animate content height, not the clamped scroll viewport. This also works in Workspace.
  if (Math.abs(heightBefore - heightAfter) > 1) {
    const held = order === 'sideways-first' ? heightBefore : heightAfter
    animations.push(
      content.animate(
        [
          { height: `${heightBefore}px`, easing: 'ease-in-out' },
          { height: `${held}px`, offset: 0.5, easing: 'ease-in-out' },
          { height: `${heightAfter}px` },
        ],
        { duration: ROW_FLIP_MS },
      ),
    )
  }
  // Preserve every visible endpoint before spending the remaining budget on passing rows.
  moves.sort((a, b) => Number(b.visible) - Number(a.visible))
  for (const { row, dx, dy } of moves.slice(0, MAX_ANIMATED_ROWS)) {
    animations.push(
      row.animate(
        [
          { transform: `translate(${dx}px, ${dy}px)`, easing: 'ease-in-out' },
          {
            transform:
              order === 'sideways-first' ? `translate(0px, ${dy}px)` : `translate(${dx}px, 0px)`,
            offset: 0.5,
            easing: 'ease-in-out',
          },
          { transform: 'translate(0px, 0px)' },
        ],
        { duration: ROW_FLIP_MS },
      ),
    )
  }
  running.set(list, animations)
}

export { ROW_FLIP_MS }
