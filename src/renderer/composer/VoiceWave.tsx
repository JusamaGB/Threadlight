import { useEffect, useRef } from 'react'
import { en } from '../i18n/en'
import styles from './Composer.module.css'

const HEIGHT = 20
const PITCH = 5
const SAMPLE_MS = 50

/** A short, scrolling history of real mic levels, interpolated between the recorder's samples. */
export function VoiceWave({ level }: { level: number }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const latest = useRef(level)
  useEffect(() => {
    latest.current = level
  }, [level])

  useEffect(() => {
    const element = canvas.current
    const context = element?.getContext('2d')
    if (!element || !context) return
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let width = 0,
      scale = 1,
      frame = 0,
      previous = 0,
      elapsed = 0,
      smoothed = 0
    const samples: number[] = []
    const colour = getComputedStyle(element).color
    const resize = () => {
      width = element.getBoundingClientRect().width
      scale = window.devicePixelRatio || 1
      element.width = Math.max(1, Math.round(width * scale))
      element.height = Math.round(HEIGHT * scale)
    }
    const observer = new ResizeObserver(resize)
    observer.observe(element)
    resize()
    const draw = (time: number) => {
      // Hidden windows can suspend animation frames; don't invent a backlog of audio on return.
      const delta = previous ? Math.min(100, time - previous) : 0
      previous = time
      const target = Number.isFinite(latest.current) ? Math.min(1, Math.max(0, latest.current)) : 0
      smoothed += (target - smoothed) * (1 - Math.exp(-delta / 65))
      elapsed += delta
      const count = Math.ceil(width / PITCH) + 2
      while (elapsed >= SAMPLE_MS) {
        samples.push(smoothed)
        elapsed -= SAMPLE_MS
      }
      if (samples.length > count) samples.splice(0, samples.length - count)
      context.setTransform(scale, 0, 0, scale, 0, 0)
      context.clearRect(0, 0, width, HEIGHT)
      context.fillStyle = colour
      const offset = motion.matches ? 0 : (elapsed / SAMPLE_MS) * PITCH
      for (let i = 0; i < count; i++) {
        const amplitude = motion.matches ? smoothed : (samples[samples.length - 1 - i] ?? 0)
        // Gentle compression keeps quiet speech visible without changing the recorded audio.
        const height = 2 + Math.sqrt(amplitude) * (HEIGHT - 2)
        const x = width - 2 - i * PITCH - offset
        context.globalAlpha = 0.35 + Math.sqrt(amplitude) * 0.65
        context.beginPath()
        context.roundRect(x, (HEIGHT - height) / 2, 2, height, 1)
        context.fill()
      }
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [])

  return <canvas ref={canvas} className={styles.wave} role="img" aria-label={en.voice.listening} />
}
