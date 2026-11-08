import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { previewExample, previewTransition } from '../src/renderer/kimi/preview'

describe('Kimi in-memory workspace examples', () => {
  it('requires a permission decision before displaying the write', () => {
    let state = previewExample('working')
    for (let i = 0; i < 3; i++) state = previewTransition(state, { type: 'tick' })
    expect(state.phase).toBe('permission')
    expect(state.approved).toBe(false)
    expect(previewTransition(state, { type: 'deny' })).toMatchObject({
      phase: 'completed',
      approved: false,
      decision: 'denied',
    })
    state = previewTransition(state, { type: 'approve' })
    expect(state.phase).toBe('working')
    for (let i = 0; i < 3; i++) state = previewTransition(state, { type: 'tick' })
    expect(state).toMatchObject({ phase: 'completed', approved: true })
  })
  it('does not treat a stop request or uncertain outcome as settled', () => {
    const requested = previewTransition(previewExample('working'), { type: 'stop' })
    expect(requested.phase).toBe('stop-requested')
    expect(previewTransition(requested, { type: 'continue' })).toEqual(requested)
    expect(previewTransition(requested, { type: 'tick' })).toEqual(requested)
    const uncertain = previewTransition(requested, { type: 'uncertain' })
    expect(previewTransition(uncertain, { type: 'continue' })).toEqual(uncertain)
    expect(
      previewTransition(previewTransition(requested, { type: 'settle' }), { type: 'continue' }),
    ).toMatchObject({ phase: 'working', continued: true })
  })
  it('restores history without resuming and ignores stale permission decisions', () => {
    const history = previewExample('restored')
    expect(previewTransition(history, { type: 'tick' })).toEqual(history)
    expect(previewTransition(history, { type: 'continue' }).phase).toBe('working')
    for (const phase of ['failed', 'stopped', 'uncertain', 'restored'] as const)
      expect(previewTransition(previewExample(phase), { type: 'approve' })).toEqual(
        previewExample(phase),
      )
  })
  it('has no production transport, persistence, enrollment or execution dependency', () => {
    for (const file of ['preview.ts', 'KimiWorkspace.tsx']) {
      const source = readFileSync(new URL(`../src/renderer/kimi/${file}`, import.meta.url), 'utf8')
      expect(source).not.toMatch(/window\.threadlight|fetch\s*\(|localStorage|node:|ipcRenderer/)
    }
  })
})
