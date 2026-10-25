import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CodexAgentRun, readCodexHistory } from '../src/main/agent/codexAgentRun'
import type { CodexTransport, RpcId } from '../src/main/agent/codexClient'
import { chooseModel, discoverModels } from '../src/main/agent/agentModels'
import { codexRequest } from '../src/main/agent/codexRequests'
import { codexPolicy, verifyCodexPolicy } from '../src/main/agent/codexPolicy'
import { AgentStore } from '../src/main/agent/agentStore'
import { AgentService } from '../src/main/agent/agentService'
import { DEFAULT_SETTINGS } from '../src/shared/settings'
import type { JsonObject } from '../src/main/sessions/json'

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
    run.close()
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
    run.close()
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
    resumed.close()
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
    run.close()
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
    run.close()
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
    resumed.close()
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
    run.close()
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
  fake.complete()
  await expect.poll(() => service.current.status).toBe('ready')
  expect(await service.send('Follow up')).toEqual({ ok: true })
  expect(service.current.model).toBe('future-fast')
  expect(claudeCalls).toBe(0)
  expect((await service.history())[0]?.provider).toBe('codex')
  service.close()
})
