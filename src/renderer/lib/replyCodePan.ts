/** Install once for all reply cards, including code that streams into a conversation later. */
export function installReplyCodePan() {
  const listeners = new AbortController()
  const options = { signal: listeners.signal }
  const native = window.threadlight.nativeCodePan === true
  let drag: { file: HTMLElement; id: number; token: string; x: number; y: number } | undefined

  function release() {
    if (!drag) return
    const { file, id, token } = drag
    drag = undefined
    file.removeAttribute('data-code-panning')
    if (file.hasPointerCapture(id)) file.releasePointerCapture(id)
    if (native) window.threadlight.codePan(token, false)
  }
  function control(held: boolean) {
    document.documentElement.toggleAttribute('data-code-grab', held)
    if (!held) release()
  }
  const modifier = (event: MouseEvent | KeyboardEvent) =>
    event.ctrlKey && !event.altKey && !event.metaKey
  const key = (event: KeyboardEvent) => {
    if (event.key === 'Escape') release()
    control(modifier(event))
  }
  window.addEventListener('keydown', key, options)
  window.addEventListener('keyup', key, options)
  window.addEventListener('blur', () => control(false), options)
  // A hover-opened panel can be unfocused and receive no keyboard events.
  const unsubscribe = window.threadlight.onPanelControlHeld(control)
  const unsubscribeMotion = native
    ? window.threadlight.onCodePanMotion(({ id, dx, dy, end }) => {
        if (!drag || id !== drag.token) return
        if (end || !drag.file.isConnected) return release()
        drag.file.scrollBy({ left: dx, top: dy, behavior: 'instant' })
      })
    : undefined
  window.addEventListener(
    'pointerdown',
    (event) => {
      if (event.button !== 0 || event.pointerType !== 'mouse' || !modifier(event) || drag) return
      const file =
        event.target instanceof Element && event.target.closest<HTMLElement>('pre[data-reply-code]')
      if (!file) return
      event.preventDefault()
      control(true)
      file.setPointerCapture(event.pointerId)
      file.setAttribute('data-code-panning', '')
      drag = {
        file,
        id: event.pointerId,
        token: crypto.randomUUID(),
        x: event.clientX,
        y: event.clientY,
      }
      if (native) window.threadlight.codePan(drag.token, true)
    },
    options,
  )
  window.addEventListener(
    'pointermove',
    (event) => {
      if (event.pointerType !== 'mouse') return
      if (native && drag) return
      control(modifier(event))
      if (!drag || drag.id !== event.pointerId) return
      if (!(event.buttons & 1)) return release()
      drag.file.scrollBy({
        left: drag.x - event.clientX,
        top: drag.y - event.clientY,
        behavior: 'instant',
      })
      drag.x = event.clientX
      drag.y = event.clientY
    },
    options,
  )
  const end = (event: PointerEvent) => {
    if (drag?.id === event.pointerId) release()
  }
  window.addEventListener('pointerup', end, options)
  window.addEventListener('pointercancel', end, options)
  if (!native) window.addEventListener('lostpointercapture', end, options)
  return () => {
    unsubscribe()
    unsubscribeMotion?.()
    listeners.abort()
    control(false)
  }
}
