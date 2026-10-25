import { mkdtemp, readFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { CodexClient } from '../src/main/agent/codexClient'
import { discoverModels } from '../src/main/agent/agentModels'
import { codexPolicy, verifyCodexPolicy } from '../src/main/agent/codexPolicy'
import { CodexAgentRun, readCodexHistory } from '../src/main/agent/codexAgentRun'
import { AgentStore } from '../src/main/agent/agentStore'
import type { CodexTransport } from '../src/main/agent/codexClient'
import { isObject } from '../src/main/sessions/json'

function trace(client: CodexClient): void {
  if (!process.env.THREADLIGHT_LIVE_TRACE) return
  let handler: CodexTransport['onEvent'] = () => {}
  Object.defineProperty(client, 'onEvent', {
    get: () => (method: string, params: Record<string, unknown>, id?: string | number) => {
      if (!method.startsWith('codex/event/'))
        console.log(
          'Synthetic runtime event:',
          method,
          params.threadId,
          id,
          isObject(params.turn) ? params.turn.status : '',
        )
      handler(method, params, id)
    },
    set: (value: CodexTransport['onEvent']) => {
      handler = value
    },
  })
}

// Opt-in only: ordinary tests never launch an authenticated runtime.
it.skipIf(!process.env.THREADLIGHT_LIVE_CODEX)(
  'discovers the installed Codex catalog without inference',
  async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'threadlight-agent-discovery-'))
    const client = new CodexClient(
      { command: process.env.THREADLIGHT_LIVE_CODEX!, prefixArgs: [] },
      cwd,
    )
    try {
      await client.initialize()
      const models = await discoverModels(client)
      expect(models.length).toBeGreaterThan(0)
      console.log(
        'Codex models:',
        models.map((m) => ({ id: m.id, efforts: m.efforts, default: m.isDefault })),
      )
      if (process.env.THREADLIGHT_LIVE_AGENT) {
        const { config } = await codexPolicy(client, cwd, ['node_repl'])
        const model = models.find((m) => m.isDefault)!.id
        const started = await client.request('thread/start', {
          model,
          cwd,
          sandbox: 'read-only',
          approvalPolicy: 'untrusted',
          approvalsReviewer: 'user',
          config,
        })
        verifyCodexPolicy(started, model)
        console.log('Verified effective policy:', {
          model: started.model,
          sandbox: started.sandbox,
          approval: started.approvalPolicy,
          reviewer: started.approvalsReviewer,
        })
      }
    } finally {
      client.close()
    }
  },
  60_000,
)

it.skipIf(!process.env.THREADLIGHT_LIVE_TURNS)(
  'runs two selected models and resumes the exact owned thread',
  async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'threadlight-agent-turns-'))
    const store = new AgentStore(join(workspace, 'index.json'))
    const connect = async () => {
      const client = new CodexClient(
        { command: process.env.THREADLIGHT_LIVE_CODEX!, prefixArgs: [] },
        workspace,
      )
      await client.initialize()
      trace(client)
      return client
    }
    const discovery = await connect()
    let choices
    try {
      choices = await discoverModels(discovery)
    } finally {
      discovery.close()
    }
    const models = [
      choices.find((m) => /luna/.test(m.id) && !m.hidden)!,
      choices.find((m) => m.isDefault)!,
    ]
    expect(models[0]!.id).not.toBe(models[1]!.id)
    for (const model of models) {
      const options = {
        client: connect,
        workspace,
        model: model.id,
        reasoning: model.efforts[0] ?? null,
        appsOff: ['node_repl'],
        store,
        briefing: () => '',
        lifetimeMinutes: () => 0,
        onChange: () => {},
      }
      const run = new CodexAgentRun(options)
      try {
        expect(
          await run.send('What is 2 plus 2? Answer in a short sentence without tools.'),
        ).toEqual({ ok: true })
        await expect.poll(() => run.current.status, { timeout: 90_000 }).toBe('ready')
        expect(run.current.items.some((i) => i.kind === 'agent' && /4|four/i.test(i.text))).toBe(
          true,
        )
        const id = run.current.sessionId
        expect(
          await run.send('And what is 3 plus 3? Answer in a short sentence without tools.'),
        ).toEqual({
          ok: true,
        })
        await expect.poll(() => run.current.status, { timeout: 90_000 }).toBe('ready')
        expect(run.current.sessionId).toBe(id)
        const record = store.get(run.current.conversationId!)!
        run.close()
        const resumed = new CodexAgentRun({ ...options, record })
        try {
          await resumed.prepareResume()
          expect(resumed.current.sessionId).toBe(id)
        } finally {
          resumed.close()
        }
        const reader = await connect()
        try {
          const page = await readCodexHistory(reader, id!)
          expect(page.items.filter((item) => item.kind === 'you')).toHaveLength(2)
          expect(page.items.some((item) => item.kind === 'agent' && /6|six/i.test(item.text))).toBe(
            true,
          )
          await reader.request('thread/archive', { threadId: id })
        } finally {
          reader.close()
        }
        console.log('Live conversation and resume passed:', model.id)
      } finally {
        run.close()
      }
    }
  },
  300_000,
)

it.skipIf(!process.env.THREADLIGHT_LIVE_APPROVALS)(
  'requires explicit approval for a synthetic MCP mutation and preserves denial',
  async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'threadlight-agent-approval-'))
    const store = new AgentStore(join(workspace, 'index.json'))
    const connect = async (): Promise<CodexTransport> => {
      const client = new CodexClient(
        { command: process.env.THREADLIGHT_LIVE_CODEX!, prefixArgs: [] },
        workspace,
      )
      await client.initialize()
      trace(client)
      const request = client.request.bind(client)
      client.request = async (method, params, timeout) => {
        const result = await request(method, params, timeout)
        if (method === 'config/read' && isObject(result.config)) {
          result.config.mcp_servers = {
            ...Object.fromEntries(
              Object.entries(
                isObject(result.config.mcp_servers) ? result.config.mcp_servers : {},
              ).map(([name, value]) => [
                name,
                { ...(isObject(value) ? value : {}), enabled: false },
              ]),
            ),
            synthetic: {
              command: process.execPath,
              args: [resolve('test/fixtures/agent-mcp.mjs'), workspace],
              enabled: true,
            },
          }
        }
        return result
      }
      return client
    }
    const run = new CodexAgentRun({
      client: connect,
      workspace,
      model: null,
      reasoning: 'low',
      appsOff: [],
      store,
      briefing: () => '',
      lifetimeMinutes: () => 0,
      onChange: () => {},
    })
    try {
      expect(
        await run.send(
          'Synthetic approval test. Call the synthetic MCP write_marker tool exactly once. The user will answer the approval card. Do not use shell or file tools instead.',
        ),
      ).toEqual({ ok: true })
      await expect
        .poll(() => run.current.requests.length || run.current.error, { timeout: 90_000 })
        .toBe(1)
      const first = run.current.requests[0]!
      console.log('Synthetic MCP approval:', first.kind)
      await expect(access(join(workspace, 'approved-marker.txt'))).rejects.toThrow()
      // Accept only this synthetic fixture's exact request, never unrelated live tools.
      expect(first.title + first.detail + JSON.stringify(first.questions)).toMatch(
        /synthetic|write_marker/i,
      )
      if (first.questions?.length) {
        const answers = Object.fromEntries(
          first.questions.map((q) => [
            q.id,
            q.options.find((o) => /^accept$|^allow once$|^allow$/i.test(o)) ?? '',
          ]),
        )
        expect(Object.values(answers).every(Boolean)).toBe(true)
        expect(run.respond(first.id, { action: 'answer', answers })).toEqual({ ok: true })
      } else expect(run.respond(first.id, { action: 'allow' })).toEqual({ ok: true })
      await expect.poll(() => run.current.status, { timeout: 90_000 }).toBe('ready')
      expect(await readFile(join(workspace, 'approved-marker.txt'), 'utf8')).toBe(
        'SYNTHETIC_APPROVED',
      )
      expect(
        await run.send(
          'Call the synthetic MCP write_marker tool once again. This time I will deny it. Do not use alternatives or retry a denial.',
        ),
      ).toEqual({ ok: true })
      await expect
        .poll(() => run.current.requests.length || run.current.error, { timeout: 90_000 })
        .toBe(1)
      const denied = run.current.requests[0]!
      if (denied.questions?.length) {
        const answers = Object.fromEntries(
          denied.questions.map((q) => [
            q.id,
            q.options.find((o) => /^decline$|^deny$/i.test(o)) ?? '',
          ]),
        )
        expect(run.respond(denied.id, { action: 'answer', answers })).toEqual({ ok: true })
      } else expect(run.respond(denied.id, { action: 'deny' })).toEqual({ ok: true })
      await expect.poll(() => run.current.status, { timeout: 90_000 }).toBe('ready')
      expect(await readFile(join(workspace, 'writes.txt'), 'utf8')).toBe('write\n')
    } finally {
      run.close()
    }
  },
  240_000,
)

it.skipIf(!process.env.THREADLIGHT_LIVE_FILES)(
  'gates file writes, answers a native question and interrupts a pending action',
  async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'threadlight-agent-files-'))
    const store = new AgentStore(join(workspace, 'index.json'))
    const connect = async () => {
      const client = new CodexClient(
        { command: process.env.THREADLIGHT_LIVE_CODEX!, prefixArgs: [] },
        workspace,
      )
      await client.initialize()
      trace(client)
      return client
    }
    const run = new CodexAgentRun({
      client: connect,
      workspace,
      model: null,
      reasoning: 'low',
      appsOff: ['node_repl'],
      store,
      briefing: () => '',
      lifetimeMinutes: () => 0,
      onChange: () => {},
    })
    try {
      expect(
        await run.send(
          'Synthetic permission test. Use apply_patch to create synthetic-file.txt in the current working directory containing only THREADLIGHT_FILE_OK. Do not use any other tools. Wait for the approval card.',
        ),
      ).toEqual({ ok: true })
      await expect
        .poll(() => run.current.requests.length || run.current.error, { timeout: 60_000 })
        .toBe(1)
      const approval = run.current.requests[0]!
      expect(approval.title + approval.detail).toContain('synthetic-file.txt')
      await expect(access(join(workspace, 'synthetic-file.txt'))).rejects.toThrow()
      expect(run.respond(approval.id, { action: 'allow' })).toEqual({ ok: true })
      await expect.poll(() => run.current.status, { timeout: 60_000 }).toBe('ready')
      expect(await readFile(join(workspace, 'synthetic-file.txt'), 'utf8')).toContain(
        'THREADLIGHT_FILE_OK',
      )
      expect(
        await run.send(
          'Use request_user_input to ask me which test colour I prefer, with options Blue and Green. This is a synthetic UI integration test. Do not choose for me.',
        ),
      ).toEqual({ ok: true })
      await expect
        .poll(() => ['waiting', 'ready', 'error'].includes(run.current.status), {
          timeout: 120_000,
        })
        .toBe(true)
      expect(run.current.requests[0]?.kind).toBe('questions')
      const question = run.current.requests[0]!
      const answers = Object.fromEntries(
        question.questions!.map((q) => [q.id, q.options.find((o) => /Green/i.test(o))!]),
      )
      expect(run.respond(question.id, { action: 'answer', answers })).toEqual({ ok: true })
      await expect.poll(() => run.current.status, { timeout: 60_000 }).toBe('ready')
      expect(
        await run.send(
          'Use apply_patch to create interrupted-file.txt containing TEST in the current working directory. Wait for approval. Do not use other tools.',
        ),
      ).toEqual({ ok: true })
      await expect
        .poll(() => run.current.requests.length || run.current.error, { timeout: 60_000 })
        .toBe(1)
      expect(await run.interrupt()).toEqual({ ok: true })
      await expect.poll(() => run.current.status, { timeout: 15_000 }).toBe('interrupted')
      await expect(access(join(workspace, 'interrupted-file.txt'))).rejects.toThrow()
      console.log('Native file approval, structured question and interruption passed.')
    } catch (error) {
      console.log('Synthetic native test state:', JSON.stringify(run.current))
      throw error
    } finally {
      run.close()
    }
  },
  240_000,
)
