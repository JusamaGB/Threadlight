import type { AttentionMotion } from '../../shared/attentionMotion'
import { MIC_PILL_HEIGHT } from '../../shared/micIndicator'
import { unit } from '../../shared/motion'

const smooth = (a: number, b: number, v: number) => {
  const t = unit((v - a) / (b - a))
  return t * t * (3 - 2 * t)
}

const stops = [
  [0, 115, 29, 16],
  [0.16, 178, 39, 13],
  [0.34, 235, 61, 14],
  [0.5, 255, 102, 19],
  [0.68, 255, 161, 41],
  [0.84, 255, 207, 93],
  [1, 255, 236, 166],
] as const
const colours = Uint8Array.from({ length: 256 * 3 }, (_, i) => {
  const value = Math.floor(i / 3) / 255
  const k = stops.findIndex(([at], j) => j > 0 && at >= value)
  const a = stops[k - 1]!,
    b = stops[k]!,
    channel = (i % 3) + 1
  return a[channel]! + ((b[channel]! - a[channel]!) * (value - a[0])) / (b[0] - a[0])
})

/** Paint the original flame field on a transparent surface over the actual pill. */
export function createPillFire(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const layer = document.createElement('canvas')
  const ink = layer.getContext('2d')
  if (!ink) return null
  let field: ImageData | undefined
  let seed = 11309
  const lattice = Float32Array.from({ length: 65536 }, () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 4294967296
  })
  function noise(x: number, y: number) {
    const ix = Math.floor(x),
      iy = Math.floor(y),
      u = smooth(0, 1, x - ix),
      v = smooth(0, 1, y - iy)
    const a = (ix & 255) + ((iy & 255) << 8),
      b = ((ix + 1) & 255) + ((iy & 255) << 8)
    const low = lattice[a]! * (1 - u) + lattice[b]! * u
    return low + (lattice[(a + 256) & 65535]! * (1 - u) + lattice[(b + 256) & 65535]! * u - low) * v
  }
  let spread = 0,
    power = 0,
    time = 0
  return (state: AttentionMotion, dt: number, still: boolean) => {
    if (!state.pill) return
    const { width, height, pill } = state
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const w = Math.round(width * dpr),
      h = Math.round(height * dpr)
    if (!field || field.width !== w || field.height !== h) {
      canvas.width = layer.width = w
      canvas.height = layer.height = h
      field = ink.createImageData(w, h)
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, w, h)
    if (still) spread = power = Number(pill.waiting)
    else if (pill.waiting) {
      spread = Math.min(1, spread + dt / 0.85)
      power = Math.min(1, power + dt / 0.28)
    } else {
      power = Math.max(0, power - dt / 0.62)
      if (!power) spread = 0
    }
    if (!power) return
    time += dt
    const t = still ? 1.42 : time
    const scale = MIC_PILL_HEIGHT / 26
    const half = pill.width / (2 * scale)
    const rim = (x: number) => {
      const q = Math.min(12.5, Math.max(0, Math.abs(x) - (half - 12.5)))
      return 55 - 12.5 + Math.sqrt(12.5 ** 2 - q * q)
    }
    const wings = smooth(0.68, 1, spread) * power
    const ratio = dpr * scale
    ctx.setTransform(ratio, 0, 0, ratio, state.x * dpr, (state.y - 42 * scale) * dpr)
    function glow(x: number, y: number, rx: number, ry: number, opacity: number) {
      if (!opacity) return
      ctx!.save()
      ctx!.translate(x, y)
      ctx!.scale(rx, ry)
      const gradient = ctx!.createRadialGradient(0, 0, 0, 0, 0, 1)
      gradient.addColorStop(0, `rgba(255,131,29,${opacity})`)
      gradient.addColorStop(0.44, `rgba(245,68,13,${opacity * 0.42})`)
      gradient.addColorStop(1, 'rgba(245,58,14,0)')
      ctx!.fillStyle = gradient
      ctx!.fillRect(-1, -1, 2, 2)
      ctx!.restore()
    }
    glow(0, 55, (half * (25 + 33 * spread)) / 50.5, 6, 0.4 * power)
    for (const side of [-1, 1]) glow(side * (half - 1.5), 46, 12, 17, 0.32 * wings)
    const pixels = field.data
    pixels.fill(0)
    for (let i = 0; i < w; i++) {
      const x = ((i + 0.5) / dpr - state.x) / scale,
        ax = Math.abs(x)
      if (ax > half + 7.5) continue
      const travel = spread * (half + 8.5)
      const lit = 1 - smooth(travel - 7, travel + 2, ax)
      if (lit <= 0.001) continue
      const base = rim(x),
        heightAtX = 3.9 + 19 * Math.exp(-((ax - half + 1.5) ** 2) / 42)
      const rowAt = (y: number) => ((y - 42) * scale + state.y) * dpr
      const start = Math.max(0, Math.floor(rowAt(base - heightAtX * 1.8 - 5)))
      const end = Math.min(h, Math.ceil(rowAt(base + 6)))
      for (let j = start; j < end; j++) {
        const y = 42 + ((j + 0.5) / dpr - state.y) / scale
        const lift = unit((base - y) / Math.max(4, heightAtX))
        const wx = x + (noise(x * 0.11 + t * 0.35, y * 0.12 + t * 1.65) - 0.5) * (1.3 + lift * 9)
        const wa = Math.abs(wx),
          up = rim(wx) - y
        const fuel = 3.8 + 23 * Math.exp(-((wa - half + 1.3) ** 2) / 33)
        const drift = t * 2.35
        const moving =
          0.16 +
          0.94 * noise(wx * 0.26, y * 0.13 + drift) +
          0.38 * noise(wx * 0.52 + 41, y * 0.25 + drift * 1.75) +
          0.18 * noise(wx * 0.82, y * 0.32 + drift * 2.3)
        const thickness = 1 - smooth(half - 0.6, half + 1 + lift * 1.3, wa)
        const v =
          (moving - up / Math.max(0.7, fuel * (0.26 + 0.74 * power) * lit)) *
          thickness *
          smooth(-2.5, -0.12, up)
        if (v <= 0.08) continue
        const colour = Math.floor(unit((v - 0.06) * 0.88) * 255) * 3,
          offset = (j * w + i) * 4
        pixels[offset] = colours[colour]!
        pixels[offset + 1] = colours[colour + 1]!
        pixels[offset + 2] = colours[colour + 2]!
        pixels[offset + 3] = 255 * unit((v - 0.08) * 4.5) * power * lit
      }
    }
    ink.putImageData(field, 0, 0)
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.drawImage(layer, 0, 0)
    ctx.restore()
    for (let k = 0; k < 6; k++) {
      const life = (t * (0.48 + k * 0.032) + k * 0.381) % 1,
        side = k % 2 ? 1 : -1
      const x = side * (half - 0.7 + 2 * Math.sin(t * 2 + k * 3.1 + life * 3) + life * 4)
      const y = 39 - life * (13 + (k % 3) * 3)
      ctx.fillStyle = `rgba(255,170,64,${0.65 * Math.sin(Math.PI * life) ** 2 * wings})`
      ctx.beginPath()
      ctx.ellipse(x, y, 0.28, 0.47 + life * 0.24, side * 0.2, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}
