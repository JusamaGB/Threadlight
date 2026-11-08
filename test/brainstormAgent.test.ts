import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { BrainstormAgent } from '../src/renderer/spaces/brainstormAgent'
import { IDLE_AGENT } from '../src/shared/agent'
import type { SpaceIdea, SpacesInput, SpacesReply, SpacesSnapshot } from '../src/shared/spaces'

const space = '11111111-1111-4111-8111-111111111111'
const foreign = '22222222-2222-4222-8222-222222222222'
beforeEach(() => {
  const storage = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  })
})
afterEach(() => vi.unstubAllGlobals())
function fixture() {
  const data: SpacesSnapshot = {
    ideas: [],
    discussions: [],
    activeId: null,
    agent: { ...IDLE_AGENT, provider: 'codex' },
    workspaces: [],
    spaceOwners: {},
    documents: [],
  }
  let fail = false
  const request = vi.fn(async (input: SpacesInput): Promise<SpacesReply> => {
    if (input.action === 'create_discussion')
      data.discussions!.push({
        id: input.id,
        title: input.title,
        recordKind: 'discussion',
        sharedSpaceId: input.spaceId,
        workspaceId: null,
        revision: 1,
        text: '',
        plan: '',
        stage: 'brainstorm',
        noteIds: [],
        assignments: [],
        conversationId: null,
        prepared: null,
        at: 1,
      } as SpaceIdea)
    if (input.action === 'chat') {
      if (fail) return { ok: false, reason: 'Synthetic failure' }
      data.activeId = input.id
      data.agent = {
        ...data.agent,
        conversationId: 'codex:owned',
        status: 'ready',
        items: [{ kind: 'you', text: input.text }],
      }
    }
    return {
      ok: true,
      snapshot: structuredClone(data),
      ...(input.action === 'create_discussion' ? { discussionId: input.id } : {}),
    }
  })
  const api = {
    onSpaces: vi.fn(() => () => {}),
    spacesRespond: vi.fn(async () => ({ ok: true as const })),
    spacesLiveStart: vi.fn(async () => ({ ok: true as const, sdp: 'v=0\nanswer' })),
    spacesLiveStop: vi.fn(),
    onAgentLive: vi.fn(() => () => {}),
  }
  const client = new BrainstormAgent(space, data, api, request, new Map())
  return {
    client,
    data,
    api,
    request,
    fail: () => {
      fail = true
    },
  }
}
it('keeps the Agent interface project-bound and does not expose a different active project', async () => {
  const f = fixture()
  f.data.activeId = foreign
  f.data.agent = {
    ...f.data.agent,
    conversationId: 'codex:foreign',
    items: [{ kind: 'agent', text: 'Private other-project content' }],
  }
  expect((await f.client.getAgent()).items).toEqual([])
  expect((await f.client.getAgent()).conversationId).toBeNull()
  expect(await f.client.agentReadPage(foreign)).toMatchObject({
    error: expect.stringContaining('outside'),
  })
  expect(f.request.mock.calls.every(([input]) => input.action === 'list')).toBe(true)
  await f.client.agentLiveStart('native-session', 'v=0\noffer')
  expect(f.api.spacesLiveStart).toHaveBeenCalledWith('native-session', 'v=0\noffer', space, null)
})
it('preserves a typed message when creation succeeds but the provider fails', async () => {
  const f = fixture()
  f.client.writeDraft('Keep this exact thought')
  f.fail()
  expect(await f.client.agentSend('Keep this exact thought')).toMatchObject({ ok: false })
  expect(f.client.readDraft()).toBe('Keep this exact thought')
  expect(f.data.discussions).toHaveLength(1)
  f.data.activeId = f.client.selection
  f.data.agent = {
    ...f.data.agent,
    conversationId: 'codex:old',
    ended: true,
    items: [{ kind: 'agent', text: 'Previous conversation' }],
  }
  const state = await f.client.getAgent()
  expect(state.items).toEqual([])
  expect(state.conversationId).toBeNull()
  expect(state.error).toBe('Synthetic failure')
  await f.client.agentSend('Keep this exact thought')
  expect(f.data.discussions).toHaveLength(1)
})
it('routes spoken messages without consuming a separate new-chat typed draft', async () => {
  const f = fixture()
  f.client.writeDraft('Unsent typed idea')
  expect(await f.client.agentSend('Spoken idea')).toEqual({ ok: true })
  expect(f.data.discussions).toHaveLength(1)
  expect(f.client.readDraft()).toBe('')
  f.client.select(null)
  expect(f.client.readDraft()).toBe('Unsent typed idea')
  expect(f.request.mock.calls.find(([input]) => input.action === 'chat')?.[0]).toMatchObject({
    text: 'Spoken idea',
    compareSpaceIds: [],
  })
})

it('waits for End acknowledgement before clearing the discussion and permits retry after a failed End', async () => {
  const f = fixture()
  await f.client.agentSend('Discussion')
  const id = f.client.selection
  let release!: () => void
  f.request.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = () => resolve({ ok: true, snapshot: structuredClone(f.data) })
      }),
  )
  f.client.agentClose()
  expect(f.client.selection).toBe(id)
  expect(await f.client.agentSend('Too soon')).toMatchObject({ ok: false })
  release()
  await vi.waitFor(() => expect(f.client.selection).toBeNull())
  f.client.select(id)
  f.request.mockResolvedValueOnce({ ok: false, reason: 'Still changing discussion' } as never)
  f.client.agentClose()
  await vi.waitFor(async () =>
    expect((await f.client.getAgent()).error).toBe('Still changing discussion'),
  )
  expect(f.client.selection).toBe(id)
})
