import { layoutWorkspaceWires } from '../../src/shared/workspaceWires'
import {
  electricalMarkup,
  renderElectricity,
  createElectricalSequence,
  arrivalTime,
  advanceElectricalTime,
} from './wire-electricity'
const nextEvent = createElectricalSequence()
let event = nextEvent()
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

let connected = true,
  playing = true,
  time = 0,
  last = 0,
  frame = 0,
  inView = true
const preference = matchMedia('(prefers-reduced-motion: reduce)')
const reduced = $<HTMLInputElement>('reduced'),
  position = $<HTMLInputElement>('position'),
  speed = $<HTMLSelectElement>('speed')
reduced.checked = preference.matches
function control(id: string, original = false) {
  const button = document.createElement('button')
  button.className = `loop ${original ? 'old' : 'new'}`
  button.id = id
  button.innerHTML = original
    ? `<svg width="16" height="24" viewBox="0 0 16 24" aria-hidden="true"><path class="base"/><g class="old-spark"><path d="M7 12 4.5 11M10 10.5 12 8.5M10 13.5 12 15.5"/><circle cx="9" cy="12" r=".8"/></g></svg>`
    : electricalMarkup(id)
  button.onclick = () => {
    connected = !connected
    sync()
    draw()
  }
  return button
}
function panel(host: string, original: boolean) {
  const stage = document.createElement('div')
  stage.className = 'panel-stage'
  stage.innerHTML = `<div class="panel"><header class="header"><strong>Active</strong><span class="folder">Threadlight</span><span class="right">3 threads · ⚙</span></header><div class="row"><span class="dot"></span><div><div class="name">Refine the interface</div><div class="detail">Threadlight · Working</div></div></div><div class="row"><span class="dot"></span><div><div class="name">Review the workspace</div><div class="detail">Threadlight · Working</div></div></div><div class="row"><span class="dot"></span><div><div class="name">Prepare the next build</div><div class="detail">Other workspace · Ready</div></div></div><div class="footer">Workspace connections</div></div><svg class="rails" width="16" height="156" viewBox="0 0 16 156" aria-hidden="true"></svg>`
  const route = layoutWorkspaceWires([{ key: 'threadlight', first: 26, last: 78 }])[0]
  stage.querySelector('.rails')!.innerHTML =
    `<path class="links" d="M16 26H${route.x + 3}Q${route.x} 26 ${route.x} 29V75Q${route.x} 78 ${route.x + 3} 78H16"/>`
  stage.append(control(original ? 'original-loop' : 'refined-loop', original))
  $(host).append(stage)
}
panel('original-panel', true)
panel('refined-panel', false)
for (const [host, id, state] of [
  ['detail-loop', 'enlarged-loop', 'connected'],
  ['cut-detail-loop', 'cut-enlarged-loop', 'cut'],
]) {
  const detail = control(id)
  detail.dataset.fixedState = state
  detail.disabled = true
  $(host).append(detail)
}
function draw() {
  const phase = time
  document.querySelectorAll<HTMLButtonElement>('.new').forEach((button) => {
    const live = button.dataset.fixedState ? button.dataset.fixedState === 'connected' : connected
    const result = renderElectricity(
      button.querySelector('svg')!,
      live,
      time,
      reduced.checked,
      event,
    )
    button.dataset.phase = result.phase.toFixed(5)
    button.dataset.spark = String(result.spark)
  })
  const old = $('original-loop')
  old
    .querySelector('.base')!
    .setAttribute(
      'd',
      connected ? 'M16 5H12Q9 5 9 8V16Q9 19 12 19H16' : 'M16 5H12Q9 5 9 8V10M9 14V16Q9 19 12 19H16',
    )
  old.querySelector<SVGGElement>('.old-spark')!.style.display = connected ? 'none' : ''
  position.max = String(event.interval - 0.001)
  position.value = String(phase)
  $('time').textContent = `${phase.toFixed(2)} s`
  document.body.dataset.eventTime = String(arrivalTime(event))
  document.body.dataset.eventSeed = String(event.seed)
  document.body.dataset.interval = String(event.interval)
}
function sync() {
  const isConnected = connected
  document.querySelectorAll<HTMLButtonElement>('.loop').forEach((b) => {
    const connected = b.dataset.fixedState ? b.dataset.fixedState === 'connected' : isConnected
    b.dataset.connected = String(connected)
    b.setAttribute('aria-pressed', String(connected))
    b.setAttribute('aria-label', connected ? 'Hide workspace wires' : 'Show workspace wires')
    b.title = connected
      ? 'Cut wire · hide workspace connections'
      : 'Reconnect wire · show workspace connections'
  })
  document
    .querySelectorAll<SVGElement>('.rails')
    .forEach((svg) => (svg.style.display = connected ? '' : 'none'))
  $('toggle').textContent = connected ? 'Cut wire' : 'Reconnect wire'
  $('state').textContent = connected
    ? 'Connected · workspace wires visible'
    : 'Cut · workspace wires hidden'
  $('pause').textContent = playing ? 'Pause' : 'Play'
  $<HTMLButtonElement>('pause').disabled = reduced.checked
  position.disabled = reduced.checked
  $<HTMLButtonElement>('inspect-pulse').disabled = reduced.checked
  $<HTMLButtonElement>('inspect-spark').disabled = reduced.checked
  $<HTMLButtonElement>('variation').disabled = reduced.checked
  const oldSpark = document.querySelector<SVGGElement>('.old-spark')!
  oldSpark.style.animation = reduced.checked ? 'none' : ''
  oldSpark.style.opacity = reduced.checked ? '.7' : ''
  oldSpark.style.animationPlayState = playing ? 'running' : 'paused'
}
$('toggle').onclick = () => {
  connected = !connected
  sync()
  draw()
}
$('pause').onclick = () => {
  playing = !playing
  sync()
  wake()
}
$('inspect-pulse').onclick = () => {
  time = arrivalTime(event) * 0.78
  connected = true
  playing = false
  sync()
  wake()
}
$('inspect-spark').onclick = () => {
  time = arrivalTime(event) + 0.015
  connected = false
  playing = false
  sync()
  wake()
}
$('variation').onclick = () => {
  event = nextEvent()
  time = playing ? 0 : arrivalTime(event) + (connected ? -0.02 : 0.015)
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
function tick(now: number) {
  const dt = last ? Math.min(0.1, (now - last) / 1000) : 0
  last = now
  if (playing && !reduced.checked) {
    time = advanceElectricalTime(time, dt * Number(speed.value), event)
    if (time >= event.interval) {
      time = 0
      event = nextEvent()
    }
    draw()
  }
  if (inView && !document.hidden && playing && !reduced.checked) frame = requestAnimationFrame(tick)
}
function wake() {
  cancelAnimationFrame(frame)
  last = 0
  draw()
  if (inView && !document.hidden && playing && !reduced.checked) frame = requestAnimationFrame(tick)
}
const changed = () => {
  reduced.checked = preference.matches
  sync()
  wake()
}
preference.addEventListener('change', changed)
document.addEventListener('visibilitychange', wake)
const observer = new IntersectionObserver(([entry]) => {
  inView = entry.isIntersecting
  wake()
})
observer.observe(document.querySelector('main')!)
sync()
wake()
window.addEventListener('pagehide', () => {
  cancelAnimationFrame(frame)
  observer.disconnect()
  preference.removeEventListener('change', changed)
})
