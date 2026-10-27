/** Deterministic choreography in CSS pixels and seconds; independent of display refresh rate. */
// The existing shine reaches u=1 at t/1.35 - 0.12 = 1.
export const SWEEP = 1.35 * 1.12
export const HOLD = 0.25
export const HOLD_START = SWEEP - 0.12
export const RELEASE = SWEEP
export const CYCLE = 4.2
export const GRAVITY = 1800
export const RELEASE_SPEED = 24
const BRAKE = 0.22
const RESTART = 0.2
const MOVING_TIME = CYCLE - HOLD - (BRAKE + RESTART) / 2
const OMEGA = (Math.PI * 2) / MOVING_TIME
export const clamp = (n: number) => Math.max(0, Math.min(1, n))
export const smooth = (n: number) => {
  const x = clamp(n)
  return x * x * (3 - 2 * x)
}
export const smoother = (n: number) => {
  const x = clamp(n)
  // Floating-point overshoot at x≈1 must not make fractional neck powers NaN.
  return clamp(x * x * x * (10 + x * (-15 + 6 * x)))
}

/** The rounded drop begins with the same shape and shape velocity as the neck. */
export function flightStretch(t: number) {
  return (
    1 +
    0.2 * (1 + 9 * t) * Math.exp(-9 * t) +
    0.06 * (1 - Math.exp(-16 * t)) ** 2 * Math.sin(26 * t) * Math.exp(-7 * t)
  )
}

/** Contact includes the changing lower surface, rather than only the centre. */
export function contactTime(distance: number, radius: number) {
  let low = 0,
    high = flightDuration(distance)
  for (let i = 0; i < 36; i++) {
    const mid = (low + high) / 2
    if (airborne(mid, 0).y + radius * flightStretch(mid) < distance) low = mid
    else high = mid
  }
  return (low + high) / 2
}

/** One body fills inside the spiral, then moves through its lower rim. */
export function pooledDrop(t: number, diameter: number) {
  const front = clamp(t / 1.35 - 0.12)
  // Ease radius directly: cube-rooting a new volume caused an infinite initial
  // radius velocity. Fill and sag overlap instead of finishing in separate steps.
  const fill = smoother((front - 0.15) / 0.72)
  const amount = fill ** 3
  const radius = diameter * 0.195 * fill
  const releaseY = diameter * 0.365 + 2 + diameter * 0.195 * 0.9 + diameter * 0.2
  const startY = diameter * 0.07
  const duration = 1.35 * (1 - 0.58)
  const x = clamp((front - 0.58) / (1 - 0.58))
  const slope = (RELEASE_SPEED * duration) / (releaseY - startY)
  // Quintic Hermite: zero entry velocity/acceleration and the exact ballistic
  // release velocity at the other end. Gravity takes over without a dead stop.
  const drain = smoother(x) + slope * (-3 * x ** 5 + 7 * x ** 4 - 4 * x ** 3)
  return {
    amount,
    drain,
    radius,
    y: startY + (releaseY - startY) * drain,
    stretch: 1 + 0.2 * smoother(x),
  }
}

// Integral of smoothstep gives continuous angle and velocity at both ends of the stop.
function integratedSpin(t: number) {
  const brakeAt = HOLD_START - BRAKE
  if (t < brakeAt) return OMEGA * t
  const stopped = OMEGA * (brakeAt + BRAKE / 2)
  if (t < HOLD_START) {
    const x = (t - brakeAt) / BRAKE
    return OMEGA * (brakeAt + BRAKE * (x - x ** 3 + x ** 4 / 2))
  }
  if (t < HOLD_START + HOLD) return stopped
  if (t < HOLD_START + HOLD + RESTART) {
    const x = (t - HOLD_START - HOLD) / RESTART
    return stopped + OMEGA * RESTART * (x ** 3 - x ** 4 / 2)
  }
  return stopped + OMEGA * (RESTART / 2 + t - HOLD_START - HOLD - RESTART)
}
export function wheelAngle(t: number) {
  // The outer end of strand zero is vertically down throughout the 250 ms hold.
  return Math.PI / 2 + 4.1 - integratedSpin(HOLD_START) + integratedSpin(t)
}
export function flightDuration(distance: number, velocity = RELEASE_SPEED) {
  return (Math.sqrt(velocity * velocity + 2 * GRAVITY * Math.max(0, distance)) - velocity) / GRAVITY
}
export function airborne(t: number, y: number, v = RELEASE_SPEED) {
  return { y: y + v * t + (GRAVITY * t * t) / 2, vy: v + GRAVITY * t }
}
export function dropletSeeds(radius: number, impactSpeed: number) {
  // Only a fraction of the incoming kinetic energy reaches the ejected droplets.
  // Uneven but deterministic lobes avoid a symmetric firework / particle-explosion look.
  return Array.from({ length: 11 }, (_, i) => {
    const f = (Math.sin((i + 1) * 127.1) * 43758.5453) % 1
    const noise = Math.abs(f)
    const side = i % 2 === 0 ? -1 : 1
    return {
      vx: side * impactSpeed * (0.095 + noise * 0.16),
      vy: -impactSpeed * (0.12 + ((i * 0.173) % 0.16)),
      radius: radius * (0.15 + noise * 0.14),
      delay: 0.018 + (i % 3) * 0.009,
    }
  })
}
export function splashParticle(
  age: number,
  seed: ReturnType<typeof dropletSeeds>[number],
  floor: number,
) {
  const t = age - seed.delay
  if (t < 0) return null
  const firstLanding = (-2 * seed.vy) / GRAVITY
  if (t <= firstLanding)
    return {
      x: seed.vx * t,
      y: floor + seed.vy * t + (GRAVITY * t * t) / 2,
      vx: seed.vx,
      vy: seed.vy + GRAVITY * t,
      alpha: smoother(t / 0.025),
    }
  // One small, strongly damped secondary bounce, then a stationary wet glint fades out.
  const after = t - firstLanding
  const rebound = seed.vy * 0.17
  const secondLanding = (-2 * rebound) / GRAVITY
  const u = Math.min(after, secondLanding)
  return {
    x: seed.vx * firstLanding + seed.vx * 0.45 * u,
    y: floor + rebound * u + (GRAVITY * u * u) / 2,
    vx: after < secondLanding ? seed.vx * 0.45 : 0,
    vy: after < secondLanding ? rebound + GRAVITY * u : 0,
    alpha: 1 - smooth((after - secondLanding) / 0.38),
  }
}
