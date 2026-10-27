import { describe, expect, it } from 'vitest'
import { ThreadReadService } from '../src/main/threadRead/service'
import {
  unknownStatus,
  type ThreadAdapter,
  type CatalogEntry,
  type AdapterRead,
} from '../src/main/threadRead/types'
import type { ThreadProvider, ThreadVisibleItem } from '../src/shared/threadRead'
import { normalize, normalizeRollout, applyTurnCompletion } from '../src/main/threadRead/normalize'
import { ThreadReadServer } from '../src/main/threadRead/server'

const entry = (
  id: string,
  title = 'Dashboard',
  provider: ThreadProvider = 'codex',
): CatalogEntry => ({
  nativeId: id,
  title,
  provider,
  titleSource: 'explicit',
  workspace: 'Z:/Synthetic',
  archived: false,
  lastActiveAt: 1,
})
const item = (
  id: string,
  text: string,
  role: 'user' | 'assistant' = 'assistant',
): ThreadVisibleItem => ({
  id,
  text,
  role,
  kind: 'message',
  phase: role === 'user' ? 'request' : 'final',
  at: 1,
  turnId: `turn-${id}`,
  complete: true,
  source: 'synthetic_history',
})
class Adapter implements ThreadAdapter {
  provider: ThreadProvider = 'codex'
  entries = [entry('one')]
  reads = 0
  fail = false
  items = [item('request', 'Check synthetic work', 'user'), item('answer', 'Synthetic report')]
  async catalog(cursor?: string) {
    const offset = Number(cursor ?? 0)
    return {
      entries: this.entries.slice(offset, offset + 1000),
      complete: offset + 1000 >= this.entries.length,
      next: offset + 1000 < this.entries.length ? String(offset + 1000) : undefined,
      sources: [
        { source: `${this.provider}_metadata`, health: 'ok' as const, checkedAt: Date.now() },
      ],
    }
  }
  async locate(id: string) {
    return this.entries.find((e) => e.nativeId === id) ?? null
  }
  async read(): Promise<AdapterRead> {
    this.reads++
    if (this.fail) throw new Error('disk failed')
    return {
      items: structuredClone(this.items),
      sources: [
        {
          source: 'synthetic_history',
          health: 'ok',
          checkedAt: Date.now(),
          sourceUpdatedAt: 1,
          revision: 'file:1:1',
        },
      ],
      status: unknownStatus(),
      coverage: [],
      changedDuringRead: false,
    }
  }
}
const setup = () => {
  const adapter = new Adapter()
  let enabled: ThreadProvider[] = ['codex']
  const service = new ThreadReadService([adapter], () => enabled)
  return {
    adapter,
    service,
    scope: service.open(),
    disable: () => {
      enabled = []
    },
  }
}

describe('thread discovery and reading evidence', () => {
  it('TD-09 does not label an old request current before the new native turn flushes', async () => {
    const { adapter, service, scope } = setup()
    const original = adapter.read.bind(adapter)
    adapter.read = async () => ({
      ...(await original()),
      status: { state: 'working', basis: 'provider_turn', at: 2, turnId: 'new-unflushed-turn' },
    })
    const found = await service.find(scope, { query: 'Dashboard' })
    const result = await service.read(scope, { threadRef: found.resolvedRef })
    expect(result.currentRequest).toBeNull()
    expect(result.latestCompletedReply?.text).toBe('Synthetic report')
    expect(result.coverage.join(' ')).toContain('older request is not current')
  })
  it('TD-05 bounds a stalled source without overlapping its queued reads', async () => {
    const adapter = new Adapter()
    const original = adapter.read.bind(adapter)
    let release!: () => void
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    let running = 0
    adapter.read = async () => {
      running++
      await pending
      return original()
    }
    const service = new ThreadReadService([adapter], () => ['codex'], undefined, Date.now, {
      sourceDeadlineMs: 25,
    })
    const scope = service.open(),
      found = await service.find(scope, { query: 'Dashboard' })
    expect((await service.read(scope, { threadRef: found.resolvedRef })).outcome).toBe(
      'unavailable',
    )
    expect((await service.read(scope, { threadRef: found.resolvedRef })).outcome).toBe(
      'unavailable',
    )
    expect(running).toBe(1)
    release()
  })
  it('TD-11 strips provider context envelopes while preserving a real request', () => {
    const context =
      '# AGENTS.md instructions\n<INSTRUCTIONS>Repository setup.</INSTRUCTIONS>\n<environment_context><cwd>Z:/Synthetic</cwd></environment_context>'
    const message = (text: string) => ({
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text }],
    })
    expect(normalize('codex', message(context), 'synthetic', 'one')).toEqual([])
    expect(
      normalize('codex', message(`${context}\nPlease fix the button.`), 'synthetic', 'two')[0]
        ?.text,
    ).toBe('Please fix the button.')
    expect(
      normalize('codex', message('Please explain AGENTS.md instructions.'), 'synthetic', 'three')[0]
        ?.text,
    ).toBe('Please explain AGENTS.md instructions.')
  })
  it('TD-09 associates rollout turns and keeps active final-channel chunks incomplete', () => {
    const records = [
      { type: 'event_msg', payload: { type: 'task_started', turn_id: 'old' } },
      {
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          channel: 'final',
          content: [{ type: 'output_text', text: 'Previous result.' }],
        },
      },
      { type: 'turn_context', payload: { turn_id: 'active' } },
      {
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'New request.' }],
        },
      },
      {
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          channel: 'final',
          content: [{ type: 'output_text', text: 'Still streaming' }],
        },
      },
    ].map((value, offset) => ({ value, offset }))
    const items = normalizeRollout(records, 'synthetic')
    const result = applyTurnCompletion(items, {
      state: 'working',
      basis: 'provider_turn',
      at: 1,
      turnId: 'active',
    })
    expect(result.map((i) => [i.turnId, i.complete])).toEqual([
      ['old', true],
      ['active', true],
      ['active', false],
    ])
    expect(
      applyTurnCompletion(items, {
        state: 'completed',
        basis: 'provider_turn',
        at: 2,
        turnId: 'active',
      }).at(-1)?.complete,
    ).toBe(true)
  })
  it('offers a one-letter typo without binding it and rejects unrelated shared tokens', async () => {
    const { adapter, service, scope } = setup()
    expect((await service.find(scope, { query: 'Dashbord' })).resolution).toBe('ambiguous')
    adapter.entries = [entry('one', 'Synthetic garden')]
    expect((await service.find(scope, { query: 'Synthetic unknown planet' })).resolution).toBe(
      'none',
    )
  })
  it('clears a question when its matching tool response arrives during an active turn', async () => {
    const { adapter, service, scope } = setup()
    adapter.items = [
      item('request', 'Request', 'user'),
      { ...item('question', 'Choose'), kind: 'attention', callId: 'question-call' },
      { ...item('response', 'Response received'), kind: 'tool', resolvedCallId: 'question-call' },
    ]
    const ref = (await service.find(scope, { query: 'Dashboard' })).resolvedRef!
    expect((await service.read(scope, { threadRef: ref })).attention).toBeNull()
  })
  it('TD-01/04 searches all 5001 identities independently of any UI list', async () => {
    const { adapter, service, scope } = setup()
    adapter.entries = Array.from({ length: 5001 }, (_, i) => entry(String(i), `Synthetic ${i}`))
    let result = await service.find(scope, { query: 'Synthetic 5000' })
    while (result.nextCursor && result.resolution === 'incomplete')
      result = await service.find(scope, { query: 'Synthetic 5000', cursor: result.nextCursor })
    expect(result.resolution).toBe('unique')
    expect(result.candidates[0]?.title).toBe('Synthetic 5000')
    expect(adapter.reads).toBe(0)
  })
  it('TD-02 requires a choice for duplicate titles and broad phrases', async () => {
    const { adapter, service, scope } = setup()
    adapter.entries.push(entry('two', 'Dashboard polish'))
    expect((await service.find(scope, { query: 'Dashboard' })).resolution).toBe('ambiguous')
    expect((await service.find(scope, { query: 'Dash' })).resolution).toBe('ambiguous')
    expect(adapter.reads).toBe(0)
  })
  it('TD-03 keeps identity across rename/archive and never retargets a removed id', async () => {
    const { adapter, service, scope } = setup()
    const found = await service.find(scope, { query: 'Dashboard' }),
      ref = found.resolvedRef!
    adapter.entries[0] = { ...adapter.entries[0]!, title: 'Renamed', archived: true }
    const read = await service.read(scope, { threadRef: ref })
    expect(read.thread.title).toBe('Renamed')
    expect(read.thread.archived).toBe(true)
    adapter.entries = [entry('different')]
    expect((await service.read(scope, { threadRef: ref })).outcome).toBe('not_found')
  })
  it('TD-03 isolates the same native UUID in different providers', async () => {
    const a = new Adapter(),
      b = new Adapter()
    b.provider = 'claude'
    b.entries = [entry('one', 'Dashboard', 'claude')]
    const service = new ThreadReadService([a, b], () => ['claude', 'codex']),
      scope = service.open()
    const found = await service.find(scope, { query: 'Dashboard' })
    expect(found.resolution).toBe('ambiguous')
    expect(new Set(found.candidates.map((c) => c.threadRef)).size).toBe(2)
  })
  it('TD-05 preserves healthy provider matches but never resolves incomplete coverage', async () => {
    const a = new Adapter(),
      b = new Adapter()
    b.provider = 'claude'
    b.catalog = async () => {
      throw new Error('locked')
    }
    const service = new ThreadReadService([a, b], () => ['claude', 'codex'])
    const found = await service.find(service.open(), { query: 'Dashboard' })
    expect(found.resolution).toBe('incomplete')
    expect(found.candidates).toHaveLength(1)
    expect(found.sources.some((s) => s.health === 'unavailable')).toBe(true)
  })
  it('TD-06/07 refreshes unchanged evidence and does not relabel a failed read', async () => {
    const { adapter, service, scope } = setup(),
      found = await service.find(scope, { query: 'Dashboard' })
    const first = await service.read(scope, { threadRef: found.resolvedRef! }),
      second = await service.read(scope, {
        threadRef: found.resolvedRef!,
        sinceObservationId: first.observationId,
      })
    expect(adapter.reads).toBe(2)
    expect(second.checkedAt).toBeGreaterThanOrEqual(second.requestedAt)
    expect(second.delta?.newItems).toEqual([])
    adapter.fail = true
    const failed = await service.read(scope, { threadRef: found.resolvedRef! })
    expect(failed.outcome).toBe('unavailable')
    expect(failed.checkedAt).toBeNull()
    expect(failed.items).toEqual([])
  })
  it('TD-06 serializes reads with a new observation after the queued request', async () => {
    const { adapter, service, scope } = setup()
    const ref = (await service.find(scope, { query: 'Dashboard' })).resolvedRef!
    let release!: () => void
    const barrier = new Promise<void>((r) => {
        release = r
      }),
      original = adapter.read.bind(adapter)
    let calls = 0
    adapter.read = async () => {
      calls++
      if (calls === 1) await barrier
      return original()
    }
    const first = service.read(scope, { threadRef: ref }),
      second = service.read(scope, { threadRef: ref })
    release()
    await first
    const result = await second
    expect(calls).toBe(2)
    expect(result.checkedAt).toBeGreaterThanOrEqual(result.requestedAt)
  })
  it('TD-09 distinguishes an older final reply from the current request and progress', async () => {
    const { adapter, service, scope } = setup()
    adapter.items = [
      item('old', 'Old completed answer'),
      item('new', 'A new request', 'user'),
      { ...item('progress', 'Still working'), phase: 'progress', complete: false },
    ]
    const ref = (await service.find(scope, { query: 'Dashboard' })).resolvedRef!,
      read = await service.read(scope, { threadRef: ref })
    expect(read.currentRequest?.id).toBe('new')
    expect(read.latestCompletedReply?.id).toBe('old')
    expect(read.latestProgress?.complete).toBe(false)
  })
  it('TD-10 does not invent success when no current provider state is available', async () => {
    const { service, scope } = setup()
    const ref = (await service.find(scope, { query: 'Dashboard' })).resolvedRef!
    expect((await service.read(scope, { threadRef: ref })).status).toEqual(unknownStatus())
  })
  it('TD-11 allowlists visible fields and excludes analysis and thinking', () => {
    expect(
      normalize(
        'codex',
        {
          type: 'message',
          role: 'assistant',
          channel: 'analysis',
          content: [{ type: 'output_text', text: 'PRIVATE' }],
        },
        'test',
        'id',
      ),
    ).toEqual([])
    expect(
      normalize(
        'claude',
        {
          type: 'assistant',
          message: {
            content: [
              { type: 'thinking', thinking: 'PRIVATE' },
              { type: 'text', text: 'Visible' },
            ],
          },
        },
        'test',
        'id',
      ).map((i) => i.text),
    ).toEqual(['Visible'])
    expect(
      normalize('codex', { type: 'reasoning', encrypted_content: 'PRIVATE' }, 'test', 'id'),
    ).toEqual([])
  })
  it('TD-12 refuses unknown, foreign, disabled and revoked scopes', async () => {
    const { service, scope, disable } = setup(),
      ref = (await service.find(scope, { query: 'Dashboard' })).resolvedRef!
    expect((await service.read(service.open(), { threadRef: ref })).outcome).toBe('out_of_scope')
    expect((await service.read(scope, { threadRef: ref, cursor: 'foreign' })).outcome).toBe(
      'cursor_expired',
    )
    disable()
    expect((await service.read(scope, { threadRef: ref })).outcome).toBe('provider_disabled')
    service.close(scope)
    expect((await service.find(scope, { query: 'Dashboard' })).outcome).toBe('out_of_scope')
  })
  it('TD-12 withholds output when scope is disabled during a read', async () => {
    const { adapter, service, scope, disable } = setup(),
      ref = (await service.find(scope, { query: 'Dashboard' })).resolvedRef!
    const original = adapter.read.bind(adapter)
    adapter.read = async () => {
      const value = await original()
      disable()
      return value
    }
    const result = await service.read(scope, { threadRef: ref })
    expect(result.outcome).toBe('provider_disabled')
    expect(result.items).toEqual([])
  })
  it('TD-13 clears historical attention on an observed completed turn', async () => {
    const { adapter, service, scope } = setup()
    adapter.items.push({ ...item('question', 'Question'), kind: 'attention' })
    const original = adapter.read.bind(adapter)
    adapter.read = async () => ({
      ...(await original()),
      status: { state: 'completed', basis: 'provider_turn', at: 1, turnId: 'x' },
    })
    const ref = (await service.find(scope, { query: 'Dashboard' })).resolvedRef!
    expect((await service.read(scope, { threadRef: ref })).attention).toBeNull()
  })
  it('TD-15 pages repeated identical messages without text deduplication', async () => {
    const { adapter, service, scope } = setup()
    adapter.items = Array.from({ length: 45 }, (_, i) => item(String(i), 'same'))
    const ref = (await service.find(scope, { query: 'Dashboard' })).resolvedRef!,
      first = await service.read(scope, { threadRef: ref, limit: 20 })
    const second = await service.read(scope, {
      threadRef: ref,
      limit: 20,
      cursor: first.nextCursor,
    })
    expect(first.items).toHaveLength(20)
    expect(second.items).toHaveLength(20)
    expect(new Set([...first.items, ...second.items].map((i) => i.id)).size).toBe(40)
  })
  it('TD-15 bounds response excerpts and labels omissions', async () => {
    const { adapter, service, scope } = setup()
    adapter.items = [item('long', 'x'.repeat(100_000))]
    const ref = (await service.find(scope, { query: 'Dashboard' })).resolvedRef!,
      result = await service.read(scope, { threadRef: ref })
    expect(result.items[0]?.text.length).toBe(6000)
    expect(result.items[0]?.truncated).toBe(true)
    expect(result.outcome).toBe('partial')
  })
  it('TD-14 exposes exactly two authenticated read tools and revokes old capabilities', async () => {
    const { service } = setup(),
      server = new ThreadReadServer(service)
    await server.start()
    const receipts: unknown[] = [],
      connection = server.connect((r) => receipts.push(r))
    const call = async (method: string, params: unknown = {}, token = connection.token) =>
      fetch(connection.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ jsonrpc: '2.0', id: 'call', method, params }),
      })
    try {
      expect((await call('tools/list', {}, 'invalid')).status).toBe(401)
      const inventory = (await (await call('tools/list')).json()) as {
        result: { tools: unknown[] }
      }
      expect(inventory.result.tools).toHaveLength(2)
      const result = (await (
        await call('tools/call', {
          name: 'threadlight_find_threads',
          arguments: { query: 'Dashboard' },
        })
      ).json()) as { result: { content: { text: string }[] } }
      expect(JSON.parse(result.result.content[0]!.text).resolution).toBe('unique')
      expect(receipts).toHaveLength(1)
      expect(
        (
          (await (
            await call('tools/call', { name: 'threadlight_send_message', arguments: {} })
          ).json()) as { error: unknown }
        ).error,
      ).toBeTruthy()
      connection.close()
      expect((await call('tools/list')).status).toBe(401)
    } finally {
      server.close()
    }
  })
})
