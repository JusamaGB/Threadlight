import { expect, it, vi } from 'vitest'
import { ScreenRegionHelp } from '../src/main/screenRegionHelp'
import { IDLE_AGENT, type AgentState } from '../src/shared/agent'
import type { RegionRequest } from '../src/main/liveScreen'

it('waits for busy work, speaks only the completed crop reply once and respects disabling speech', async () => {
  let available = false
  let state: AgentState = { ...IDLE_AGENT }
  const speak = vi.fn(),
    notify = vi.fn()
  const start = vi.fn(async (region: RegionRequest) => {
    state = {
      ...IDLE_AGENT,
      status: 'working',
      items: [
        { id: region.id, kind: 'you', text: 'Shared screen region' },
        { kind: 'agent', text: 'Checking…' },
      ],
    }
    return { ok: true as const }
  })
  const help = new ScreenRegionHelp({
    available: () => available,
    start,
    state: () => state,
    speak,
    notify,
  })
  help.configure(true, true)
  const image = { jpeg: 'pixels', thumbnail: 'preview' }
  help.receive(image)
  help.receive(image)
  await new Promise((resolve) => setImmediate(resolve))
  expect(start).not.toHaveBeenCalled()
  available = true
  help.changed()
  await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(1))
  help.receive(image)
  help.changed()
  expect(speak).not.toHaveBeenCalled()
  state = {
    ...state,
    status: 'ready',
    items: [...state.items, { kind: 'agent', text: 'Divide by a nonzero number.' }],
  }
  help.changed()
  await vi.waitFor(() => expect(speak).toHaveBeenCalledOnce())
  expect(speak).toHaveBeenCalledWith('Divide by a nonzero number.')
  help.configure(true, false)
  help.receive({ ...image, jpeg: 'different-picture' })
  await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(2))
  state = {
    ...state,
    status: 'ready',
    items: [...state.items, { kind: 'agent', text: 'Silent answer.' }],
  }
  help.changed()
  await new Promise((resolve) => setImmediate(resolve))
  expect(speak).toHaveBeenCalledOnce()
  help.close()
})
