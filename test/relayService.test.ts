import { describe, expect, it } from 'vitest'

import type { RelayDeps, RelayTarget } from '../src/main/relay'
import { RelayService } from '../src/main/relayService'
import type { RelayStatus } from '../src/shared/types'

const SESSION = '0f1e2d3c-4b5a-4968-8776-a5b4c3d2e1f0'
const target: RelayTarget = { id: SESSION, cwd: '', permissionMode: null, model: null }
const fakeCli = { command: process.execPath, prefixArgs: ['test/fixtures/fake-claude.mjs'] }

function service(lookup: (id: string) => RelayTarget | undefined = () => target) {
  const seen: RelayStatus['state'][] = []
  const deps = async (): Promise<RelayDeps> => ({ cli: fakeCli, isHeld: async () => false })
  const relays = new RelayService(deps, lookup, (list) => {
    const status = list.find((s) => s.sessionId === SESSION)
    if (status) seen.push(status.state)
  })
  return { relays, seen }
}

const until = async (check: () => boolean) => {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 10))
}

describe('RelayService', () => {
  it('moves a message through sending, sent and replied', async () => {
    const { relays, seen } = service()
    expect(relays.send(SESSION, 'hello')).toEqual({ ok: true })
    await until(() => seen.includes('replied'))
    expect(seen).toEqual(['sending', 'sent', 'replied'])
    expect(relays.list()[0]).toMatchObject({ state: 'replied', detail: 'Got it: hello' })
  })

  it('allows one message in flight per session', async () => {
    const { relays, seen } = service()
    relays.send(SESSION, 'first')
    expect(relays.send(SESSION, 'second')).toEqual({
      ok: false,
      reason: 'Still waiting for the last reply.',
    })
    await until(() => seen.includes('replied'))
    expect(relays.send(SESSION, 'third')).toEqual({ ok: true })
    await until(() => seen.filter((s) => s === 'replied').length === 2)
  })

  it('only sends to sessions it knows about', () => {
    const { relays } = service(() => undefined)
    expect(relays.send(SESSION, 'hi').ok).toBe(false)
    expect(relays.list()).toEqual([])
  })
})
