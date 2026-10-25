import { describe, expect, it } from 'vitest'

import { acceleratorFrom, acceleratorLabel, type KeyPress } from '../src/shared/accelerator'

const press = (code: string, mods: Partial<KeyPress> = {}, key = code): KeyPress => ({
  key,
  code,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...mods,
})

describe('acceleratorFrom', () => {
  it('builds Electron accelerators from physical keys', () => {
    expect(acceleratorFrom(press('KeyQ', { ctrlKey: true, altKey: true }))).toEqual({
      accelerator: 'Control+Alt+Q',
    })
    // Shift+1 is still "1": the key's position, not the character it types.
    expect(acceleratorFrom(press('Digit1', { ctrlKey: true, shiftKey: true }, '!'))).toEqual({
      accelerator: 'Control+Shift+1',
    })
    expect(acceleratorFrom(press('Space', { metaKey: true }, ' '))).toEqual({
      accelerator: 'Super+Space',
    })
    expect(acceleratorFrom(press('F8'))).toEqual({ accelerator: 'F8' })
  })

  it('waits while only modifiers are held', () => {
    expect(acceleratorFrom(press('ControlLeft', { ctrlKey: true }, 'Control'))).toBeNull()
  })

  it('refuses keys that would make a poor global hotkey', () => {
    expect(acceleratorFrom(press('KeyQ'))).toEqual({ problem: 'needs-modifier' })
    expect(acceleratorFrom(press('KeyQ', { shiftKey: true }))).toEqual({
      problem: 'needs-modifier',
    })
    expect(acceleratorFrom(press('IntlRo', { ctrlKey: true }, 'ろ'))).toEqual({
      problem: 'unsupported',
    })
  })
})

describe('acceleratorLabel', () => {
  it('uses the names on the keyboard', () => {
    expect(acceleratorLabel('Control+Alt+Q')).toBe('Ctrl+Alt+Q')
    expect(acceleratorLabel('Super+Space')).toBe('Win+Space')
  })
})
