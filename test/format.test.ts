import { describe, expect, it } from 'vitest'
import { lastActiveText } from '../src/renderer/lib/format'

describe('last active hover', () => {
  const now = new Date(2026, 9, 26, 15, 30).getTime()

  it('shows the local clock time until 24 hours have elapsed', () => {
    const stamp = now - 86_400_000 + 1
    expect(lastActiveText(stamp, now)).toBe(
      `Last active at ${new Date(stamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
    )
  })

  it('switches to the local date at exactly 24 hours', () => {
    const stamp = now - 86_400_000
    expect(lastActiveText(stamp, now)).toBe(
      `Last active on ${new Date(stamp).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}`,
    )
  })
})
