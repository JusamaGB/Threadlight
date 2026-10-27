import { describe, expect, it } from 'vitest'
import { CompletionOrder } from '../src/main/sessions/completionOrder'
import { compareSessionOrder, recentSessions } from '../src/shared/sessionOrder'
import type { Session } from '../src/shared/types'

const chat = (id: string, state: Session['state'], at: number, reply: string | null = 'done') =>
  ({ id, state, lastActiveAt: at, lastReply: reply }) as Session

describe('completion ordering', () => {
  it('holds five concurrent threads through messages, tools and permission pauses, then promotes completion', () => {
    const order = new CompletionOrder()
    let rows = [1, 2, 3, 4, 5].map((n) => order.observe(chat(String(n), 'idle', n * 100)))
    const ids = () => [...rows].sort(compareSessionOrder).map((row) => row.id)
    expect(ids()).toEqual(['5', '4', '3', '2', '1'])
    for (let update = 1; update <= 10; update++) {
      rows = rows.map((row, i) =>
        order.observe(
          chat(
            row.id,
            i % 2 ? 'waiting' : 'working',
            1000 + update * (6 - i),
            'progress ' + update,
          ),
        ),
      )
      expect(ids()).toEqual(['5', '4', '3', '2', '1'])
    }
    rows[0] = order.observe(chat('1', 'idle', 2000, 'finished'), 2000)
    expect(ids()).toEqual(['1', '5', '4', '3', '2'])
    expect(rows[1]!.lastActiveAt).toBeGreaterThan(1000)
  })

  it('ignores idle metadata and a resumed task; catches a whole completed turn between scans', () => {
    const order = new CompletionOrder()
    expect(order.observe(chat('a', 'idle', 100), 100).orderAt).toBe(100)
    expect(order.observe(chat('a', 'idle', 500), 100).orderAt).toBe(100)
    expect(order.observe(chat('a', 'idle', 600), 600).orderAt).toBe(600)
    expect(order.observe(chat('a', 'working', 700), 600).orderAt).toBe(600)
    expect(order.observe(chat('a', 'waiting', 800), 600).orderAt).toBe(600)
    expect(order.observe(chat('a', 'working', 900), 950).orderAt).toBe(600)
    expect(order.observe(chat('a', 'idle', 1000), 950).orderAt).toBe(950)
  })

  it('handles legacy completion and replies when no native completion timestamp exists', () => {
    const order = new CompletionOrder()
    expect(order.observe(chat('a', 'working', 100)).orderAt).toBe(100)
    expect(order.observe(chat('a', 'working', 200, 'streaming')).orderAt).toBe(100)
    expect(order.observe(chat('a', 'idle', 300, 'finished')).orderAt).toBe(300)
    expect(order.observe(chat('a', 'idle', 400, 'another finished reply')).orderAt).toBe(400)
  })

  it('uses the previous completed turn when first seen running and keeps active rows within the limit', () => {
    const order = new CompletionOrder()
    const active = order.observe(chat('active', 'working', 1000), 100)
    expect(active.orderAt).toBe(100)
    const recent = recentSessions(
      [active, chat('idle-new', 'idle', 900), chat('idle-old', 'idle', 800)],
      2,
    )
    expect(recent.map((row) => row.id)).toEqual(['idle-new', 'active'])
    expect(recentSessions(recent, 0)).toEqual([])
    expect(order.observe(chat('active', 'idle', 1200), 100).orderAt).toBe(1200)
  })
})
