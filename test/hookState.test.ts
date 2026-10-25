import { describe, expect, it } from 'vitest'

import { HookStateStore } from '../src/main/sessions/hookState'

const event = (name: string, extra: object = {}) => ({
  session_id: 'session-a',
  hook_event_name: name,
  cwd: 'C:\\demo',
  ...extra,
})

describe('HookStateStore', () => {
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

  it('forgets a session when it ends, and ignores junk', () => {
    const store = new HookStateStore()
    store.apply(event('UserPromptSubmit'))
    store.apply(event('SessionEnd'))
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
