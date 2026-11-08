import { describe, expect, it } from 'vitest'
import { LiveAudioBuffer } from '../src/renderer/lib/liveAudioBuffer'
describe('startup PCM buffer', () => {
  it('preserves low, slow one-code modulation even during a long startup', () => {
    const queue = new LiveAudioBuffer(16000),
      frame = Float32Array.from({ length: 256 }, (_, i) => (i < 128 ? 3 : 4) / 32768)
    for (let i = 0; i < 282; i++) expect(queue.append(frame, true)).toBe(true)
    expect(queue.length).toBe(282 * frame.length)
    const out = new Float32Array(frame.length)
    for (let i = 0; i < 282; i++) {
      queue.read(out)
      expect(out.every((v, i) => v === frame[i])).toBe(true)
    }
  })
  it('keeps both speech edges and the pause in sample order', () => {
    const queue = new LiveAudioBuffer(16000),
      floor = Float32Array.from({ length: 256 }, (_, i) => (3 + (i % 3)) / 32768)
    const start = Float32Array.from({ length: 256 }, (_, i) => Math.sin(i * 0.1) * 0.00022)
    const next = Float32Array.from({ length: 256 }, (_, i) => Math.sin(i * 0.3) * 0.05)
    queue.append(start, true)
    for (let i = 0; i < 90; i++) queue.append(floor, true)
    queue.append(next, true)
    expect(queue.length).toBe(start.length + 8000 + 1920 + next.length)
    const out = new Float32Array(queue.length)
    queue.read(out)
    expect(out.slice(0, start.length)).toEqual(start)
    expect(out.slice(-next.length)).toEqual(next)
  })
})
