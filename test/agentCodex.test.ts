import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { CodexAgentRun, readCodexHistory } from '../src/main/agent/codexAgentRun'
import type { CodexTransport, RpcId } from '../src/main/agent/codexClient'
import { chooseModel, discoverModels } from '../src/main/agent/agentModels'
import { codexRequest } from '../src/main/agent/codexRequests'
import { codexPolicy, verifyCodexPolicy } from '../src/main/agent/codexPolicy'
import { AgentStore } from '../src/main/agent/agentStore'
import { AgentService } from '../src/main/agent/agentService'
import { DEFAULT_SETTINGS } from '../src/shared/settings'
import type { JsonObject } from '../src/main/sessions/json'
import { archiveAgentConversation } from '../src/main/agent/agentArchive'

const models = [
  {
    model: 'future-fast',
    displayName: 'Future Fast',
    isDefault: true,
    hidden: false,
    supportedReasoningEfforts: [{ reasoningEffort: 'low' }],
    defaultReasoningEffort: 'low',
    inputModalities: ['text'],
  },
  {
    model: 'future-deep',
    displayName: 'Future Deep',
    isDefault: false,
    hidden: true,
    supportedReasoningEfforts: [{ reasoningEffort: 'ultra' }],
    defaultReasoningEffort: 'ultra',
    inputModalities: ['text'],
  },
]
class Fake implements CodexTransport {
  onEvent: CodexTransport['onEvent'] = () => {}
  onFailure: CodexTransport['onFailure'] = () => {}
  calls: { method: string; params: JsonObject }[] = []
  replies: { id: RpcId; result: JsonObject }[] = []
  closed = false
  turn = 0
  history: JsonObject[] = []
  handler?: (method: string, params: JsonObject) => Promise<JsonObject | undefined>
  async request(method: string, params: JsonObject = {}): Promise<JsonObject> {
    this.calls.push({ method, params })
    const custom = await this.handler?.(method, params)
    if (custom) return custom
    if (method === 'model/list')
      return {
        data: params.cursor ? [models[1]] : [models[0]],
        nextCursor: params.cursor ? null : 'second',
      }
    if (method === 'config/read') return { config: { mcp_servers: {}, plugins: {}, apps: {} } }
    if (method === 'account/read') return { account: { type: 'chatgpt' } }
    if (method === 'thread/start' || method === 'thread/resume')
      return {
        thread: { id: 'owned-thread', status: { type: 'idle' } },
        model: params.model,
        approvalPolicy: 'untrusted',
        approvalsReviewer: 'user',
        sandbox: { type: 'readOnly' },
      }
    if (method === 'turn/start') {
      const id = `turn-${++this.turn}`
      this.emit('turn/started', { turn: { id } })
      return { turn: { id } }
    }
    if (method === 'thread/items/list') return { data: this.history, nextCursor: null }
    if (method === 'mcpServerStatus/list') return { data: [], nextCursor: null }
    if (method === 'turn/interrupt') {
      this.complete('interrupted')
      return {}
    }
    return {}
  }
  respond(id: RpcId, result: JsonObject) {
    this.replies.push({ id, result })
  }
  close() {
    this.closed = true
  }
  emit(method: string, params: JsonObject = {}, id?: RpcId) {
    this.onEvent(method, { threadId: 'owned-thread', ...params }, id)
  }
  complete(status = 'completed') {
    this.emit('turn/completed', { turn: { id: `turn-${this.turn}`, status } })
  }
}
async function fixture() {
  const folder = await mkdtemp(join(tmpdir(), 'threadlight-agent-test-'))
  const store = new AgentStore(join(folder, 'index.json'))
  const fake = new Fake()
  const options = {
    client: async () => fake,
    workspace: folder,
    model: 'future-deep',
    reasoning: 'ultra',
    appsOff: [],
    store,
    briefing: () => '<threadlight-briefing>synthetic</threadlight-briefing>',
    lifetimeMinutes: () => 0,
    onChange: () => {},
  }
  return { fake, store, options, run: new CodexAgentRun(options), folder }
}
const settle = async (run: CodexAgentRun) => expect.poll(() => run.current.status).toBe('ready')

describe('Codex agent', () => {
  it('archives once on End, retains Agent history and restores the same conversation on Continue', async () => {
    const { run, fake, store, options } = await fixture()
    await run.send('Keep my history')
    fake.complete()
    await settle(run)
    const id = run.current.conversationId!
    await Promise.all([run.close(), run.close()])
    expect(fake.calls.filter((c) => c.method === 'thread/archive')).toEqual([
      { method: 'thread/archive', params: { threadId: 'owned-thread' } },
    ])
    expect(store.get(id)).toMatchObject({
      title: 'Keep my history',
      archiveState: 'archived',
      pending: null,
    })
    expect(run.current.ended).toBe(true)
    expect((await run.send('Too late')).ok).toBe(false)
    const next = new Fake()
    const resumed = new CodexAgentRun({
      ...options,
      record: store.get(id)!,
      client: async () => next,
    })
    await resumed.prepareResume()
    expect(next.calls.find((c) => c.method === 'thread/unarchive')?.params).toEqual({
      threadId: 'owned-thread',
    })
    expect(next.calls.find((c) => c.method === 'thread/resume')?.params.threadId).toBe(
      'owned-thread',
    )
    expect(next.calls.some((c) => c.method === 'thread/start')).toBe(false)
    expect(store.get(id)?.archiveState).toBeUndefined()
    await resumed.close()
  })

  it('restarts the inactivity window after replies and never expires while working or awaiting permission', async () => {
    const { fake, options, store } = await fixture()
    const run = new CodexAgentRun({ ...options, lifetimeMinutes: () => 1 })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      await run.send('First')
      fake.complete()
      await vi.waitFor(() => expect(run.current.status).toBe('ready'))
      await vi.advanceTimersByTimeAsync(30_000)
      await run.send('Follow up')
      fake.emit('item/fileChange/requestApproval', { turnId: 'turn-2' }, 7)
      await vi.advanceTimersByTimeAsync(120_000)
      expect(run.current.status).toBe('waiting')
      expect(fake.calls.some((c) => c.method === 'thread/archive')).toBe(false)
      fake.complete()
      await vi.waitFor(() => expect(run.current.status).toBe('ready'))
      await vi.advanceTimersByTimeAsync(59_000)
      expect(run.current.ended).toBe(false)
      await vi.advanceTimersByTimeAsync(1_000)
      await run.close() // wait for the expiry's asynchronous archive
      expect(store.all()[0]?.archiveState).toBe('archived')
      expect(fake.calls.filter((c) => c.method === 'thread/start')).toHaveLength(1)
    } finally {
      vi.useRealTimers()
      await run.close()
    }
  })

  it('keeps failed archiving retryable without losing uncertain input', async () => {
    const { run, fake, store } = await fixture()
    await run.send('Unconfirmed work')
    fake.handler = async (method) => {
      if (method === 'thread/archive') throw new Error('offline')
      return undefined
    }
    await run.close()
    const record = store.all()[0]!
    expect(record).toMatchObject({ archiveState: 'pending', pending: { text: 'Unconfirmed work' } })
    expect(run.current.error).toContain('archiving failed')
    const cleanup = new Fake()
    await archiveAgentConversation(store, record.id, async () => cleanup)
    expect(store.get(record.id)).toMatchObject({
      archiveState: 'archived',
      pending: { text: 'Unconfirmed work' },
    })
    await expect(archiveAgentConversation(store, 'not-owned', async () => cleanup)).rejects.toThrow(
      'Unknown',
    )
    expect(cleanup.calls.filter((c) => c.method === 'thread/archive')).toHaveLength(1)
  })

  it('archives a thread whose creation finishes after End was clicked', async () => {
    const { run, fake, store } = await fixture()
    let finish: (result: JsonObject) => void = () => {}
    let started: () => void = () => {}
    const arrived = new Promise<void>((resolve) => {
      started = resolve
    })
    fake.handler = async (method, params) => {
      if (method !== 'thread/start') return undefined
      started()
      return new Promise((resolve) => {
        finish = (result) => resolve({ ...result, model: params.model })
      })
    }
    const sending = run.send('Never submitted')
    await arrived
    const closing = run.close()
    finish({ thread: { id: 'owned-thread' } })
    expect((await sending).ok).toBe(false)
    await closing
    expect(store.all()[0]?.archiveState).toBe('archived')
    expect(fake.calls.some((c) => c.method === 'turn/start')).toBe(false)
  })

  it('discovers all pages and validates exact model/effort without a fixed model list', async () => {
    const fake = new Fake(),
      catalog = await discoverModels(fake)
    expect(catalog.map((m) => m.id)).toEqual(['future-fast', 'future-deep'])
    expect(chooseModel(catalog, null, null)).toEqual({ model: 'future-fast', reasoning: 'low' })
    expect(() => chooseModel(catalog, 'gone', null)).toThrow('unavailable')
    expect(() => chooseModel(catalog, 'future-fast', 'ultra')).toThrow('reasoning')
    fake.handler = async (m) => (m === 'model/list' ? { data: [], nextCursor: 'again' } : undefined)
    await expect(discoverModels(fake)).rejects.toThrow('pagination')
  })

  it('pins selection, journals before submission, streams without duplicate final output and follows up', async () => {
    const { run, fake, store } = await fixture()
    fake.handler = async (method) => {
      if (method === 'turn/start') expect(store.all()[0]?.pending?.text).toBeTruthy()
      return undefined
    }
    expect(await run.send('First')).toEqual({ ok: true })
    expect(fake.calls.find((c) => c.method === 'thread/start')?.params).toMatchObject({
      model: 'future-deep',
      sandbox: 'read-only',
      approvalPolicy: 'untrusted',
    })
    expect(fake.calls.find((c) => c.method === 'turn/start')?.params).toMatchObject({
      model: 'future-deep',
      effort: 'ultra',
    })
    fake.emit('item/agentMessage/delta', { turnId: 'turn-1', itemId: 'reply', delta: 'Hello' })
    fake.emit('item/completed', {
      turnId: 'turn-1',
      item: { id: 'reply', type: 'agentMessage', text: 'Hello world' },
    })
    fake.complete()
    await settle(run)
    expect(run.current.items.filter((i) => i.kind === 'agent')).toEqual([
      { id: 'reply', kind: 'agent', text: 'Hello world' },
    ])
    expect(store.all()[0]?.pending).toBeNull()
    expect(await run.send('Next')).toEqual({ ok: true })
    expect(fake.calls.filter((c) => c.method === 'thread/start')).toHaveLength(1)
    expect(fake.calls.filter((c) => c.method === 'turn/start')).toHaveLength(2)
    await run.close()
  })

  it('queues typed request IDs, rejects stale/double responses and stops without approving', async () => {
    const { run, fake } = await fixture()
    await run.send('Synthetic actions')
    const params = { turnId: 'turn-1', itemId: 'tool-1', command: 'synthetic command' }
    fake.emit('item/commandExecution/requestApproval', params, 7)
    fake.emit('item/fileChange/requestApproval', { ...params, itemId: 'tool-2' }, '7')
    expect(run.current.requests).toHaveLength(2)
    const [first, second] = run.current.requests
    expect(run.respond(second!.id, { action: 'allow' }).ok).toBe(false)
    expect(run.respond(first!.id, { action: 'deny' }).ok).toBe(true)
    expect(run.respond(first!.id, { action: 'allow' }).ok).toBe(false)
    expect(fake.replies).toEqual([{ id: 7, result: { decision: 'decline' } }])
    await run.interrupt()
    await expect.poll(() => run.current.status).toBe('interrupted')
    expect(fake.replies).toHaveLength(1)
    expect(run.respond(second!.id, { action: 'allow' }).ok).toBe(false)
    await run.close()
  })

  it('keeps uncertain sends and never automatically replays after process loss', async () => {
    const { run, fake, store, options } = await fixture()
    fake.handler = async (method) => {
      if (method === 'turn/start') throw new Error('connection lost')
      return undefined
    }
    expect((await run.send('Keep this message')).ok).toBe(false)
    expect(store.all()[0]?.pending?.text).toBe('Keep this message')
    expect((await run.send('Again')).ok).toBe(false)
    expect(fake.calls.filter((c) => c.method === 'turn/start')).toHaveLength(1)
    const recovered = new Fake(),
      record = store.all()[0]!
    recovered.history = [
      {
        item: {
          id: 'item',
          clientId: record.pending!.id,
          type: 'userMessage',
          content: [{ text: 'Keep this message' }],
        },
      },
    ]
    const resumed = new CodexAgentRun({ ...options, record, client: async () => recovered })
    await resumed.prepareResume()
    expect(store.get(record.id)?.pending).toBeNull()
    expect(recovered.calls.some((c) => c.method === 'turn/start')).toBe(false)
    expect(recovered.calls.find((c) => c.method === 'thread/resume')?.params.threadId).toBe(
      record.providerId,
    )
    await resumed.close()
  })

  it('rejects unsafe effective permissions before sending and ignores events after close', async () => {
    const { run, fake } = await fixture()
    fake.handler = async (method) =>
      method === 'thread/start'
        ? {
            thread: { id: 'owned-thread' },
            model: 'future-deep',
            approvalPolicy: 'never',
            approvalsReviewer: 'user',
            sandbox: { type: 'dangerFullAccess' },
          }
        : undefined
    expect((await run.send('Never execute')).ok).toBe(false)
    expect(fake.calls.some((c) => c.method === 'turn/start')).toBe(false)
    await run.close()
    fake.emit('item/completed', { item: { type: 'agentMessage', text: 'Late' } })
    expect(run.current.items).toEqual([])
  })

  it('does not replace a queued approval with an unknown request or auto-approve it', async () => {
    const { run, fake } = await fixture()
    await run.send('Go')
    fake.emit('future/requestApproval', { turnId: 'turn-1' }, 'unknown')
    expect(run.current.status).toBe('error')
    expect(fake.closed).toBe(true)
    expect(fake.replies).toEqual([])
  })

  it('rejects an old card when the same conversation is resumed with reused wire IDs', async () => {
    const { run, fake, store, options } = await fixture()
    await run.send('First action')
    fake.emit('item/fileChange/requestApproval', { turnId: 'turn-1' }, 7)
    const stale = run.current.requests[0]!.id
    fake.complete()
    await settle(run)
    await run.close()
    const next = new Fake()
    const resumed = new CodexAgentRun({
      ...options,
      record: store.all()[0]!,
      client: async () => next,
    })
    await resumed.prepareResume()
    await resumed.send('Second action')
    next.emit('item/fileChange/requestApproval', { turnId: 'turn-1' }, 7)
    expect(resumed.current.requests[0]!.id).not.toBe(stale)
    expect(resumed.respond(stale, { action: 'allow' }).ok).toBe(false)
    expect(next.replies).toEqual([])
    await resumed.close()
  })

  it('preserves paginated history order without resuming the thread', async () => {
    const fake = new Fake()
    fake.history = [
      { item: { type: 'agentMessage', id: 'a', text: 'Reply' } },
      {
        item: {
          type: 'userMessage',
          id: 'u',
          content: [{ text: '<threadlight-briefing>x</threadlight-briefing>\n\nHello' }],
        },
      },
    ]
    expect((await readCodexHistory(fake, 'owned-thread')).items.map((i) => i.text)).toEqual([
      'Hello',
      'Reply',
    ])
    expect(fake.calls.map((c) => c.method)).toEqual(['thread/items/list'])
  })

  it('writes an atomic provider-aware index and rejects a malformed file', async () => {
    const { run, store, folder, fake } = await fixture()
    await run.send('Index test')
    fake.complete()
    await settle(run)
    const reopened = new AgentStore(join(folder, 'index.json'))
    await reopened.load()
    expect(reopened.all()).toEqual(store.all())
    expect(await readFile(join(folder, 'index.json'), 'utf8')).not.toContain('threadlight-briefing')
    await run.close()
    await writeFile(join(folder, 'corrupt.json'), '{broken')
    const corrupt = new AgentStore(join(folder, 'corrupt.json'))
    await expect(corrupt.load()).rejects.toThrow()
    await expect(corrupt.put(store.all()[0]!)).rejects.toThrow()
    expect(await readFile(join(folder, 'corrupt.json'), 'utf8')).toBe('{broken')
  })

  it('rejects an integration outside the configured policy before inference', async () => {
    const { run, fake } = await fixture()
    fake.handler = async (method) =>
      method === 'mcpServerStatus/list'
        ? { data: [{ name: 'unexpected-plugin', runtimeStatus: 'connected' }], nextCursor: null }
        : undefined
    expect(await run.send('No tools may run')).toMatchObject({
      ok: false,
      reason: expect.stringContaining('outside the Agent app policy'),
    })
    expect(fake.calls.some((c) => c.method === 'turn/start')).toBe(false)
    expect(fake.closed).toBe(true)
  })
})

describe('request response contracts', () => {
  it('submits every question explicitly and validates available choices', () => {
    const request = codexRequest(
      'item/tool/requestUserInput',
      {
        questions: [
          {
            id: 'q',
            question: 'Which?',
            isOther: false,
            options: [{ label: 'Blue' }, { label: 'Green' }],
          },
        ],
      },
      'key',
    )!
    expect(() => request.respond({ action: 'answer', answers: {} })).toThrow()
    expect(() => request.respond({ action: 'answer', answers: { q: 'Red' } })).toThrow()
    expect(request.respond({ action: 'answer', answers: { q: 'Blue' } })).toEqual({
      answers: { q: { answers: ['Blue'] } },
    })
  })
  it('limits grants to the requested permissions and the current turn', () => {
    const request = codexRequest(
      'item/permissions/requestApproval',
      { permissions: { network: { enabled: true }, fileSystem: null, unexpected: 'ignored' } },
      'key',
    )!
    expect(request.respond({ action: 'allow' })).toEqual({
      permissions: { network: { enabled: true } },
      scope: 'turn',
    })
    expect(request.respond({ action: 'deny' })).toEqual({ permissions: {}, scope: 'turn' })
  })
  it('supports basic MCP forms and refuses unsupported forms and URL acceptance', () => {
    const request = codexRequest(
      'mcpServer/elicitation/request',
      {
        mode: 'form',
        requestedSchema: {
          type: 'object',
          required: ['name'],
          properties: { name: { type: 'string' } },
        },
      },
      'form',
    )!
    expect(request.respond({ action: 'answer', answers: { name: 'Synthetic' } })).toEqual({
      action: 'accept',
      content: { name: 'Synthetic' },
      _meta: null,
    })
    const url = codexRequest(
      'mcpServer/elicitation/request',
      { mode: 'url', url: 'https://example.test' },
      'url',
    )!
    expect(url.view.canAllow).toBe(false)
    expect(() => url.respond({ action: 'allow' })).toThrow()
    expect(url.respond({ action: 'deny' })).toMatchObject({ action: 'decline' })
  })
  it('overrides inherited MCP approvals locally without enabling disabled integrations', async () => {
    const fake = new Fake()
    fake.handler = async (method) =>
      method === 'config/read'
        ? {
            config: {
              mcp_servers: {
                'test.with.dot': {
                  command: 'synthetic',
                  tool_timeout_sec: null,
                  enabled: false,
                  tools: { write: { approval_mode: 'approve', enabled: false } },
                },
              },
              plugins: { 'desktop@test': { enabled: true } },
              apps: { mail: { enabled: true } },
            },
          }
        : undefined
    const { config } = await codexPolicy(fake, 'C:/synthetic', [])
    expect(config.mcp_servers).toEqual({
      'test.with.dot': {
        command: 'synthetic',
        enabled: false,
        default_tools_approval_mode: 'prompt',
        tools: { write: { enabled: false, approval_mode: 'prompt' } },
      },
    })
    expect(config.plugins).toEqual({ 'desktop@test': { enabled: false } })
    expect(config['features.hooks']).toBe(false)
    expect(config['features.default_mode_request_user_input']).toBe(true)
    expect(fake.calls.map((c) => c.method)).toEqual(['config/read'])
    expect(() => verifyCodexPolicy({ model: 'other' }, 'expected')).toThrow('different model')
  })
})

it('runs Codex without Claude installed or monitoring enabled, pins settings, and guards concurrent sends', async () => {
  const { folder, fake } = await fixture()
  const settings = {
    ...DEFAULT_SETTINGS,
    enabledProviders: [],
    agentProvider: 'codex' as const,
    agentCodexModel: 'future-fast',
  }
  let claudeCalls = 0
  const service = new AgentService({
    workspace: folder,
    index: join(folder, 'service-index.json'),
    claudeProjects: folder,
    settings: () => settings,
    snapshot: () => ({
      sessions: [],
      workspaces: [],
      allWorkspaces: [],
      currentWorkspace: null,
      currentThreadId: null,
    }),
    cli: async () => {
      claudeCalls++
      return null
    },
    codexClient: async () => fake,
    onChange: () => {},
    onRateLimit: () => {},
  })
  const first = service.send('First')
  expect((await service.send('Duplicate')).ok).toBe(false)
  expect(await first).toEqual({ ok: true })
  settings.agentCodexModel = 'future-deep'
  service.refreshDefaults()
  expect(service.current.model).toBe('future-fast')
  fake.complete()
  await expect.poll(() => service.current.status).toBe('ready')
  expect(await service.send('Follow up')).toEqual({ ok: true })
  expect(service.current.model).toBe('future-fast')
  expect(claudeCalls).toBe(0)
  expect((await service.history())[0]?.provider).toBe('codex')
  fake.complete()
  await expect.poll(() => service.current.status).toBe('ready')
  const conversation = (await service.history())[0]!
  await service.close()
  expect(service.current.model).toBe('future-deep')
  const retained = service.current.items
  settings.agentCodexReasoning = 'ultra'
  service.refreshDefaults()
  expect(service.current).toMatchObject({
    model: 'future-deep',
    reasoning: 'ultra',
    ended: true,
    items: retained,
  })
  expect((await service.history())[0]?.id).toBe(conversation.id)
  expect(service.store.get(conversation.id)?.archiveState).toBe('archived')
  fake.history = [{ item: { type: 'agentMessage', id: 'reply', text: 'Saved reply' } }]
  expect((await service.read(conversation.id)).items[0]?.text).toBe('Saved reply')
  expect(fake.calls.some((c) => c.method === 'thread/unarchive')).toBe(false)
  expect(await service.resume(conversation.id)).toEqual({ ok: true })
  expect(service.current.conversationId).toBe(conversation.id)
  expect(fake.calls.filter((c) => c.method === 'thread/start')).toHaveLength(1)
  await service.close()
})

describe('native Live voice', () => {
  const voiceId = '11111111-2222-3333-4444-555555555555'
  const offer = 'v=0\r\nsynthetic-offer'
  const answer = 'v=0\r\nsynthetic-answer'
  function connect(fake: Fake) {
    fake.handler = async (method) => {
      if (method === 'thread/realtime/start') {
        fake.emit('thread/realtime/started', { version: 'v3' })
        fake.emit('thread/realtime/sdp', { sdp: answer })
        return {}
      }
    }
  }

  it('prepares without sending, sends the opening once, retains voice history, and stops before archiving', async () => {
    const { run, fake, store } = await fixture()
    connect(fake)
    expect(await run.startLive(voiceId, offer)).toBe(answer)
    expect(fake.calls.find((c) => c.method === 'thread/realtime/start')?.params).toMatchObject({
      transport: { type: 'webrtc', sdp: offer },
      flushTranscriptTailOnSessionEnd: false,
    })
    expect(
      fake.calls.some(
        (c) => c.method === 'turn/start' || c.method === 'thread/realtime/appendSpeech',
      ),
    ).toBe(false)
    expect(await run.openLive('Please review this with me')).toEqual({ ok: true })
    expect((await run.openLive('Duplicate')).ok).toBe(false)
    expect((await run.send('Typed fallback')).ok).toBe(false)
    expect(fake.calls.filter((c) => c.method === 'turn/start')).toHaveLength(1)
    expect(
      fake.calls.some((c) =>
        [
          'thread/inject_items',
          'thread/realtime/appendText',
          'thread/realtime/appendSpeech',
        ].includes(c.method),
      ),
    ).toBe(false)
    fake.emit('thread/realtime/item/started', {
      item: { type: 'transcriptSegment', id: 'spoken', role: 'assistant', text: '' },
    })
    fake.emit('thread/realtime/item/transcript/delta', {
      itemId: 'spoken',
      delta: 'A spoken reply',
    })
    expect(run.current.items.at(-1)?.text).toBe('A spoken reply')
    fake.emit('thread/realtime/item/completed', {
      item: { type: 'transcriptSegment', id: 'spoken', role: 'assistant', text: 'A spoken reply' },
    })
    await run.close()
    expect(store.get(run.current.conversationId!)?.liveItems?.map((i) => i.text)).toEqual([
      'Please review this with me',
      'A spoken reply',
    ])
    const methods = fake.calls.map((c) => c.method)
    expect(methods.indexOf('thread/realtime/stop')).toBeLessThan(methods.indexOf('thread/archive'))
  })

  it('retains an uncertain opening without automatically resending it', async () => {
    const { run, fake, store } = await fixture()
    connect(fake)
    await run.startLive(voiceId, offer)
    fake.handler = async (method) => {
      if (method === 'turn/start') throw new Error('connection lost')
    }
    expect((await run.openLive('Keep this message')).ok).toBe(false)
    expect((await run.openLive('Keep this message')).ok).toBe(false)
    await run.close()
    expect(store.get(run.current.conversationId!)?.pending?.text).toBe('Keep this message')
    expect(fake.calls.filter((c) => c.method === 'turn/start')).toHaveLength(1)
  })
  const emptyHandoff = {
    type: 'handoff_request',
    handoff_id: 'handoff-1',
    input_transcript: '',
    active_transcript: [],
  }
  it('executes the opening once with the selected model and clears pending only on completion', async () => {
    const { run, fake, store } = await fixture()
    connect(fake)
    await run.startLive(voiceId, offer)
    await run.openLive('What time is it in Seattle?')
    const id = run.current.items[0]!.id
    fake.emit('thread/realtime/itemAdded', { item: emptyHandoff })
    fake.emit('thread/realtime/itemAdded', { item: emptyHandoff })
    await expect.poll(() => fake.calls.filter((c) => c.method === 'turn/start').length).toBe(1)
    expect(fake.calls.find((c) => c.method === 'turn/start')?.params).toMatchObject({
      threadId: 'owned-thread',
      clientUserMessageId: id,
      model: 'future-deep',
      effort: 'ultra',
      input: [{ type: 'text', text: expect.stringContaining('What time is it in Seattle?') }],
    })
    expect(store.get(run.current.conversationId!)?.pending?.text).toBe(
      'What time is it in Seattle?',
    )
    fake.complete()
    await settle(run)
    expect(store.get(run.current.conversationId!)?.pending).toBeNull()
    fake.emit('thread/realtime/itemAdded', { item: { ...emptyHandoff, handoff_id: 'another' } })
    expect(fake.calls.filter((c) => c.method === 'turn/start')).toHaveLength(1)
    await run.close()
  })

  it('does not launch an opening while its journal write is pending after the microphone closes', async () => {
    const { run, fake, store } = await fixture()
    connect(fake)
    await run.startLive(voiceId, offer)
    let release!: () => void
    const original = store.put.bind(store)
    vi.spyOn(store, 'put').mockImplementationOnce(async (record) => {
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return original(record)
    })
    const opening = run.openLive('Cancelled question')
    await expect.poll(() => !!release).toBe(true)
    const closing = run.close()
    release()
    expect((await opening).ok).toBe(false)
    await closing
    expect(fake.calls.some((c) => c.method === 'turn/start')).toBe(false)
  })

  it('does not fall back to API authentication', async () => {
    const { run, fake } = await fixture()
    fake.handler = async (method) =>
      method === 'account/read' ? { account: { type: 'apiKey' } } : undefined
    await expect(run.startLive(voiceId, offer)).rejects.toThrow('No API-key fallback')
    expect(fake.calls.some((c) => c.method === 'thread/realtime/start')).toBe(false)
    await run.close()
  })

  it('cancels a pending Live handshake without waiting for its timeout', async () => {
    const { run, fake } = await fixture()
    const starting = run.startLive(voiceId, offer)
    const result = expect(starting).rejects.toThrow('closed')
    await expect.poll(() => fake.calls.some((c) => c.method === 'thread/realtime/start')).toBe(true)
    await run.close()
    await result
    expect(run.current.ended).toBe(true)
    expect(fake.calls.some((c) => c.method === 'thread/realtime/appendSpeech')).toBe(false)
  })

  it('propagates native connection errors and never claims the session is ready', async () => {
    const { run, fake } = await fixture()
    fake.handler = async (method) => {
      if (method === 'thread/realtime/start') {
        fake.emit('thread/realtime/error', { message: 'Voice unavailable' })
        return {}
      }
    }
    await expect(run.startLive(voiceId, offer)).rejects.toThrow('Voice unavailable')
    expect(run.current.live).toBeNull()
    await run.close()
  })

  it('protects a working Agent and ignores stop requests from older mic sessions', async () => {
    const { folder, fake } = await fixture()
    connect(fake)
    const service = new AgentService({
      workspace: folder,
      index: join(folder, 'live-service.json'),
      claudeProjects: folder,
      settings: () => ({ ...DEFAULT_SETTINGS, agentProvider: 'codex' }),
      snapshot: () => ({
        sessions: [],
        workspaces: [],
        allWorkspaces: [],
        currentWorkspace: null,
        currentThreadId: null,
      }),
      cli: async () => null,
      codexClient: async () => fake,
      onChange: () => {},
      onRateLimit: () => {},
    })
    await service.send('Existing work')
    const originalId = service.current.conversationId
    expect((await service.startLive(voiceId, offer)).ok).toBe(false)
    expect(fake.calls.some((c) => c.method === 'thread/realtime/start')).toBe(false)
    fake.complete()
    await expect.poll(() => service.current.status).toBe('ready')
    expect(await service.startLive(voiceId, offer)).toEqual({ ok: true, sdp: answer })
    await service.stopLive('older-session-111111')
    expect(service.current.live).toBe('ready')
    expect((await service.openLive('older-session-111111', 'Do not send')).ok).toBe(false)
    expect(service.current.conversationId).toBe(originalId)
    expect(fake.calls.filter((c) => c.method === 'thread/start')).toHaveLength(1)
    expect(await service.openLive(voiceId, 'Voice follow-up')).toEqual({ ok: true })
    await service.stopLive(voiceId)
    expect(service.current.ended).toBe(false)
    expect(service.current.status).toBe('working')
    expect(service.current.live).toBeNull()
    expect(fake.calls.some((c) => c.method === 'thread/archive')).toBe(false)
    const past = (await service.history()).find((r) => r.id === originalId)!
    const opening = service.current.items.find((i) => i.text === 'Voice follow-up')!
    fake.history = [
      {
        item: {
          type: 'userMessage',
          id: opening.id,
          content: [{ type: 'text', text: 'Voice follow-up' }],
        },
      },
    ]
    expect(
      (await service.read(past.id)).items.filter((i) => i.text === 'Voice follow-up'),
    ).toHaveLength(1)
    fake.complete()
    await expect.poll(() => service.current.status).toBe('ready')
    expect(await service.startLive('next-session-111111', offer)).toEqual({ ok: true, sdp: answer })
    await service.stopLive(voiceId)
    expect(service.current.live).toBe('ready')
    await service.stopLive('next-session-111111')
    expect(await service.send('Typed follow-up')).toEqual({ ok: true })
    expect(service.current.conversationId).toBe(originalId)
    await service.close()
    expect(fake.calls.filter((c) => c.method === 'thread/archive')).toHaveLength(1)
  })

  it('cancels pending voice setup without ending or recreating the Agent', async () => {
    const { run, fake } = await fixture()
    connect(fake)
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const handler = fake.handler!
    fake.handler = async (method, params) => {
      if (method === 'account/read') await gate
      return handler(method, params)
    }
    const connecting = run.startLive(voiceId, offer)
    await expect.poll(() => fake.calls.some((c) => c.method === 'account/read')).toBe(true)
    const id = run.current.conversationId
    await run.stopLive()
    release()
    await expect(connecting).rejects.toThrow('cancelled')
    expect(run.current.ended).toBe(false)
    expect(run.current.live).toBeNull()
    expect(fake.calls.some((c) => c.method === 'thread/realtime/start')).toBe(false)
    expect(await run.send('Continue after closing the microphone')).toEqual({ ok: true })
    expect(run.current.conversationId).toBe(id)
    expect(fake.calls.filter((c) => c.method === 'thread/start')).toHaveLength(1)
    await run.close()
  })
})
