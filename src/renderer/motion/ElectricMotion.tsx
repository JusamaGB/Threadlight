import { useEffect, useRef, type RefObject } from 'react'
import { IDLE_MOTION, type MotionSnapshot } from '../../shared/motion'
import { advancePose, MotionGeometry, restingPose } from './geometry'
import { createCanvasRenderer, createWebGLRenderer } from './render'
import styles from './Motion.module.css'

interface Props {
  snapshot?: MotionSnapshot
  source?: RefObject<MotionSnapshot>
  label: string
  className?: string
  edgeToEdge?: boolean
}

/** The canvas owns only presentation. Capture, playback and state transitions stay outside it. */
export function ElectricMotion({
  snapshot = IDLE_MOTION,
  source,
  label,
  className = '',
  edgeToEdge = false,
}: Props) {
  const host = useRef<HTMLSpanElement>(null)
  const latest = useRef(snapshot)
  useEffect(() => {
    latest.current = snapshot
  }, [snapshot])
  useEffect(() => {
    const element = host.current
    if (!element) return
    const motion = matchMedia('(prefers-reduced-motion: reduce)')
    const geometry = new MotionGeometry()
    const pose = restingPose()
    let canvas = document.createElement('canvas')
    canvas.setAttribute('aria-hidden', 'true')
    element.replaceChildren(canvas)
    let renderer = createWebGLRenderer(canvas)
    // A canvas already bound to WebGL cannot acquire a 2D context, even after failure.
    const fallback = () => {
      renderer?.dispose()
      canvas.removeEventListener('webglcontextlost', lost)
      canvas = document.createElement('canvas')
      canvas.setAttribute('aria-hidden', 'true')
      element.replaceChildren(canvas)
      renderer = createCanvasRenderer(canvas)
      element.dataset.renderer = renderer?.kind ?? 'unavailable'
      resize()
    }
    let width = 0,
      height = 0,
      scale = 1,
      frame = 0,
      timer = 0,
      previous = 0,
      clock = 0
    let inView = true,
      disposed = false
    let settled = 0
    let lastTelemetry = ''
    let needsPaint = true
    const stop = () => {
      cancelAnimationFrame(frame)
      clearTimeout(timer)
      frame = 0
      timer = 0
    }
    const wake = () => {
      stop()
      previous = 0
      settled = 0
      needsPaint = true
      // Repaint before presentation when a hidden native window becomes visible again.
      if (!disposed && !document.hidden && inView) draw(performance.now())
    }
    const resize = () => {
      const bounds = element.getBoundingClientRect()
      width = bounds.width
      height = bounds.height
      scale = Math.min(2, window.devicePixelRatio || 1)
      needsPaint = true
      const pixelWidth = Math.max(1, Math.round(width * scale))
      const pixelHeight = Math.max(1, Math.round(height * scale))
      if (canvas.width !== pixelWidth) canvas.width = pixelWidth
      if (canvas.height !== pixelHeight) canvas.height = pixelHeight
      wake()
    }
    const draw = (now: number) => {
      if (disposed || document.hidden || !inView) return
      const delta = previous ? Math.min(100, now - previous) : 16
      previous = now
      const value = source?.current ?? latest.current
      const telemetry = JSON.stringify(value)
      settled = telemetry === lastTelemetry ? settled + delta : 0
      lastTelemetry = telemetry
      advancePose(pose, value, delta, edgeToEdge)
      const quiet = pose.input.level < 0.008 && pose.output.level < 0.008
      const staticMode = value.mode === 'idle' || value.mode === 'waiting' || value.mode === 'error'
      // The quiet header keeps a slow colour drift. Waiting/error indicators and
      // reduced motion remain still; other surfaces retain their resting policy.
      const still =
        motion.matches ||
        (quiet && staticMode && !pose.headerOpening && (!edgeToEdge || value.mode !== 'idle'))
      if (!still) clock += delta / 1000
      const resting = still && settled > 1200
      if (width > 0 && height > 0 && renderer && (!resting || needsPaint)) {
        const vertices = geometry.build(
          width,
          height,
          clock,
          pose,
          motion.matches,
          edgeToEdge,
          value.mode === 'thinking' || value.mode === 'transcribing',
        )
        renderer.draw(vertices, width, height, scale)
        needsPaint = false
      }
      // Poll only telemetry while at rest. Hidden/offscreen surfaces have no scheduled work.
      const delay =
        resting || motion.matches || renderer?.kind === 'canvas' ? 50 : edgeToEdge && quiet ? 33 : 0
      if (delay)
        timer = window.setTimeout(() => {
          frame = requestAnimationFrame(draw)
        }, delay)
      else frame = requestAnimationFrame(draw)
    }
    function lost(event: Event) {
      event.preventDefault()
      fallback()
    }
    if (!renderer) fallback()
    element.dataset.renderer = renderer?.kind ?? 'unavailable'
    canvas.addEventListener('webglcontextlost', lost)
    const observer = new ResizeObserver(resize)
    observer.observe(element)
    const visibility = new IntersectionObserver(([entry]) => {
      inView = entry?.isIntersecting ?? false
      wake()
    })
    visibility.observe(element)
    document.addEventListener('visibilitychange', wake)
    motion.addEventListener('change', wake)
    resize()
    return () => {
      disposed = true
      stop()
      observer.disconnect()
      visibility.disconnect()
      document.removeEventListener('visibilitychange', wake)
      motion.removeEventListener('change', wake)
      canvas.removeEventListener('webglcontextlost', lost)
      renderer?.dispose()
      element.replaceChildren()
    }
  }, [source, edgeToEdge])

  return (
    <span
      ref={host}
      className={`${styles.surface} ${className}`}
      role="img"
      aria-label={label}
      data-edge-to-edge={edgeToEdge || undefined}
    />
  )
}
