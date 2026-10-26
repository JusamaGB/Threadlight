import { useEffect, useRef, useState } from 'react'
import { NO_ATTENTION, type AttentionMotion } from '../../shared/attentionMotion'
import { createAttentionPainter } from './attentionPainter'

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
  const wheel = useRef<HTMLCanvasElement>(null),
    liquid = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (!state.active || !wheel.current || !liquid.current) return
    const painter = createAttentionPainter(wheel.current, liquid.current)
    if (!painter) return
    const preference = matchMedia('(prefers-reduced-motion: reduce)')
    let frame = 0
    const draw = () => {
      cancelAnimationFrame(frame)
      const still = painter.draw(state, Date.now() / 1000, preference.matches)
      if (!still && !document.hidden) frame = requestAnimationFrame(draw)
    }
    const wake = () => {
      cancelAnimationFrame(frame)
      if (!document.hidden) draw()
    }
    preference.addEventListener('change', wake)
    document.addEventListener('visibilitychange', wake)
    wake()
    return () => {
      cancelAnimationFrame(frame)
      preference.removeEventListener('change', wake)
      document.removeEventListener('visibilitychange', wake)
      painter.dispose()
    }
  }, [state])
  return state.active ? (
    <div
      aria-label={`${state.provider === 'codex' ? 'Codex' : 'Claude'} needs input`}
      data-attention-provider={state.provider}
      style={{ width: state.width, height: state.height, pointerEvents: 'none' }}
    >
      <canvas ref={wheel} aria-hidden style={{ position: 'absolute', width: 22, height: 22 }} />
      <canvas
        ref={liquid}
        aria-hidden
        style={{ position: 'absolute', inset: 0, width: state.width, height: state.height }}
      />
    </div>
  ) : null
}
