import { PROVIDER_COLOURS } from './provider-colours'

/** Active indicator only. The needs-input renderer never imports this treatment. */
export function colourActiveWheel(
  vertices: Float32Array,
  width: number,
  height: number,
  time: number,
  reduced: boolean,
) {
  // Lift the active indicator's light without changing the shared provider palettes.
  const orange = PROVIDER_COLOURS.claude.rgb.map((value, channel) =>
    Math.min(1, value * [1.15, 1.1, 0.94][channel]),
  )
  const blue = PROVIDER_COLOURS.codex.rgb.map((value, channel) =>
    Math.min(1, value * [0.87, 1.08, 1][channel]),
  )
  const head = (time % 2.1) / 1.35 - 0.12
  const unit = (n: number) => Math.max(0, Math.min(1, n))
  const fade = unit(head / 0.08) * unit((1.32 - head) / 0.28)
  // One colour per quad keeps tiny strands clean and gives Canvas/WebGL the same result.
  for (let start = 0; start < vertices.length; start += 36) {
    let x = 0,
      y = 0
    for (let i = start; i < start + 36; i += 6) {
      x += vertices[i]
      y += vertices[i + 1]
    }
    const radius = Math.hypot(x / 6 - width / 2, y / 6 - height / 2)
    const u = unit((radius / height - 0.055) / 0.31)
    const distance = u - head
    const spread = distance > 0 ? 0.055 : 0.16
    const shine = reduced ? 0 : Math.exp(-0.5 * (distance / spread) ** 2) * fade
    // A small cool-white specular core lifts brightness while retaining a blue body.
    const glint = reduced ? 0 : Math.exp(-0.5 * (distance / 0.026) ** 2) * fade * 0.28
    for (let i = start; i < start + 36; i += 6) {
      for (let c = 0; c < 3; c++) {
        const litBlue = blue[c] + (1 - blue[c]) * glint
        vertices[i + 2 + c] = orange[c] + (litBlue - orange[c]) * shine
      }
      vertices[i + 5] = unit(vertices[i + 5] * (1.18 + shine * 0.16))
    }
  }
  return vertices
}
