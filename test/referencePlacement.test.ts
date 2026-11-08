import { expect, it } from 'vitest'
import { micIndicatorBounds } from '../src/shared/micIndicator'
import { referencePlacement } from '../src/main/referencePlacement'

const area = { x: -1920, y: -100, width: 1920, height: 1040 }
it.each([
  [false, false],
  [true, false],
  [false, true],
  [true, true],
])('aligns the matching corner on the logo monitor (right %s, bottom %s)', (right, bottom) => {
  const dot = {
    x: area.x + (right ? area.width - 32 - 8 : 8),
    y: area.y + (bottom ? area.height - 32 - 8 : 8),
    width: 32,
    height: 32,
  }
  for (const live of [false, true]) {
    const indicator = micIndicatorBounds(dot, area, live)
    const { bounds, anchor } = referencePlacement(dot, indicator, area, 238, 300)
    expect(bounds).toEqual({
      x: right ? dot.x + 32 - 238 : dot.x,
      y: bottom ? dot.y + 32 - 300 : dot.y,
      width: 238,
      height: 300,
    })
    expect(anchor).toMatchObject({
      right,
      bottom,
      width: indicator.width,
      height: indicator.height,
    })
  }
})
it('clamps the reference to the work area when an interior logo has too little room', () => {
  const small = { x: -800, y: 40, width: 800, height: 600 }
  const dot = { x: -350, y: 290, width: 32, height: 32 }
  const { bounds } = referencePlacement(dot, dot, small, 238, 540)
  expect(bounds).toEqual({ x: -556, y: 100, width: 238, height: 540 })
})
