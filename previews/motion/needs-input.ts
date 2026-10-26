import { MotionGeometry, restingPose } from '../../src/renderer/motion/geometry'
import { PROVIDER_COLOURS } from './provider-colours'
import { createWebGLRenderer, createCanvasRenderer } from '../../src/renderer/motion/render'
import {
  HOLD,
  HOLD_START,
  RELEASE,
  CYCLE,
  GRAVITY,
  RELEASE_SPEED,
  clamp,
  smooth,
  wheelAngle,
  airborne,
  dropletSeeds,
  splashParticle,
  pooledDrop,
  smoother,
  flightStretch,
  contactTime,
} from './drip-physics'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const desktop = $('desktop'),
  anchor = $('anchor'),
  taskbar = $('taskbar')
let wheel = $<HTMLCanvasElement>('wheel')
let renderer = createWebGLRenderer(wheel)
if (!renderer) {
  const fresh = wheel.cloneNode() as HTMLCanvasElement
  wheel.replaceWith(fresh)
  wheel = fresh
  renderer = createCanvasRenderer(wheel)
}
if (!renderer) throw new Error('No graphics renderer available')
const graphics = renderer
$('backend').textContent =
  `${graphics.kind === 'webgl' ? 'WebGL wheel' : 'Canvas wheel'} · Liquid overlay`
const liquid = $<HTMLCanvasElement>('liquid'),
  ctx = liquid.getContext('2d')!
const mesh = new MotionGeometry(),
  pose = { ...restingPose(), wheel: 1, warmth: 1, rest: 0 }
const play = $<HTMLButtonElement>('play'),
  timeline = $<HTMLInputElement>('timeline'),
  reduced = $<HTMLInputElement>('reduced')
const speed = $<HTMLSelectElement>('speed'),
  size = $<HTMLSelectElement>('size')
const scenario = $<HTMLSelectElement>('scenario')
const provider = $<HTMLSelectElement>('provider')
let colours: (typeof PROVIDER_COLOURS)[keyof typeof PROVIDER_COLOURS] = PROVIDER_COLOURS.claude
const needsAttention = () => scenario.value === 'active' || scenario.value === 'recent'
const preference = matchMedia('(prefers-reduced-motion: reduce)')
let playing = true,
  elapsed = 0,
  previous = 0,
  frame = 0
let width = 0,
  height = 0,
  scale = 1,
  cx = 0,
  cy = 0,
  floor = 0,
  diameter = 44,
  radius = 5,
  tip = 0,
  startY = 0,
  impactAt = 0,
  impactVelocity = 0
let lastPhase = ''

function resize() {
  const stage = desktop.getBoundingClientRect(),
    source = anchor.getBoundingClientRect(),
    surface = taskbar.getBoundingClientRect()
  width = desktop.clientWidth
  height = desktop.clientHeight
  scale = Math.min(2, devicePixelRatio || 1)
  diameter = Number(size.value)
  radius = diameter * 0.195
  cx = source.left - stage.left - desktop.clientLeft + source.width / 2
  cy = source.top - stage.top - desktop.clientTop + source.height / 2
  floor = surface.top - stage.top - desktop.clientTop
  tip = cy + diameter * 0.365
  startY = cy + pooledDrop(RELEASE, diameter).y
  impactAt = RELEASE + contactTime(floor - startY, radius)
  impactVelocity = RELEASE_SPEED + GRAVITY * (impactAt - RELEASE)
  liquid.width = Math.round(width * scale)
  liquid.height = Math.round(height * scale)
  wheel.style.width = `${diameter}px`
  wheel.style.height = `${diameter}px`
  wheel.style.left = `${cx - diameter / 2}px`
  wheel.style.top = `${cy - diameter / 2}px`
  wheel.width = Math.round(diameter * scale)
  wheel.height = Math.round(diameter * scale)
  draw()
}
function liquidFill(x: number, y: number, r: number) {
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.5, 0, x, y, r * 1.6)
  ;[0, 0.22, 0.5, 0.82, 1].forEach((stop, i) => g.addColorStop(stop, colours.liquid[i]))
  return g
}
function bead(x: number, y: number, r: number, stretch = 1, opacity = 1) {
  if (r <= 0.01 || opacity <= 0) return
  const rx = r / Math.sqrt(stretch),
    ry = r * stretch
  ctx.save()
  ctx.globalAlpha = opacity
  ctx.shadowBlur = r * 1.1
  ctx.shadowColor = colours.glow + '88'
  ctx.fillStyle = liquidFill(x, y, r)
  ctx.beginPath()
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.shadowBlur = 0
  ctx.strokeStyle = colours.glint
  ctx.lineWidth = Math.max(0.5, r * 0.15)
  ctx.globalAlpha = opacity * 0.85
  ctx.beginPath()
  ctx.ellipse(
    x - rx * 0.14,
    y - ry * 0.15,
    rx * 0.62,
    ry * 0.65,
    -0.3,
    Math.PI * 1.07,
    Math.PI * 1.55,
  )
  ctx.stroke()
  ctx.restore()
}
function liquidReservoir(t: number) {
  const front = clamp(t / 1.35 - 0.12)
  const transfer = pooledDrop(t, diameter).drain
  const residue = (1 - transfer * 0.48) * (1 - smooth((t - RELEASE) / 0.24))
  if (front <= 0 || residue <= 0) return
  const strands = diameter < 36 ? 5 : 7
  const rotation = wheelAngle(t)
  ctx.save()
  // The swept portion stays wet: broad gold ribbons preserve the spiral's dark grooves.
  // As the bead grows, the film thins; the remaining film retracts after separation.
  for (let strand = 0; strand < strands; strand++) {
    const point = (u: number) => {
      const a = rotation + (strand / strands) * Math.PI * 2 - u * 4.1
      const r = diameter * (0.055 + u * 0.31)
      return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r }
    }
    const left: Array<{ x: number; y: number }> = [],
      right: Array<{ x: number; y: number }> = []
    for (let i = 0; i <= 80; i++) {
      const u = (i / 80) * front,
        p = point(u),
        q = point(u + 0.001)
      const length = Math.hypot(q.x - p.x, q.y - p.y)
      const thickness = diameter * 0.067 * (0.24 + u * 0.76) * residue * smooth((front - u) / 0.055)
      const nx = (((q.y - p.y) / length) * thickness) / 2,
        ny = ((-(q.x - p.x) / length) * thickness) / 2
      left.push({ x: p.x + nx, y: p.y + ny })
      right.push({ x: p.x - nx, y: p.y - ny })
    }
    const metal = ctx.createLinearGradient(
      cx - diameter * 0.3,
      cy - diameter * 0.3,
      cx + diameter * 0.2,
      cy + diameter * 0.4,
    )
    ;[0, 0.25, 0.5, 0.73, 1].forEach((stop, i) => metal.addColorStop(stop, colours.metal[i]))
    ctx.fillStyle = metal
    ctx.globalAlpha = 0.95
    ctx.shadowColor = colours.glow + '70'
    ctx.shadowBlur = diameter * 0.045 * residue
    ctx.beginPath()
    ctx.moveTo(left[0].x, left[0].y)
    for (const p of left) ctx.lineTo(p.x, p.y)
    for (const p of right.reverse()) ctx.lineTo(p.x, p.y)
    ctx.closePath()
    ctx.fill()
    // A pale liquid edge travels with the shine, rather than creating an unrelated fill timer.
    ctx.shadowBlur = diameter * 0.065
    ctx.shadowColor = colours.glint
    ctx.strokeStyle = colours.glint
    ctx.lineWidth = diameter * 0.021
    ctx.globalAlpha = 0.9 * (1 - smooth((t - RELEASE) / 0.12))
    ctx.beginPath()
    for (let i = 0; i <= 12; i++) {
      const p = point(Math.max(0, front - 0.075) + (Math.min(front, 0.075) * i) / 12)
      if (i === 0) ctx.moveTo(p.x, p.y)
      else ctx.lineTo(p.x, p.y)
    }
    ctx.stroke()
  }
  ctx.restore()
}
function attached(t: number, opacity = 1) {
  const flight = Math.max(0, t - RELEASE)
  const pool = pooledDrop(Math.min(t, RELEASE), diameter)
  const { amount, drain, radius: r } = pool
  const stretch = t < RELEASE ? pool.stretch : flightStretch(flight)
  if (amount === 0) return
  const y = t < RELEASE ? cy + pool.y : airborne(flight, startY).y
  const rx = r / Math.sqrt(stretch),
    ry = r * stretch
  // Keep one outline through pinch-off; the neck recoils into the falling body.
  const emerging = smoother(drain / 0.85) * (1 - smoother(flight / 0.09))
  const pinch = smoother((t - HOLD_START) / (RELEASE - HOLD_START))
  // This is the same body from first fill to separation. Its centre begins inside
  // the logo, then descends while the upper reservoir recedes into the neck.
  const rootY = (y - ry * 0.45) * (1 - emerging) + (cy + diameter * 0.055) * emerging
  const rootWidth = rx * (0.86 - 0.67 * emerging)
  const topY = (y - ry) * (1 - emerging) + (cy - diameter * 0.065) * emerging
  const lateNeck = tip + Math.max(0, y - ry - tip) * 0.65
  const neckY = (y - ry * 0.12) * (1 - emerging) + lateNeck * emerging
  const half = rx * 0.99 * (1 - emerging) + Math.max(0.12, r * 0.4 * (1 - pinch) ** 1.6) * emerging
  ctx.save()
  const visible = opacity * smoother(r / (diameter * 0.035))
  ctx.globalAlpha = visible
  ctx.lineCap = 'round'
  ctx.shadowColor = colours.glow
  ctx.fillStyle = liquidFill(cx, y, r)
  ctx.shadowBlur = r * 0.65
  ctx.beginPath()
  ctx.moveTo(cx, topY)
  ctx.bezierCurveTo(
    cx - rootWidth * 0.7,
    topY,
    cx - rootWidth,
    rootY - r * 0.15,
    cx - rootWidth,
    rootY,
  )
  ctx.bezierCurveTo(cx - rootWidth, rootY + r * 0.3, cx - half, neckY - r * 0.15, cx - half, neckY)
  ctx.bezierCurveTo(
    cx - half,
    neckY + (y - neckY) * 0.35,
    cx - rx,
    y - ry * 0.3 * emerging,
    cx - rx,
    y,
  )
  ctx.bezierCurveTo(cx - rx, y + ry * 0.64, cx - rx * 0.55, y + ry, cx, y + ry)
  ctx.bezierCurveTo(cx + rx * 0.55, y + ry, cx + rx, y + ry * 0.64, cx + rx, y)
  ctx.bezierCurveTo(
    cx + rx,
    y - ry * 0.3 * emerging,
    cx + half,
    neckY + (y - neckY) * 0.35,
    cx + half,
    neckY,
  )
  ctx.bezierCurveTo(
    cx + half,
    neckY - r * 0.15,
    cx + rootWidth,
    rootY + r * 0.3,
    cx + rootWidth,
    rootY,
  )
  ctx.bezierCurveTo(cx + rootWidth, rootY - r * 0.15, cx + rootWidth * 0.7, topY, cx, topY)
  ctx.closePath()
  ctx.fill()
  // The spiral is still readable through the internal liquid. These darker
  // grooves are clipped to both the liquid body and the original wheel.
  ctx.save()
  ctx.clip()
  ctx.beginPath()
  ctx.arc(cx, cy, diameter * 0.365, 0, Math.PI * 2)
  ctx.clip()
  ctx.shadowBlur = 0
  ctx.strokeStyle = colours.grooves
  ctx.globalAlpha = 0.25 * visible
  ctx.lineWidth = diameter * 0.017
  const strands = diameter < 36 ? 5 : 7
  for (let strand = 0; strand < strands; strand++) {
    ctx.beginPath()
    for (let i = 0; i <= 60; i++) {
      const u = i / 60,
        a = wheelAngle(t) + (strand / strands) * Math.PI * 2 - u * 4.1,
        rr = diameter * (0.055 + u * 0.31)
      const x = cx + Math.cos(a) * rr,
        yy = cy + Math.sin(a) * rr
      if (i === 0) ctx.moveTo(x, yy)
      else ctx.lineTo(x, yy)
    }
    ctx.stroke()
  }
  ctx.restore()
  ctx.shadowBlur = 0
  ctx.strokeStyle = colours.glint
  ctx.globalAlpha = 0.85 * visible
  ctx.lineWidth = Math.max(0.5, r * 0.12)
  ctx.beginPath()
  ctx.moveTo(cx - rootWidth * 0.52, rootY)
  ctx.bezierCurveTo(
    cx - half * 0.7,
    neckY,
    cx - rx * 0.76,
    y - ry * 0.48,
    cx - rx * 0.66,
    y + ry * 0.13,
  )
  ctx.stroke()
  ctx.restore()
}
function splash(age: number) {
  const seeds = dropletSeeds(radius, impactVelocity)
  ctx.save()
  // Everything liquid remains above the taskbar plane; deposited liquid lives on its lip.
  ctx.beginPath()
  ctx.rect(0, 0, width, floor + 1)
  ctx.clip()
  const settle = 1 - smooth((age - 0.35) / 0.65)
  const extent = radius * (1 + 5 * (1 - Math.exp(-age * 10)))
  ctx.globalAlpha = settle * 0.7 * smoother(age / 0.055)
  const pool = ctx.createRadialGradient(cx, floor, 0, cx, floor, extent)
  ;[0, 0.3, 1].forEach((stop, i) => pool.addColorStop(stop, colours.pool[i]))
  ctx.fillStyle = pool
  ctx.beginPath()
  ctx.ellipse(
    cx,
    floor,
    extent,
    Math.max(0.6, radius * 0.29 * Math.exp(-age * 2.5)),
    0,
    0,
    Math.PI * 2,
  )
  ctx.fill()
  // Radial lamella rises into a shallow crown before breaking into ballistic droplets.
  if (age < 0.19) {
    const q = clamp(age / 0.19),
      rise = Math.sin(Math.PI * q) * radius * 1.35
    const span = radius * (1 + q * 3.7)
    ctx.globalAlpha = (1 - q) * 0.8 * smoother(age / 0.025)
    ctx.strokeStyle = colours.crown
    ctx.lineWidth = 1.1 - q * 0.7
    ctx.beginPath()
    ctx.moveTo(cx - span, floor)
    for (let i = 0; i <= 24; i++) {
      const u = i / 24,
        x = cx - span + u * span * 2
      const crown =
        rise * Math.pow(Math.sin(Math.PI * u), 0.5) * (0.5 + 0.5 * Math.sin(u * Math.PI * 10) ** 2)
      ctx.lineTo(x, floor - crown)
    }
    ctx.lineTo(cx + span, floor)
    ctx.stroke()
  }
  if (age < 0.075) {
    const q = smoother(age / 0.075)
    // Compress the actual falling outline about its contact point. Its centre,
    // specular edge and colour all survive into the first impact frame.
    ctx.save()
    ctx.translate(cx, floor)
    ctx.scale(1 + q * 1.8, 1 - q * 0.95)
    ctx.translate(-cx, -floor)
    attached(impactAt, 1 - q)
    ctx.restore()
  }
  ctx.globalAlpha = 1
  for (const seed of seeds) {
    const particle = splashParticle(age, seed, floor - seed.radius)
    if (!particle || particle.alpha <= 0) continue
    ctx.save()
    ctx.translate(cx + particle.x, particle.y)
    ctx.rotate(Math.atan2(particle.vy, particle.vx) + Math.PI / 2)
    bead(
      0,
      0,
      seed.radius,
      1 + Math.min(0.3, Math.hypot(particle.vx, particle.vy) / 1100),
      particle.alpha * 0.9,
    )
    ctx.restore()
  }
  ctx.restore()
}
function phaseFor(t: number) {
  if (scenario.value === 'open') return 'open'
  if (!needsAttention()) return 'clear'
  if (reduced.checked) return 'still'
  if (t < HOLD_START) return 'gather'
  if (t < HOLD_START + HOLD) return 'hold'
  if (t < impactAt) return 'fall'
  if (t < impactAt + 0.85) return 'splash'
  return 'rest'
}
function draw() {
  if (!width) return
  const t = reduced.checked ? 1.3 : elapsed % CYCLE
  const shineTime = needsAttention() ? Math.min(t, 2.099) : t % 2.1
  // Stable base colour/geometry closes the loop without resetting sparkle positions.
  // The wet ribbons carry the travelling shine while attention is required.
  const vertices = mesh.build(
    diameter,
    diameter,
    needsAttention() ? 0 : shineTime,
    pose,
    needsAttention() || reduced.checked,
  )
  const delta = needsAttention() ? wheelAngle(t) : 0
  const c = Math.cos(delta),
    s = Math.sin(delta)
  for (let i = 0; i < vertices.length; i += 6) {
    const x = vertices[i] - diameter / 2,
      y = vertices[i + 1] - diameter / 2
    vertices[i] = diameter / 2 + x * c - y * s
    vertices[i + 1] = diameter / 2 + x * s + y * c
    if (needsAttention()) {
      const light = 0.78 + 0.22 * vertices[i + 3]
      vertices[i + 2] = colours.rgb[0] * light
      vertices[i + 3] = colours.rgb[1] * light
      vertices[i + 4] = colours.rgb[2] * light
    }
  }
  graphics.draw(vertices, diameter, diameter, scale)
  ctx.setTransform(scale, 0, 0, scale, 0, 0)
  ctx.clearRect(0, 0, width, height)
  if (needsAttention()) liquidReservoir(t)
  if (needsAttention()) {
    if (t < impactAt) attached(t)
    else splash(t - impactAt)
  }
  const phase = phaseFor(t)
  if (phase !== lastPhase) {
    lastPhase = phase
    const labels: Record<string, [string, string]> = {
      open: [
        'Attention received',
        'Threadlight is open. The floating indicator and liquid overlay are hidden.',
      ],
      clear: [
        'No input needed',
        'Only the normal outward shine remains. No liquid accumulates or falls.',
      ],
      gather: [
        'Pooling inside',
        'Liquid collects within the spiral, then sags through its lower rim as one body.',
      ],
      hold: [
        '250 ms of stillness',
        'The neck pinches off exactly as the shine reaches the outer edge.',
      ],
      fall: ['Gravity takes over', 'The wheel resumes. The drop accelerates independently.'],
      splash: ['Impact & settle', 'A low crown breaks into droplets, then settles on the lip.'],
      rest: ['A moment of quiet', 'The last wet glints fade before the next sweep.'],
      still: ['Needs input', 'Reduced motion: a static provider-coloured wheel and hanging bead.'],
    }
    $('phase-title').textContent = labels[phase][0]
    $('phase-description').textContent = labels[phase][1]
    document
      .querySelectorAll<HTMLElement>('[data-phase]')
      .forEach((e) => e.classList.toggle('active', e.dataset.phase === phase))
  }
  timeline.value = String(elapsed % CYCLE)
  $('time').textContent = `${(elapsed % CYCLE).toFixed(2)} s`
  // Small observable state for preview QA, with no application IPC or private data.
  desktop.dataset.phase = phase
  desktop.dataset.impact = String(impactAt)
  desktop.dataset.angle = String(wheelAngle(t))
  desktop.dataset.dripping = String(needsAttention())
  desktop.dataset.release = String(RELEASE)
  desktop.dataset.shineFront = String(clamp(t / 1.35 - 0.12))
  desktop.dataset.provider = provider.value
}
function syncControls() {
  play.textContent = playing ? 'Pause' : 'Play'
  timeline.disabled = reduced.checked
  play.disabled = reduced.checked
  $<HTMLButtonElement>('release').disabled = reduced.checked || !needsAttention()
  $<HTMLButtonElement>('pool').disabled = reduced.checked || !needsAttention()
  $<HTMLButtonElement>('impact').disabled = reduced.checked || !needsAttention()
}
function seek(t: number) {
  elapsed = t
  playing = false
  syncControls()
  draw()
}
play.onclick = () => {
  playing = !playing
  syncControls()
}
timeline.oninput = () => seek(Number(timeline.value))
$('release').onclick = () => seek(RELEASE - 0.02)
$('pool').onclick = () => seek(1.04)
$('impact').onclick = () => seek(impactAt + 0.075)
size.onchange = () => {
  anchor.classList.toggle('actual', size.value === '22')
  resize()
}
function updateProviderLabel() {
  const descriptions: Record<string, string> = {
    active: `Threadlight minimised · ${colours.name} Active thread needs input`,
    recent: `Threadlight minimised · ${colours.name} Recent thread needs input`,
    clear: 'Threadlight minimised · No thread needs input',
    open: 'Threadlight open · Desktop attention effect off',
  }
  $('desktop-status').textContent = descriptions[scenario.value]
  $('phase-title').style.color = colours.base
  wheel.setAttribute('aria-label', `${colours.name} needs-input wheel`)
  liquid.setAttribute('aria-label', `${colours.name} liquid drop and taskbar splash`)
}
provider.onchange = () => {
  colours = PROVIDER_COLOURS[provider.value as keyof typeof PROVIDER_COLOURS]
  updateProviderLabel()
  draw()
}
scenario.onchange = () => {
  elapsed = 0
  playing = true
  wheel.hidden = scenario.value === 'open'
  liquid.hidden = scenario.value === 'open'
  updateProviderLabel()
  syncControls()
  draw()
}
function preferenceChanged() {
  reduced.checked = preference.matches
  syncControls()
  draw()
}
reduced.onchange = () => {
  syncControls()
  draw()
}
preference.addEventListener('change', preferenceChanged)
reduced.checked = preference.matches
syncControls()
const observer = new ResizeObserver(resize)
observer.observe(desktop)
let inView = true
const visibility = new IntersectionObserver(([entry]) => {
  inView = entry.isIntersecting
  previous = 0
  if (inView && !document.hidden) wake()
  else cancelAnimationFrame(frame)
})
visibility.observe(desktop)
function tick(now: number) {
  const dt = previous ? Math.min(0.1, (now - previous) / 1000) : 0
  previous = now
  if (playing && !reduced.checked) elapsed = (elapsed + dt * Number(speed.value)) % CYCLE
  if (playing && !reduced.checked) draw()
  if (inView && !document.hidden) frame = requestAnimationFrame(tick)
}
function wake() {
  cancelAnimationFrame(frame)
  previous = 0
  frame = requestAnimationFrame(tick)
}
document.addEventListener('visibilitychange', () => {
  cancelAnimationFrame(frame)
  previous = 0
  if (!document.hidden && inView) wake()
})
updateProviderLabel()
resize()
wake()
window.addEventListener('pagehide', () => {
  cancelAnimationFrame(frame)
  observer.disconnect()
  visibility.disconnect()
  preference.removeEventListener('change', preferenceChanged)
  graphics.dispose()
})
