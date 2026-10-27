import { describe, expect, it } from 'vitest'
import { codexState } from '../src/main/codex/state'
import { displayWindowsPath } from '../src/shared/displayPath'

describe('Codex status confidence', () => {
  it('verifies an active turn only with a live writer', () => {
    expect(codexState('inProgress', true, null, null)).toEqual({ state: 'working', tracked: true })
    expect(codexState('inProgress', false, null, null)).toEqual({ state: 'idle', tracked: false })
    expect(codexState(undefined, true, null, null)).toEqual({ state: 'idle', tracked: false })
  })
  it('recognizes completed turns without hooks and keeps stale hooks uncertain', () => {
    for (const status of ['completed', 'failed', 'interrupted'])
      expect(codexState(status, false, null, null)).toEqual({ state: 'idle', tracked: true })
    expect(codexState(undefined, true, null, { state: 'working' })).toEqual({
      state: 'working',
      tracked: true,
    })
    expect(codexState(undefined, false, null, { state: 'working' })).toEqual({
      state: 'idle',
      tracked: false,
    })
    expect(codexState(undefined, true, null, { state: 'waiting' })).toEqual({
      state: 'waiting',
      tracked: true,
    })
  })
})

it('formats Windows display paths without damaging drive, UNC or other paths', () => {
  expect(displayWindowsPath('\\\\?\\Z:\\General')).toBe('Z:\\General')
  expect(displayWindowsPath('\\\\?\\UNC\\server\\share')).toBe('\\\\server\\share')
  for (const path of [
    'Z:\\General',
    '\\\\server\\share',
    '/home/project',
    '\\\\?\\Volume{example}\\',
  ])
    expect(displayWindowsPath(path)).toBe(path)
})
