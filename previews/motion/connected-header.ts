import { advancePose, MotionGeometry, restingPose } from '../../src/renderer/motion/geometry'
import { createCanvasRenderer, createWebGLRenderer } from '../../src/renderer/motion/render'
import { SILENT_AUDIO, type MotionMode } from '../../src/shared/motion'

const host = document.querySelector<HTMLDivElement>('.motion')!
let canvas = host.querySelector('canvas')!
let renderer = createWebGLRenderer(canvas)
if (!renderer) {
  canvas.remove()
  canvas = document.createElement('canvas')
  canvas.setAttribute('aria-hidden', 'true')
  host.append(canvas)
  renderer = createCanvasRenderer(canvas)
}
if (!renderer) throw new Error('No graphics renderer available')
host.dataset.renderer = renderer.kind
const geometry = new MotionGeometry()
const pose = { ...restingPose(), wheel: 1, warmth: 1, rest: 0 }
const transition = document.querySelector<HTMLInputElement>('#transition')!
const energy = document.querySelector<HTMLInputElement>('#energy')!
const reduced = document.querySelector<HTMLInputElement>('#reduced')!
const pause = document.querySelector<HTMLButtonElement>('#pause')!
const status = document.querySelector<HTMLElement>('.status')!
const preference = matchMedia('(prefers-reduced-motion: reduce)')
reduced.checked = preference.matches
let mode: MotionMode = 'thinking'
let playing = true,
  time = 2,
  previous = 0

function audio() {
  const level = Number(energy.value)
  return { level, low: level * 0.9, mid: level * 0.65, high: level * 0.3 }
}
function paint() {
  const bounds = host.getBoundingClientRect()
  const scale = Math.min(2, devicePixelRatio || 1)
  const width = Math.round(bounds.width * scale),
    height = Math.round(bounds.height * scale)
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width
    canvas.height = height
  }
  const vertices = geometry.build(
    bounds.width,
    bounds.height,
    time,
    pose,
    reduced.checked,
    true,
    mode === 'thinking' || mode === 'transcribing',
  )
  renderer!.draw(vertices, bounds.width, bounds.height, scale)
  transition.value = String(1 - pose.wheel)
}
function setMode(next: MotionMode) {
  mode = next
  playing = true
  pause.textContent = 'Pause'
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-mode]'))
    button.setAttribute('aria-pressed', String(button.dataset.mode === next))
  status.textContent =
    next === 'thinking'
      ? 'Thinking - No active Mic'
      : next === 'idle'
        ? 'Ready - No active Mic'
        : 'You speaking'
}
function seek(progress: number, at = time) {
  playing = false
  pause.textContent = 'Play'
  time = at
  pose.wheel = 1 - progress
  pose.warmth = 1 - progress
  pose.rest = 0
  pose.input = audio()
  status.textContent =
    progress === 0
      ? 'Thinking - No active Mic'
      : progress === 1
        ? 'You speaking'
        : 'Opening into the waveform'
  paint()
}
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-mode]'))
  button.onclick = () => setMode(button.dataset.mode as MotionMode)
transition.oninput = () => seek(Number(transition.value))
energy.oninput = () => {
  if (!playing) seek(1 - pose.wheel)
}
pause.onclick = () => {
  playing = !playing
  pause.textContent = playing ? 'Pause' : 'Play'
}
reduced.onchange = paint
preference.onchange = () => {
  reduced.checked = preference.matches
  paint()
}
new ResizeObserver(paint).observe(host)
document.addEventListener('visibilitychange', () => (previous = 0))
function tick(now: number) {
  const elapsed = previous ? Math.min(100, now - previous) : 16
  previous = now
  if (!document.hidden && playing) {
    const input = mode === 'listening' ? audio() : SILENT_AUDIO
    advancePose(pose, { mode, input, output: SILENT_AUDIO }, elapsed, true)
    if (!reduced.checked) time += elapsed / 1000
    paint()
  }
  requestAnimationFrame(tick)
}
requestAnimationFrame(tick)
Object.assign(window, { headerMotionPreview: { seek, setMode } })
window.addEventListener('pagehide', () => renderer?.dispose())
