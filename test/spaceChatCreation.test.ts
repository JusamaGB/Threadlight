import { randomUUID } from 'node:crypto'
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, vi } from 'vitest'
import { startClaudeSpaceChat } from '../src/main/appControl/claudeSpaceChat'
import { startSpaceChat } from '../src/main/appControl/startSpaceChat'
import { PerplexityChatReader, confirmsPerplexityCreation } from '../src/main/accountChats/adapters'
import { defaultPaths } from '../src/main/sessions/paths'
import type { Workflow } from '../src/shared/communication'

describe('foreground Agent starting a chat in its requested Shared Space', () => {
  const future = () => Date.now() + 3600000
  const input = {
    spaceId: randomUUID(),
    role: 'Research',
    openingMessage: 'Read this exact brief \u{1F642}',
    provider: 'perplexity' as const,
  }
  const make = () => {
    const target = 'perplexity:' + randomUUID()
    return {
      project: vi.fn(() => ({
        root: 'workspace',
        paused: false,
        expiresAt: future(),
        maxDispatches: 5,
      })),
      workflow: vi.fn((_id: string): Workflow | undefined => undefined),
      enabled: () => true,
      reserve: vi.fn(),
      start: vi.fn(
        async (_input: typeof input, _root: string, _id: string, beforeSend: () => void) => {
          beforeSend()
          return { target, model: 'Current native model' }
        },
      ),
      save: vi.fn(),
    }
  }
  it('adds a messaging participant under current space policy, reporting the exact native target', async () => {
    const deps = make(),
      actionId = randomUUID()
    const result = await startSpaceChat(input, actionId, deps)
    expect(result).toMatchObject({ outcome: 'ok', linked: true })
    expect(deps.reserve).toHaveBeenCalledWith(input.spaceId)
    expect(deps.start).toHaveBeenCalledWith(input, 'workspace', actionId, expect.any(Function))
    expect(deps.save).toHaveBeenCalledWith(
      expect.objectContaining({
        spaceId: input.spaceId,
        mode: 'manual',
        participants: [
          expect.objectContaining({
            target: result.target,
            role: 'Research',
            requestWork: false,
            communicate: true,
            modelPolicy: 'current',
          }),
        ],
      }),
      0,
    )
  })
  it('preserves a created destination if membership conflicts and does not resend', async () => {
    const deps = make()
    deps.save.mockImplementation(() => {
      throw Error('revision changed')
    })
    const result = await startSpaceChat(input, randomUUID(), deps)
    expect(result).toMatchObject({
      outcome: 'conflict',
      linked: false,
      target: expect.stringContaining('perplexity:'),
    })
    expect(deps.start).toHaveBeenCalledOnce()
  })
  it('blocks disabled, paused, and exhausted spaces before sending any prompt', async () => {
    for (const condition of ['disabled', 'paused', 'exhausted']) {
      const deps = make()
      if (condition === 'disabled') deps.enabled = () => false
      if (condition === 'paused')
        deps.project.mockReturnValue({
          root: 'workspace',
          paused: true,
          expiresAt: future(),
          maxDispatches: 1,
        })
      if (condition === 'exhausted')
        deps.reserve.mockImplementation(() => {
          throw Error('exhausted')
        })
      expect((await startSpaceChat(input, randomUUID(), deps)).outcome).toBe('unavailable')
      if (condition !== 'exhausted') expect(deps.start).not.toHaveBeenCalled()
      expect(deps.save).not.toHaveBeenCalled()
    }
  })
  it('does not charge a failed provider connection or mark it as an uncertain send', async () => {
    const deps = make()
    deps.start.mockRejectedValue(
      new Error(
        'Perplexity access was denied. Run Threadlight in the same Windows sign-in as Perplexity.',
      ),
    )
    expect(await startSpaceChat(input, randomUUID(), deps)).toMatchObject({
      outcome: 'unavailable',
      reason: expect.stringContaining('Windows sign-in'),
    })
    expect(deps.reserve).not.toHaveBeenCalled()
    expect(deps.save).not.toHaveBeenCalled()
  })
  it('requires provider proof for an opening Perplexity ask and uses the exact issued native ID', async () => {
    const client = randomUUID(),
      context = randomUUID(),
      target = randomUUID(),
      unrelated = randomUUID()
    const raw = {
      status: 'success',
      has_next_page: false,
      entries: [
        {
          uuid: randomUUID(),
          backend_uuid: randomUUID(),
          context_uuid: context,
          frontend_context_uuid: client,
          query_str: input.openingMessage,
          read_write_token: 'fixture',
          display_model: 'fixture',
          status: 'COMPLETED',
          blocks: [],
        },
      ],
    }
    let callback: (raw: unknown) => void = () => {}
    const rpc = {
      listen: vi.fn((_key: string, fn: typeof callback) => {
        callback = fn
        return () => {}
      }),
      request: vi.fn(async (method: string, args: { body: number[] }) => {
        expect(method).toBe('session_ask')
        expect(JSON.parse(Buffer.from(args.body).toString())).toMatchObject({
          query_str: input.openingMessage,
          params: { frontend_context_uuid: client, query_source: 'default_search' },
        })
        callback({ payload: { type: 'open', status: 200 } })
      }),
    }
    const reader: PerplexityChatReader = Reflect.construct(PerplexityChatReader, [rpc])
    Object.assign(reader, {
      contexts: new Map([
        [target, context],
        [unrelated, context],
      ]),
      latest: async (id: string) => ({
        raw:
          id === target
            ? raw
            : { ...raw, entries: [{ ...raw.entries[0], frontend_context_uuid: randomUUID() }] },
      }),
    })
    vi.spyOn(reader, 'list')
      .mockResolvedValueOnce({ chats: [], cursor: null, recentOnly: true })
      .mockResolvedValue({
        chats: [unrelated, target].map((id) => ({ id, title: 'Same title', updatedAt: null })),
        cursor: null,
        recentOnly: true,
      })
    expect(await reader.create(input.openingMessage, client, () => {})).toBe(target)
    expect(rpc.request).toHaveBeenCalledOnce()
    expect(confirmsPerplexityCreation(raw, randomUUID(), client, input.openingMessage)).toBe(false)
    expect(confirmsPerplexityCreation(raw, context, randomUUID(), input.openingMessage)).toBe(false)
    expect(confirmsPerplexityCreation(raw, context, client, 'different prompt')).toBe(false)
  })
  it('only reports a Claude session with matched CLI result, workspace, prompt and saved assistant model', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tl-space-cli-')),
      script = join(root, 'provider.cjs')
    const paths = { ...defaultPaths(), projectsDir: join(root, 'projects') },
      id = randomUUID()
    await mkdir(join(paths.projectsDir, 'project'), { recursive: true })
    await writeFile(
      script,
      `const fs=require('fs'),path=require('path'),id=process.argv[process.argv.indexOf('--session-id')+1],cwd=process.cwd();let msg='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>msg+=c);process.stdin.on('end',()=>{if(msg!=='skip transcript')fs.writeFileSync(path.join(cwd,'projects','project',id+'.jsonl'),[{sessionId:id,cwd,type:'user',message:{content:msg}},{sessionId:id,cwd,type:'assistant',message:{model:'fixture-model'}}].map(r=>JSON.stringify(r)).join('\\n'));console.log(JSON.stringify({type:'result',subtype:'success',is_error:false,session_id:id}))});`,
    )
    const cli = { command: process.execPath, prefixArgs: [script] }
    expect(await startClaudeSpaceChat(cli, paths, root, id, input.openingMessage)).toEqual({
      target: id,
      model: 'fixture-model',
    })
    await expect(
      startClaudeSpaceChat(cli, paths, root, randomUUID(), 'skip transcript'),
    ).rejects.toThrow('saved chat')
  })
})
