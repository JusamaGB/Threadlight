import { describe, expect, it } from 'vitest'

import { HookStateStore } from '../src/main/sessions/hookState'

const event = (name: string, extra: object = {}) => ({
  session_id: 'session-a',
  hook_event_name: name,
  cwd: 'C:\\demo',
  ...extra,
})

describe('HookStateStore', () => {
  it('tracks compaction through start, completion, resume, interruption and subsequent work', () => {
    const store = new HookStateStore()
    store.apply(event('UserPromptSubmit'), 1)
    store.apply(event('PreCompact', { trigger: 'auto' }), 2)
    expect(store.get('session-a')).toMatchObject({ state: 'working', compacting: true })
    store.apply(event('PostCompact'), 3)
    expect(store.get('session-a')).toMatchObject({ state: 'working', compacting: false })
    store.apply(event('SessionStart', { source: 'compact' }), 3)
    expect(store.get('session-a')).toMatchObject({ state: 'working', compacting: false })
    store.apply(event('PreCompact'), 4)
    store.apply(event('SessionStart', { source: 'compact' }), 5)
    expect(store.get('session-a')).toMatchObject({ state: 'working', compacting: false })
    store.apply(event('PreCompact'), 6)
    store.apply(event('PreToolUse'), 7)
    expect(store.get('session-a')?.compacting).toBe(false)
    store.apply(event('PreCompact'), 8)
    store.apply(event('Stop'), 9)
    expect(store.get('session-a')).toMatchObject({ state: 'idle', compacting: false })
    store.apply(event('PreCompact', { trigger: 'manual' }), 10)
    store.apply(event('PostCompact', { trigger: 'manual' }), 11)
    expect(store.get('session-a')).toMatchObject({ state: 'idle', compacting: false })
  })
  it('maps hook events to states', () => {
    const store = new HookStateStore()
    const stateAfter = (name: string, extra?: object) => {
      store.apply(event(name, extra), 1000)
      return store.get('session-a')?.state
    }
    expect(stateAfter('SessionStart')).toBe('idle')
    expect(stateAfter('UserPromptSubmit')).toBe('working')
    expect(stateAfter('PreToolUse')).toBe('working')
    expect(
      stateAfter('Notification', { message: 'Claude needs your permission to use Bash' }),
    ).toBe('waiting')
    expect(stateAfter('Notification', { message: 'Claude is waiting for your input' })).toBe('idle')
    expect(stateAfter('Stop')).toBe('idle')
  })

  it('keeps an ended session as idle, so it is not guessed back to working', () => {
    const store = new HookStateStore()
    store.apply(event('UserPromptSubmit'))
    store.apply(event('SessionEnd'))
    expect(store.get('session-a')?.state).toBe('idle')
  })

  it('ignores junk', () => {
    const store = new HookStateStore()
    store.apply('not an object')
    store.apply({ hook_event_name: 'Stop' }) // no session id
    store.apply(event('SomeFutureEvent'))
    expect(store.all()).toEqual([])
  })

  it('keeps the last known cwd and transcript path', () => {
    const store = new HookStateStore()
    store.apply(event('SessionStart', { transcript_path: 'C:\\demo\\t.jsonl' }), 1)
    store.apply({ session_id: 'session-a', hook_event_name: 'Stop' }, 2)
    expect(store.get('session-a')).toMatchObject({
      cwd: 'C:\\demo',
      transcriptPath: 'C:\\demo\\t.jsonl',
    })
  })

  it('drops records older than a day', () => {
    const store = new HookStateStore()
    store.apply(event('UserPromptSubmit'), 0)
    expect(store.all(25 * 60 * 60 * 1000)).toEqual([])
  })
})
