import { MotionGeometry, restingPose } from '../../src/renderer/motion/geometry'
import { colourActiveWheel } from './active-wheel-colours'
import { createWebGLRenderer, createCanvasRenderer } from '../../src/renderer/motion/render'

const pose = { ...restingPose(), wheel: 1, warmth: 1, rest: 0 }
const surfaces = ['before', 'after', 'beforeDot', 'afterDot'].map((id) => {
  let canvas = document.getElementById(id) as HTMLCanvasElement
  let renderer = createWebGLRenderer(canvas)
  if (!renderer) {
    const replacement = canvas.cloneNode() as HTMLCanvasElement
    canvas.replaceWith(replacement)
    canvas = replacement
    renderer = createCanvasRenderer(canvas)
  }
  if (!renderer) throw new Error('No graphics renderer available')
  return {
    canvas,
    renderer,
    geometry: new MotionGeometry(),
    activeColours: id.startsWith('after'),
  }
})
const pause = document.querySelector<HTMLButtonElement>('#pause')!
const reduced = document.querySelector<HTMLInputElement>('#reduced')!
const speed = document.querySelector<HTMLSelectElement>('#speed')!
const position = document.querySelector<HTMLInputElement>('#position')!
const preference = matchMedia('(prefers-reduced-motion: reduce)')
reduced.checked = preference.matches
let playing = true,
  time = 0,
  previous = 0
document.querySelector('#renderer')!.textContent =
  `${surfaces[1].renderer.kind === 'webgl' ? 'WebGL' : 'Canvas fallback'} · Live preview`
function draw() {
  for (const { canvas, renderer, geometry, activeColours } of surfaces) {
    const bounds = canvas.getBoundingClientRect()
    const scale = Math.min(2, devicePixelRatio || 1)
    const width = Math.round(bounds.width * scale),
      height = Math.round(bounds.height * scale)
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
    }
    const vertices = geometry.build(bounds.width, bounds.height, time, pose, reduced.checked)
    if (activeColours)
      colourActiveWheel(vertices, bounds.width, bounds.height, time, reduced.checked)
    renderer.draw(vertices, bounds.width, bounds.height, scale)
  }
  position.value = String(time % 2.1)
  const head = (time % 2.1) / 1.35 - 0.12
  document.querySelector('#phase')!.textContent = reduced.checked
    ? 'Still'
    : head < 0.2
      ? 'Centre'
      : head < 0.7
        ? 'Outward'
        : head < 1.1
          ? 'Tips'
          : 'Rest'
}
pause.onclick = () => {
  playing = !playing
  pause.textContent = playing ? 'Pause' : 'Play'
}
position.oninput = () => {
  playing = false
  pause.textContent = 'Play'
  time = Number(position.value)
  draw()
}
reduced.onchange = () => {
  position.disabled = reduced.checked
  draw()
}
preference.onchange = () => {
  reduced.checked = preference.matches
  position.disabled = reduced.checked
  draw()
}
position.disabled = reduced.checked
document.addEventListener('visibilitychange', () => {
  previous = 0
})
function tick(now: number) {
  const delta = previous ? Math.min(0.1, (now - previous) / 1000) : 0
  previous = now
  if (!document.hidden && playing && !reduced.checked) time += delta * Number(speed.value)
  if (!document.hidden) draw()
  requestAnimationFrame(tick)
}
requestAnimationFrame(tick)
window.addEventListener('pagehide', () => surfaces.forEach((surface) => surface.renderer.dispose()))
