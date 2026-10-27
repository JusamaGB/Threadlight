import { describe, expect, it } from 'vitest'

import { elapsedText } from '../src/shared/elapsed'

describe('elapsedText', () => {
  it('counts seconds, then minutes and seconds, then hours and minutes', () => {
    expect(elapsedText(0, 42_000)).toBe('42s')
    expect(elapsedText(0, 185_000)).toBe('3m 05s')
    expect(elapsedText(0, 3_720_000)).toBe('1h 02m')
    expect(elapsedText(5_000, 0)).toBe('0s') // a clock a little behind never goes negative
  })
})
