type Colour = readonly [number, number, number]
const ORANGE: Colour = [1, 0.59, 0.34]
const BLUE: Colour = [0.35, 0.69, 1]
const GLINT: Colour = [0.8, 0.92, 1]
export const IDLE_PERIOD = 6.4

/** A fixed halo and warm centre. Only light and a sub-pixel expansion breathe. */
export class IdleLight {
  private vertices = new Float32Array(110_000)
  private count = 0
  build(time: number, reduced: boolean) {
    this.count = 0
    const breath = reduced ? 0.35 : (1 - Math.cos((time / IDLE_PERIOD) * Math.PI * 2)) / 2
    const radius = 6.6 + breath * 0.22
    // Wide, very soft glows stay behind the sharply defined light filaments.
    for (let i = 0; i < 8; i++)
      this.ring(11, 11, radius, 3.3 - i * 0.32, BLUE, 0.012 + breath * 0.003, 0.93)
    this.ring(11, 11, radius, 0.65, BLUE, 0.42 + breath * 0.12, 0.93)
    this.ring(11, 11, radius, 0.22, GLINT, 0.35 + breath * 0.08, 0.93)
    for (let i = 0; i < 7; i++)
      this.ring(11, 11, 3.45 + breath * 0.1, 2.6 - i * 0.31, ORANGE, 0.018 + breath * 0.004, 1)
    this.ring(11, 11, 3.45 + breath * 0.1, 0.4, ORANGE, 0.58 + breath * 0.08, 1)
    // Nested translucent discs make a warm, rounded light instead of a flat status dot.
    for (let i = 0; i < 14; i++) {
      const r = 3.35 - i * 0.18
      this.disc(11, 11, r, ORANGE, 0.018 + i * 0.004 + breath * 0.003)
    }
    this.disc(10.65, 10.55, 0.72, [1, 0.83, 0.62], 0.57 + breath * 0.1)
    this.disc(10.52, 10.38, 0.25, [1, 0.95, 0.85], 0.8)
    return this.vertices.subarray(0, this.count)
  }
  private ring(
    cx: number,
    cy: number,
    r: number,
    width: number,
    colour: Colour,
    opacity: number,
    squash: number,
  ) {
    const point = (a: number, rr: number) => {
      const x = Math.cos(a) * rr,
        y = Math.sin(a) * rr * squash
      return { x: cx + x * 0.94 + y * 0.342, y: cy - x * 0.342 + y * 0.94 }
    }
    for (let i = 0; i < 96; i++) {
      const a = (i / 96) * Math.PI * 2,
        b = ((i + 1) / 96) * Math.PI * 2
      // A stationary soft opening and glint keep it from reading as a loading spinner.
      const light = 0.3 + 0.7 * Math.pow((1 + Math.cos(a + 1.1)) / 2, 0.7)
      const gap = 1 - 0.88 * Math.exp(-(((a - 1.35) / 0.35) ** 2))
      const p = point(a, r - width / 2),
        q = point(b, r - width / 2),
        s = point(b, r + width / 2),
        t = point(a, r + width / 2)
      for (const v of [p, q, s, p, s, t]) this.vertex(v.x, v.y, colour, opacity * light * gap)
    }
  }
  private disc(x: number, y: number, r: number, colour: Colour, alpha: number) {
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * Math.PI * 2,
        b = ((i + 1) / 64) * Math.PI * 2
      this.vertex(x, y, colour, alpha)
      this.vertex(x + Math.cos(a) * r, y + Math.sin(a) * r, colour, alpha)
      this.vertex(x + Math.cos(b) * r, y + Math.sin(b) * r, colour, alpha)
    }
  }
  private vertex(x: number, y: number, colour: Colour, alpha: number) {
    this.vertices[this.count++] = x
    this.vertices[this.count++] = y
    this.vertices[this.count++] = colour[0]
    this.vertices[this.count++] = colour[1]
    this.vertices[this.count++] = colour[2]
    this.vertices[this.count++] = alpha
  }
}
