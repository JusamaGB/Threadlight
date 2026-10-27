import { MotionGeometry, restingPose } from '../../src/renderer/motion/geometry'
import { createWebGLRenderer, createCanvasRenderer } from '../../src/renderer/motion/render'
import { IdleLight, IDLE_PERIOD } from './idle-light'
const surfaces = ['before', 'after', 'beforeDot', 'afterDot'].map((id) => {
  let canvas = document.getElementById(id) as HTMLCanvasElement
  let renderer = createWebGLRenderer(canvas)
  if (!renderer) {
    const next = canvas.cloneNode() as HTMLCanvasElement
    canvas.replaceWith(next)
    canvas = next
    renderer = createCanvasRenderer(canvas)
  }
  if (!renderer) throw new Error('Graphics unavailable')
  return {
    canvas,
    renderer,
    idle: id.startsWith('after') ? new IdleLight() : null,
    wave: new MotionGeometry(),
  }
})
const pose = restingPose()
const pause = document.querySelector<HTMLButtonElement>('#pause')!,
  reduced = document.querySelector<HTMLInputElement>('#reduced')!,
  position = document.querySelector<HTMLInputElement>('#position')!
const preference = matchMedia('(prefers-reduced-motion: reduce)')
let time = 0,
  playing = true,
  previous = 0,
  frame = 0,
  inView = true
reduced.checked = preference.matches
document.querySelector('#renderer')!.textContent =
  `${surfaces[1].renderer.kind === 'webgl' ? 'WebGL' : 'Canvas fallback'} · Local preview`
function draw() {
  for (const { canvas, renderer, idle, wave } of surfaces) {
    const bounds = canvas.getBoundingClientRect(),
      pixelRatio = Math.min(2, devicePixelRatio || 1)
    const w = Math.round(bounds.width * pixelRatio),
      h = Math.round(bounds.height * pixelRatio)
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }
    renderer.draw(
      idle ? idle.build(time, reduced.checked) : wave.build(22, 22, 0, pose, true),
      22,
      22,
      w / 22,
    )
  }
  position.value = String(time % IDLE_PERIOD)
  document.querySelector('#phase')!.textContent = reduced.checked
    ? 'Steady'
    : time % IDLE_PERIOD < 3.2
      ? 'Brightening'
      : 'Settling'
}
function sync() {
  pause.disabled = reduced.checked
  position.disabled = reduced.checked
  pause.textContent = playing ? 'Pause' : 'Play'
}
function tick(now: number) {
  const delta = previous ? Math.min(0.1, (now - previous) / 1000) : 0
  previous = now
  if (playing && !reduced.checked) {
    time = (time + delta) % IDLE_PERIOD
    draw()
  }
  if (inView && !document.hidden && playing && !reduced.checked) frame = requestAnimationFrame(tick)
}
function wake() {
  cancelAnimationFrame(frame)
  previous = 0
  draw()
  if (inView && !document.hidden && playing && !reduced.checked) frame = requestAnimationFrame(tick)
}
pause.onclick = () => {
  playing = !playing
  sync()
  wake()
}
position.oninput = () => {
  time = Number(position.value)
  playing = false
  sync()
  wake()
}
reduced.onchange = () => {
  sync()
  wake()
}
const changed = () => {
  reduced.checked = preference.matches
  sync()
  wake()
}
preference.addEventListener('change', changed)
document.addEventListener('visibilitychange', wake)
const resize = new ResizeObserver(wake)
surfaces.forEach((s) => resize.observe(s.canvas))
const visibility = new IntersectionObserver(([entry]) => {
  inView = entry.isIntersecting
  wake()
})
visibility.observe(document.querySelector('.grid')!)
sync()
wake()
window.addEventListener('pagehide', () => {
  cancelAnimationFrame(frame)
  resize.disconnect()
  visibility.disconnect()
  preference.removeEventListener('change', changed)
  surfaces.forEach((s) => s.renderer.dispose())
})
