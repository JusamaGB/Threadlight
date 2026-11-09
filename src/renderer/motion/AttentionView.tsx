import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { NO_ATTENTION, type AttentionMotion } from '../../shared/attentionMotion'
import { DOT_SIZE } from '../../shared/micIndicator'
import { createAttentionPainter } from './attentionPainter'
import { createPillFire } from './pillFire'

export function useAttentionMotion(): AttentionMotion {
  const [state, setState] = useState(NO_ATTENTION)
  useEffect(() => {
    let live = true,
      updated = false
    const off = window.threadlight.onAttentionMotion((next) => {
      updated = true
      setState(next)
    })
    void window.threadlight
      .getAttentionMotion()
      .then((next) => {
        if (live && !updated && next) setState(next)
      })
      .catch(() => {})
    return () => {
      live = false
      off()
    }
  }, [])
  return state
}

/** A non-interactive, transparent native window. The original dot retains hover/click handling. */
export function AttentionView() {
  const state = useAttentionMotion()
  return state.pill ? <PillFire state={state} /> : <AttentionDrips state={state} />
}

function PillFire({ state }: { state: AttentionMotion }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const current = useRef(state)
  const repaint = useRef<() => void>(undefined)
  useLayoutEffect(() => {
    current.current = state
    repaint.current?.()
  }, [state])
  useLayoutEffect(() => {
    if (!canvas.current) return
    const paint = createPillFire(canvas.current)
    if (!paint) return
    const preference = matchMedia('(prefers-reduced-motion: reduce)')
    let frame = 0,
      last = performance.now()
    const draw = (now: number) => {
      if (document.hidden) return
      const elapsed = now - last
      if (elapsed >= 30 || preference.matches) {
        paint(current.current, Math.min(0.08, elapsed / 1000), preference.matches)
        last = now
      }
      if (!preference.matches) frame = requestAnimationFrame(draw)
    }
    const wake = () => {
      cancelAnimationFrame(frame)
      draw(performance.now())
    }
    repaint.current = wake
    wake()
    preference.addEventListener('change', wake)
    document.addEventListener('visibilitychange', wake)
    return () => {
      cancelAnimationFrame(frame)
      repaint.current = undefined
      preference.removeEventListener('change', wake)
      document.removeEventListener('visibilitychange', wake)
    }
  }, [])
  return (
    <canvas
      ref={canvas}
      aria-hidden
      data-pill-fire
      style={{ display: 'block', width: state.width, height: state.height, pointerEvents: 'none' }}
    />
  )
}

function AttentionDrips({ state }: { state: AttentionMotion }) {
  const wheel = useRef<HTMLCanvasElement>(null),
    liquid = useRef<HTMLCanvasElement>(null)
  // The painter reads the latest state each frame, so a changing list of waiting threads never
  // restarts it and the drops already falling carry on.
  const latest = useRef(state)
  const redraw = useRef<(() => void) | null>(null)
  useLayoutEffect(() => {
    latest.current = state
    // A still frame stops the loop, so a new state has to restart it.
    redraw.current?.()
  }, [state])
  useLayoutEffect(() => {
    if (!state.active || !wheel.current || !liquid.current) return
    const painter = createAttentionPainter(wheel.current, liquid.current)
    if (!painter) return
    const preference = matchMedia('(prefers-reduced-motion: reduce)')
    let frame = 0
    const draw = () => {
      cancelAnimationFrame(frame)
      const still = painter.draw(latest.current, Date.now() / 1000, preference.matches)
      if (!still && !document.hidden) frame = requestAnimationFrame(draw)
    }
    const wake = () => {
      cancelAnimationFrame(frame)
      if (!document.hidden) draw()
    }
    preference.addEventListener('change', wake)
    document.addEventListener('visibilitychange', wake)
    // Prime even a hidden native window, then animate only while it is visible.
    redraw.current = draw
    draw()
    return () => {
      redraw.current = null
      cancelAnimationFrame(frame)
      preference.removeEventListener('change', wake)
      document.removeEventListener('visibilitychange', wake)
      painter.dispose()
    }
  }, [state.active])
  // Native visibility controls presentation. Retain the last painted frame while
  // inactive so showing the window never exposes newly mounted, empty canvases.
  return (
    <div
      aria-label={
        state.providers.length > 1
          ? `${state.providers.length} threads need input`
          : `${state.provider === 'codex' ? 'Codex' : 'Claude'} needs input`
      }
      aria-hidden={!state.active}
      data-attention-provider={state.provider}
      style={{ width: state.width, height: state.height, pointerEvents: 'none' }}
    >
      <canvas
        ref={wheel}
        aria-hidden
        style={{ position: 'absolute', width: DOT_SIZE, height: DOT_SIZE }}
      />
      <canvas
        ref={liquid}
        aria-hidden
        style={{ position: 'absolute', inset: 0, width: state.width, height: state.height }}
      />
    </div>
  )
}
