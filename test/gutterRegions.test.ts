import { describe, expect, it } from 'vitest'
import { WORKSPACE_GUTTER } from '../src/shared/attentionMotion'
import { inGutterRegion, parseGutterRegions, wireRegion } from '../src/shared/gutterRegions'

describe('gutter regions', () => {
  it('keeps only well-formed regions of a sensible size', () => {
    const good = { x: 4, y: 10, width: 8, height: 120 }
    expect(
      parseGutterRegions([
        good,
        { x: -1, y: 0, width: 8, height: 8 },
        { x: 0, y: 0, width: 0, height: 8 },
        { x: 0, y: 0, width: 8, height: Infinity },
        { x: 0, y: 99999, width: 8, height: 8 },
        { x: '4', y: 0, width: 8, height: 8 },
        null,
        'nope',
      ]),
    ).toEqual([good])
    expect(parseGutterRegions('not a list')).toEqual([])
    expect(parseGutterRegions(Array.from({ length: 200 }, () => good))).toHaveLength(64)
  })

  it('hit-tests a point against the regions, edges inclusive of the start only', () => {
    const regions = [{ x: 4, y: 10, width: 8, height: 20 }]
    expect(inGutterRegion(regions, { x: 4, y: 10 })).toBe(true)
    expect(inGutterRegion(regions, { x: 11.9, y: 29.9 })).toBe(true)
    expect(inGutterRegion(regions, { x: 12, y: 20 })).toBe(false)
    expect(inGutterRegion(regions, { x: 8, y: 30 })).toBe(false)
    expect(inGutterRegion([], { x: 8, y: 20 })).toBe(false)
  })

  it('puts a thin strip around a wire rail, inside the gutter and a little beyond its ends', () => {
    const region = wireRegion(0, 12, 100, 20, 80)
    expect(region).toEqual({ x: 8, y: 116, width: 8, height: 68 })
    // A rail at the gutter's edge stays inside it.
    const edge = wireRegion(0, 15, 0, 5, 50)
    expect(edge.x + edge.width).toBeLessThanOrEqual(WORKSPACE_GUTTER)
    // The gutter can sit away from the window's left edge while the card moves.
    expect(wireRegion(40, 12, 0, 10, 30).x).toBe(48)
    // Never above the window.
    expect(wireRegion(0, 12, 0, 1, 30).y).toBe(0)
  })
})
