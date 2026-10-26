export type ElectricalEvent = {
  interval: number
  travel: number
  strength: number
  decay: number
  seed: number
}

// Randomness belongs to an arrival, not a rendered frame.
export function createElectricalSequence(random: () => number = Math.random) {
  let quickRemaining = 0
  return (): ElectricalEvent => {
    if (!quickRemaining && random() < 0.28) quickRemaining = 1 + Math.floor(random() * 2)
    const interval = quickRemaining
      ? (quickRemaining--, 0.38 + random() * 0.28)
      : 0.95 + random() ** 1.5 * 3.2
    return {
      interval,
      travel: 0.13 + random() * 0.11,
      strength: 0.65 + random() * 0.45,
      decay: 0.13 + random() * 0.08,
      seed: random() * 10000,
    }
  }
}

export const JOINED = 'M16 6H14.7Q12.7 6 12.7 8V16Q12.7 18 14.7 18H16'
export const UPPER = 'M16 6H14.7Q12.7 6 12.7 8V10.7'
export const LOWER = 'M12.7 13.3V16Q12.7 18 14.7 18H16'
const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
path.setAttribute('d', JOINED)
const upper = document.createElementNS('http://www.w3.org/2000/svg', 'path')
upper.setAttribute('d', UPPER)
const length = path.getTotalLength()
const breakDistance = upper.getTotalLength()
const SEGMENTS = 112
// SVG geometry queries happen once, never in the animation loop.
const points = Array.from({ length: SEGMENTS + 1 }, (_, i) => {
  const p = path.getPointAtLength((i / SEGMENTS) * length)
  return { x: p.x, y: p.y }
})
const wireSegments = points
  .slice(0, -1)
  .map((p, i) => {
    const q = points[i + 1]!
    return `<path d="M${p.x.toFixed(3)} ${p.y.toFixed(3)}L${q.x.toFixed(3)} ${q.y.toFixed(3)}" opacity="0"/>`
  })
  .join('')
export const arrivalTime = (event: ElectricalEvent) =>
  ((breakDistance + 2) / (length + 4)) * event.travel
const clamp = (n: number) => Math.max(0, Math.min(1, n))
const ease = (n: number) => {
  const x = clamp(n)
  return x * x * (3 - 2 * x)
}
const gauss = (n: number) => Math.exp(-0.5 * n * n)

// Preserve intermediate travel after a delayed frame. Quiet time may advance
// freely, but must not consume the beginning of a new arrival.
export function advanceElectricalTime(time: number, elapsed: number, event: ElectricalEvent) {
  const tailCleared = (event.travel * (length + 8)) / (length + 4) + 1 / 24
  return time + (time < tailCleared ? Math.min(elapsed, 1 / 30) : elapsed)
}

export function electricalMarkup(id: string) {
  return `<svg width="16" height="24" viewBox="0 0 16 24" aria-hidden="true">
 <defs>
 <filter id="soft-${id}" filterUnits="userSpaceOnUse" x="-4" y="0" width="24" height="24"><feGaussianBlur stdDeviation=".48"/></filter>
 <filter id="bloom-${id}" filterUnits="userSpaceOnUse" x="-4" y="0" width="24" height="24"><feGaussianBlur stdDeviation=".72"/></filter>
 <clipPath id="supply-${id}" clipPathUnits="userSpaceOnUse"><rect x="0" y="0" width="18" height="24"/></clipPath>
 </defs>
 <path class="live-halo" fill="none" stroke="#9edce8" stroke-width="1.75" filter="url(#soft-${id})"/>
 <path class="conductor" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width=".68"/>
 <g clip-path="url(#supply-${id})">
   <g class="travelling-halo" fill="none" stroke="#c2e7ff" stroke-width="1.35" stroke-linecap="round" opacity=".32" filter="url(#soft-${id})"><use href="#filaments-${id}"/></g>
   <g class="travelling-core" fill="none" stroke="#fff" stroke-width=".38" stroke-linecap="round"><g id="filaments-${id}">${wireSegments}</g></g>
   <circle class="leading-point" r=".22" fill="#fff" opacity="0"/>
 </g>
 <g class="discharge" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity="0">
   <path class="arc-aura" stroke="#a9d8ff" stroke-width="1.5" filter="url(#bloom-${id})"/>
   <path class="arc-core" stroke="#f5fbff" stroke-width=".38"/>
   <path class="arc-branch" stroke="#d9ecff" stroke-width=".22"/>
   <g class="embers">${Array.from({ length: 7 }, () => '<path opacity="0"/>').join('')}</g>
   <circle cx="12.7" cy="10.7" r=".36" fill="#f5fbff"/>
   <circle cx="12.7" cy="13.3" r=".23" fill="#e0f2ff"/>
 </g></svg>`
}

function bind(svg: SVGSVGElement) {
  const find = <T extends SVGElement>(selector: string) => svg.querySelector<T>(selector)!
  return {
    conductor: find('.conductor'),
    live: find('.live-halo'),
    clip: find('clipPath rect'),
    lead: find('.leading-point'),
    burst: find('.discharge'),
    aura: find('.arc-aura'),
    arc: find('.arc-core'),
    branch: find('.arc-branch'),
    filaments: [...svg.querySelectorAll<SVGPathElement>('.travelling-core path')],
    embers: [...svg.querySelectorAll<SVGPathElement>('.embers path')],
    opacity: Array<string>(SEGMENTS).fill('0'),
    connected: undefined as boolean | undefined,
    lastTime: -1,
    seed: -1,
    exposure: 1 / 60,
  }
}
const bindings = new WeakMap<SVGSVGElement, ReturnType<typeof bind>>()
const noiseCache = new WeakMap<ElectricalEvent, number[]>()

export function renderElectricity(
  svg: SVGSVGElement,
  connected: boolean,
  time: number,
  reduced: boolean,
  event: ElectricalEvent,
) {
  let state = bindings.get(svg)
  if (!state) {
    state = bind(svg)
    bindings.set(svg, state)
  }
  let noise = noiseCache.get(event)
  if (!noise) {
    noise = Array.from({ length: 80 }, (_, i) => {
      const value = Math.sin(event.seed + i * 127.1) * 43758.5453
      return value - Math.floor(value)
    })
    noiseCache.set(event, noise)
  }
  if (state.connected !== connected) {
    const shape = connected ? JOINED : UPPER + LOWER
    state.conductor.setAttribute('d', shape)
    state.conductor.setAttribute('stroke', connected ? '#aacfd6' : '#737b86')
    state.conductor.setAttribute('opacity', connected ? '.72' : '.83')
    state.live.setAttribute('d', shape)
    state.live.setAttribute('opacity', connected ? '.22' : '0')
    state.clip.setAttribute('height', connected ? '24' : '10.7')
    state.connected = connected
  }
  const speed = (length + 4) / event.travel
  const head = time * speed - 2
  const age = time - arrivalTime(event)
  const wakeWidth = 0.85 + noise[1]! * 0.65
  if (time !== state.lastTime || event.seed !== state.seed) {
    const delta = time - state.lastTime
    state.exposure =
      event.seed === state.seed && delta > 0 && delta < 0.1 ? Math.min(1 / 24, delta) : 1 / 60
    state.lastTime = time
    state.seed = event.seed
  }
  // A short exposure trail bridges fast movement between frames. Every part of
  // the wake exits through the endpoint; there is no global end-of-pulse cutoff.
  for (let i = 0; i < SEGMENTS; i++) {
    const s = ((i + 0.5) / SEGMENTS) * length
    let energy = 0
    if (!reduced && head > -1 && head < length + 6 + speed * state.exposure) {
      for (let sample = 0; sample < 5; sample++) {
        const distance = s - (head - (speed * state.exposure * sample) / 4)
        if (distance < -6 || distance > 0.8) continue
        energy += gauss(distance / (distance > 0 ? 0.22 : wakeWidth)) / 5
      }
      energy *=
        event.strength *
        (0.85 + 0.15 * Math.sin(time * (100 + noise[3]! * 90) + s * 4 + event.seed) ** 2)
    }
    const opacity = energy < 0.001 ? '0' : clamp(energy).toFixed(3)
    if (opacity !== state.opacity[i]) {
      state.filaments[i]!.setAttribute('opacity', opacity)
      state.opacity[i] = opacity
    }
  }
  const index = clamp(head / length) * SEGMENTS
  const floor = Math.min(SEGMENTS - 1, Math.floor(index))
  const a = points[floor]!,
    b = points[floor + 1]!,
    blend = index - floor
  state.lead.setAttribute('cx', String(a.x + (b.x - a.x) * blend))
  state.lead.setAttribute('cy', String(a.y + (b.y - a.y) * blend))
  state.lead.setAttribute(
    'opacity',
    reduced || head < 0 || head > length ? '0' : String(clamp(event.strength * 0.72)),
  )

  const dischargeAge = (age * 0.22) / event.decay
  const envelope =
    age >= 0 && age < event.decay
      ? ease(dischargeAge / 0.006) *
        event.strength *
        (Math.exp(-dischargeAge / 0.033) +
          (0.2 + noise[4]! * 0.35) * gauss((dischargeAge - 0.045 - noise[5]! * 0.035) / 0.012) +
          noise[6]! * 0.3 * gauss((dischargeAge - 0.11 - noise[7]! * 0.03) / 0.017))
      : 0
  state.burst.style.opacity = connected ? '0' : String(reduced ? 0.18 : Math.sqrt(clamp(envelope)))
  if (!connected && (reduced || envelope > 0)) {
    const t = reduced ? 0 : age
    const kink = (n: number) =>
      Math.sin(t * (100 + noise[n + 8]! * 90) + noise[n + 12]! * 6.28) *
        (0.12 + noise[n + 16]! * 0.2) +
      Math.sin(t * 61 + n) * 0.07
    const x = 12.7 + kink(1),
      y = 12.7 + kink(2),
      z = 12.7 + kink(3)
    const arc = `M12.7 10.7L${x} 11.18L${y - 0.3} 11.68L${z + 0.23} 12.2L${x - 0.13} 12.68L12.7 13.3`
    state.aura.setAttribute('d', arc)
    state.arc.setAttribute('d', arc)
    state.branch.setAttribute(
      'd',
      `M${y - 0.3} 11.68l${-0.3 - noise[21]! * 0.75} -.28 .21 -.31M${z + 0.23} 12.2l${0.2 + noise[22]! * 0.65} .27 -.18 .36`,
    )
    for (let i = 0; i < 7; i++) {
      const ember = state.embers[i]!,
        dt = age - noise[30 + i]! * 0.02
      if (reduced || i >= 3 + Math.floor(noise[23]! * 5) || dt < 0) {
        ember.setAttribute('opacity', '0')
        continue
      }
      const life = clamp(dt / (event.decay * (0.55 + noise[40 + i]! * 0.4))),
        angle = 1.8 + noise[50 + i]! * 2.7,
        v = 10 + noise[60 + i]! * 20
      const px = 12.7 + Math.cos(angle) * v * dt,
        py = 11.9 + Math.sin(angle) * v * dt + 16 * dt * dt
      ember.setAttribute(
        'd',
        `M${px} ${py}l${-Math.cos(angle) * (0.2 + 0.35 * (1 - life))} ${-Math.sin(angle) * (0.2 + 0.35 * (1 - life))}`,
      )
      ember.setAttribute('stroke', life < 0.4 ? '#fff' : '#aac7e5')
      ember.setAttribute('stroke-width', String(0.17 + (i % 2) * 0.08))
      ember.setAttribute('opacity', String(ease(dt / 0.008) * (1 - ease(life))))
    }
  }
  return { phase: time, spark: connected ? 0 : envelope }
}
