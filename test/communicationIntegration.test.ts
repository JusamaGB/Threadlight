import { randomUUID } from 'node:crypto'
import { backup } from 'node:sqlite'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { MemoryStore } from '../src/main/memory/store'
import { MemoryServer } from '../src/main/memory/server'
import { CommunicationService } from '../src/main/communication/service'
import { OwnedRequests } from '../src/main/communication/ownedRequests'
import { Holds } from '../src/main/holds'
import type { AgentService } from '../src/main/agent/agentService'
import { IDLE_AGENT, type AgentState } from '../src/shared/agent'
import type { CommunicationMessage, Workflow } from '../src/shared/communication'
import type { MemorySpace } from '../src/shared/memory'
import { sandbox } from './helpers'

describe('Communication real callers, recovery and native capabilities', () => {
  it('serves the exact scoped tool inventory, persists backup replay IDs, and revokes owned capabilities', async () => {
    const box = await sandbox(),
      memory = new MemoryStore(join(box.root, 'memory.sqlite')),
      server = new MemoryServer(memory)
    const target = `codex:${randomUUID()}`,
      human = { id: 'human', kind: 'human' as const }
    const space = memory.execute({
      action: 'create_space',
      operationId: randomUUID(),
      title: 'Test project',
    }) as MemorySpace
    const service = new CommunicationService(memory.communications, {
      destinations: async () => [
        {
          id: target,
          title: 'Target',
          provider: 'codex',
          hostId: 'local',
          workspace: box.root,
          model: 'test',
          state: 'idle',
          generation: 'test',
          send: false,
          queue: false,
          reason: 'Inbox only',
          observedAt: Date.now(),
        },
      ],
      deliver: async () => {
        throw new Error('Not admitted')
      },
      authorize: (a, id) => memory.authorizeCommunication(a, id),
      input: (a, id, r) => memory.communicationInput(a, id, r),
      project: (id) => memory.space(id),
    })
    memory.communicationService = service
    try {
      const workflow: Workflow = {
        id: randomUUID(),
        spaceId: space.id,
        revision: 1,
        mode: 'manual',
        paused: true,
        participants: [
          {
            id: randomUUID(),
            target,
            role: 'Build',
            model: 'test',
            communicate: true,
            requestWork: true,
          },
        ],
        maxConcurrent: 1,
        maxDispatches: 5,
        expiresAt: Date.now() + 60000,
        recover: false,
        acceptBy: 'human',
      }
      service.configure(workflow, 0, human)
      await server.start(0)
      const connection = server.connectCommunication(() => ({ id: 'agent-one', kind: 'agent' }))
      const rpc = async (method: string, params?: unknown) =>
        fetch(connection.endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${connection.token}`,
          },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        })
      const inventory = (await (await rpc('tools/list')).json()) as {
        result: { tools: { name: string }[] }
      }
      expect(
        inventory.result.tools.some((t: { name: string }) => t.name === 'threadlight_send_message'),
      ).toBe(true)
      expect(
        inventory.result.tools.some((t: { name: string }) => t.name === 'memory_create_item'),
      ).toBe(false)
      const input = {
        operationId: randomUUID(),
        targets: [target],
        body: 'Saved once',
        spaceId: space.id,
      }
      const response = (await (
        await rpc('tools/call', { name: 'threadlight_send_message', arguments: input })
      ).json()) as { result: { isError: boolean; content: { text: string }[] } }
      expect(response.result.isError).toBe(false)
      const message = JSON.parse(response.result.content[0]!.text) as CommunicationMessage
      const savedCursor = memory.communications.cursor()
      const path = join(box.root, 'backup.sqlite')
      await backup(memory.databaseForBackup(), path)
      memory.restoreFrom(path)
      server.revokeCommunication()
      expect((await rpc('tools/list')).status).toBe(401)
      const replay = (await service.execute('send_message', input, {
        id: 'agent-one',
        kind: 'agent',
      })) as CommunicationMessage
      expect(replay.id).toBe(message.id)
      expect(memory.communications.list('message')).toHaveLength(1)
      expect(service.workflow(space.id)?.paused).toBe(true)
      expect(memory.communications.cursor()).toBeGreaterThan(savedCursor)
      expect(memory.communications.events().some((e) => e.action === 'Message queued')).toBe(true)
      memory.execute({
        action: 'update_space',
        operationId: randomUUID(),
        id: space.id,
        paused: false,
        maxDispatches: 1,
        durationMinutes: 1,
      })
      expect(() =>
        memory.reserveCommunication(space.id, () => {
          throw new Error('Database write failed')
        }),
      ).toThrow('Database write')
      expect(memory.space(space.id).dispatches).toBe(0)
      memory.reserveCommunication(space.id, () => {})
      expect(memory.space(space.id).dispatches).toBe(1)
      expect(() => memory.reserveCommunication(space.id, () => {})).toThrow('budget')
    } finally {
      service.close()
      server.close()
      memory.close()
      await box.cleanup()
    }
  })
  it('a replaced Claude question cannot inherit the old response capability', () => {
    const holds = new Holds(() => {}),
      replies: (string | null)[] = []
    const payload = {
      session_id: randomUUID(),
      tool_name: 'AskUserQuestion',
      tool_input: {
        questions: [
          { question: 'Which colour?', options: [{ label: 'Blue' }, { label: 'Green' }] },
        ],
      },
    }
    try {
      holds.holdQuestion(payload, (body) => replies.push(body))
      const old = holds.communicationRequests()[0]!
      holds.holdQuestion(payload, (body) => replies.push(body))
      const current = holds.communicationRequests()[0]!
      expect(current.id).not.toBe(old.id)
      expect(
        holds.respondCommunication(old.id, old.generation, {
          action: 'answer',
          answers: { 'Which colour?': 'Blue' },
        }).ok,
      ).toBe(false)
      expect(
        holds.respondCommunication(current.id, current.generation, {
          action: 'answer',
          answers: { 'Which colour?': 'Green' },
        }).ok,
      ).toBe(true)
      expect(replies.at(-1)).toContain('Green')
    } finally {
      holds.releaseAll()
    }
  })
  it('keeps owned RPC handles ephemeral and excludes secret questions', () => {
    const state: AgentState = {
      ...IDLE_AGENT,
      sessionId: randomUUID(),
      conversationId: randomUUID(),
      provider: 'codex',
      requests: [
        {
          id: 'epoch:wire-1',
          title: 'Which colour?',
          detail: 'Choose a colour',
          kind: 'questions',
          canAllow: false,
          questions: [{ id: 'colour', text: 'Colour', options: ['Blue'], other: true }],
        },
      ],
    }
    const respond = vi.fn(() => ({ ok: true })),
      owner = { current: state, respond } as unknown as AgentService
    const adapter = new OwnedRequests(() => [owner]),
      request = adapter.list()[0]!
    expect(
      adapter.respond(request.id, request.generation, {
        action: 'answer',
        answers: { colour: 'Blue' },
      }).ok,
    ).toBe(true)
    expect(respond).toHaveBeenCalledWith('epoch:wire-1', {
      action: 'answer',
      answers: { colour: 'Blue' },
    })
    state.requests[0]!.questions![0]!.secret = true
    expect(adapter.list()).toEqual([])
    expect(adapter.respond(request.id, request.generation, { action: 'allow' }).ok).toBe(false)
  })
})
