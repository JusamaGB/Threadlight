import { expect, it } from 'vitest'
import { LiveAnnouncements } from '../src/renderer/lib/liveAnnouncements'

function fixture() {
  let time = 10000
  const calls = []
  let available = true
  const scheduler = new LiveAnnouncements(
    async (command) => {
      calls.push(command)
      if (command.action === 'next' && available && !command.questionsOnly) {
        available = false
        return {
          ok: true,
          announcement: { id: 'a', owner: 'c', cards: [], text: 'UI needs your input.' },
        }
      }
      return { ok: true }
    },
    () => time,
  )
  const event = (type, role = 'user', id = 'u', transcript = '') =>
    scheduler.event({ type, turn: { id, role, transcript } })
  return {
    scheduler,
    calls,
    event,
    advance: (ms = 1000) => {
      time += ms
    },
  }
}
it('waits for real native boundaries and 800ms, coexists with user speech and never starts when muted', async () => {
  const f = fixture()
  await f.scheduler.tick(true, 0)
  expect(f.calls.splice(0)).toEqual([{ action: 'next', questionsOnly: true }])
  f.event('turn.created')
  f.advance()
  await f.scheduler.tick(true, 0)
  expect(f.calls).toEqual([])
  f.event('turn.done')
  f.advance(799)
  await f.scheduler.tick(true, 0)
  expect(f.calls).toEqual([])
  f.advance()
  await f.scheduler.tick(false, 0)
  expect(f.calls).toEqual([])
  f.scheduler.input(new Float32Array([0.2]))
  await f.scheduler.tick(true, 0)
  expect(f.calls).toEqual([])
  f.advance()
  await f.scheduler.tick(true, 0)
  expect(f.calls.map((c) => c.action)).toEqual(['next', 'speak'])
  f.scheduler.close()
})
it('asks an actionable question during initial silence or mic mute without waiting for another turn', async () => {
  const calls = []
  let now = 10000
  const text = 'Which colour do you want? Red or Blue?'
  const scheduler = new LiveAnnouncements(
    async (command) => {
      calls.push(command)
      return command.action === 'next'
        ? { ok: true, announcement: { question: true, id: 'colour', text } }
        : { ok: true }
    },
    () => now,
  )
  await scheduler.tick(true, 0, true)
  expect(calls).toEqual([
    { action: 'next', questionsOnly: true },
    { action: 'speak', id: 'colour' },
  ])
  scheduler.event({ type: 'turn.created', turn: { id: 'voice', role: 'assistant' } })
  await scheduler.tick(true, 0.1, true)
  scheduler.event({ type: 'turn.done', turn: { id: 'voice', transcript: text } })
  now += 900
  await scheduler.tick(true, 0, true)
  expect(calls.at(-1)).toEqual({ action: 'settle', id: 'colour', outcome: 'announced' })
})
it('requires matching native completion AND observed playback followed by silence', async () => {
  const f = fixture()
  f.event('turn.done')
  f.advance()
  await f.scheduler.tick(true, 0)
  f.event('turn.created', 'assistant', 'a')
  f.event('turn.done', 'assistant', 'a', 'UI needs your input.')
  f.advance()
  await f.scheduler.tick(true, 0)
  expect(f.calls.some((c) => c.action === 'settle')).toBe(false)
  await f.scheduler.tick(true, 0.2)
  f.advance()
  await f.scheduler.tick(true, 0)
  expect(f.calls.at(-1)).toEqual({ action: 'settle', id: 'a', outcome: 'announced' })
})
it('speaks a question during the quiet part of its delegated voice turn', async () => {
  const calls = []
  let now = 5000
  const s = new LiveAnnouncements(
    async (command) => {
      calls.push(command)
      return command.action === 'next'
        ? { ok: true, announcement: { id: 'a', question: true, text: 'Red or Blue?' } }
        : { ok: true }
    },
    () => now,
  )
  s.event({ type: 'turn.created', turn: { role: 'user', id: 'spoken' } })
  s.event({
    type: 'delegation.created',
    item: { target: 'client', user_bidi_turn_id: 'unrelated' },
  })
  now += 1000
  await s.tick(true, 0)
  expect(calls).toEqual([])
  s.event({ type: 'delegation.created', item: { target: 'client', user_bidi_turn_id: 'spoken' } })
  now += 900
  s.input(new Float32Array([0.5]))
  await s.tick(true, 0)
  expect(calls).toEqual([])
  now += 900
  await s.tick(true, 0)
  expect(calls).toEqual([
    { action: 'next', questionsOnly: true },
    { action: 'speak', id: 'a' },
  ])
})
it('never reports an interrupted or unrelated spoken turn as announced', async () => {
  const f = fixture()
  f.event('turn.done')
  f.advance()
  await f.scheduler.tick(true, 0)
  f.event('turn.created', 'assistant', 'a')
  f.event('turn.done', 'assistant', 'a', 'Something else')
  await Promise.resolve()
  expect(f.calls.at(-1)).toEqual({ action: 'settle', id: 'a', outcome: 'uncertain' })
  f.scheduler.close()
})
it('does not submit after speech begins while a reservation is being obtained', async () => {
  let resolve
  const calls = []
  let time = 0
  const scheduler = new LiveAnnouncements(
    async (c) => {
      calls.push(c)
      if (c.action === 'next') return await new Promise((r) => (resolve = r))
      return { ok: true }
    },
    () => time,
  )
  scheduler.event({ type: 'turn.done', turn: { id: 'u', role: 'user' } })
  time = 1000
  const tick = scheduler.tick(true, 0)
  scheduler.event({ type: 'turn.created', turn: { id: 'u2', role: 'user' } })
  resolve({ ok: true, announcement: { id: 'a', owner: 'c', cards: [], text: 'Update' } })
  await tick
  expect(calls.map((c) => c.action)).toEqual(['next', 'settle'])
  scheduler.close()
})
