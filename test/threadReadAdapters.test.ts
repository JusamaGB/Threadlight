import { mkdtemp, mkdir, writeFile, appendFile, rename, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { jsonlPage, contained } from '../src/main/threadRead/files'
import { ClaudeReadAdapter } from '../src/main/threadRead/claude'
import { CodexReadAdapter } from '../src/main/threadRead/codex'
import { defaultPaths, codexPaths } from '../src/main/sessions/paths'
import { ThreadEvidenceStore } from '../src/main/agent/threadEvidenceStore'
import { ThreadReadService } from '../src/main/threadRead/service'

describe('bounded provider source adapters', () => {
  it('preserves indexed CLI names and discloses incomplete unindexed name coverage', async () => {
    const root = await mkdtemp(join(tmpdir(), 'thread-read-cli-title-')),
      paths = defaultPaths({ APPDATA: root }, root),
      project = join(paths.projectsDir, 'synthetic')
    await mkdir(project, { recursive: true })
    const id = '11111111-1111-4111-8111-111111111111'
    await writeFile(
      join(project, 'sessions-index.json'),
      JSON.stringify({ entries: [{ sessionId: id, customTitle: 'Indexed synthetic name' }] }),
    )
    await writeFile(
      join(project, `${id}.jsonl`),
      JSON.stringify({ type: 'user', uuid: 'u', message: { content: 'First question' } }) + '\n',
    )
    const adapter = new ClaudeReadAdapter(paths)
    expect(
      (await adapter.catalog()).entries.every((e) => e.title === 'Indexed synthetic name'),
    ).toBe(true)
    expect((await adapter.locate(id))?.title).toBe('Indexed synthetic name')
    await writeFile(
      join(project, '22222222-2222-4222-8222-222222222222.jsonl'),
      `${JSON.stringify({ type: 'user', message: { content: 'Large unindexed conversation' } })}\n${Array.from({ length: 3000 }, () => JSON.stringify({ type: 'progress', data: 'synthetic metadata filler' })).join('\n')}\n`,
    )
    const second = await adapter.catalog()
    expect(second.complete).toBe(false)
    expect(second.sources[0]?.reason).toContain('name coverage is incomplete')
  })
  it('revalidates cached metadata against WAL changes and rejects a changed catalogue cursor', async () => {
    const root = await mkdtemp(join(tmpdir(), 'thread-read-wal-')),
      paths = codexPaths({ CODEX_HOME: root })
    const db = new DatabaseSync(paths.state)
    try {
      db.exec('PRAGMA journal_mode=WAL; CREATE TABLE threads(id TEXT PRIMARY KEY,name TEXT); BEGIN')
      const insert = db.prepare('INSERT INTO threads VALUES(?,?)')
      for (let i = 0; i < 1001; i++) insert.run(String(i).padStart(4, '0'), `Synthetic ${i}`)
      db.exec('COMMIT')
      const adapter = new CodexReadAdapter(paths),
        first = await adapter.catalog()
      expect(first.next).toBeTruthy()
      expect((await adapter.catalog()).entries[0]?.title).toBe('Synthetic 0')
      db.prepare('UPDATE threads SET name=? WHERE id=?').run('Changed synthetic title', '0000')
      await expect(adapter.catalog(first.next)).rejects.toThrow('Metadata changed')
      expect((await adapter.catalog()).entries[0]?.title).toBe('Changed synthetic title')
    } finally {
      db.close()
    }
  })
  it('reports an uninstalled Claude provider rather than an empty complete catalogue', async () => {
    const root = await mkdtemp(join(tmpdir(), 'thread-read-missing-'))
    const result = await new ClaudeReadAdapter(defaultPaths({ APPDATA: root }, root)).catalog()
    expect(result.complete).toBe(false)
    expect(result.sources[0]?.health).toBe('partial')
  })
  it('TD-08 reads complete UTF-8 records and pages without overlap', async () => {
    const root = await mkdtemp(join(tmpdir(), 'thread-read-bytes-')),
      path = join(root, 'events.jsonl')
    await writeFile(
      path,
      Array.from({ length: 20 }, (_, i) => JSON.stringify({ i, text: '多字节🙂' })).join('\n') +
        '\n{"partial":',
    )
    const ids: number[] = []
    let cursor: Awaited<ReturnType<typeof jsonlPage>>['cursor']
    do {
      const page = await jsonlPage(path, [root], cursor, 170)
      ids.unshift(...page.records.map((r) => (r.value as { i: number }).i))
      cursor = page.cursor
    } while (cursor)
    expect(ids).toEqual(Array.from({ length: 20 }, (_, i) => i))
    const old = await jsonlPage(path, [root], undefined, 170)
    await writeFile(path, '{}\n')
    await expect(jsonlPage(path, [root], old.cursor, 170)).rejects.toThrow('cursor_expired')
  })
  it('TD-08/12 rejects replaced cursors and paths outside provider roots', async () => {
    const root = await mkdtemp(join(tmpdir(), 'thread-read-root-')),
      path = join(root, 'source.jsonl')
    await writeFile(path, '{"a":1}\n'.repeat(20))
    const old = await jsonlPage(path, [root], undefined, 30)
    await rename(path, join(root, 'old.jsonl'))
    await writeFile(path, '{"b":2}\n'.repeat(20))
    await expect(jsonlPage(path, [root], old.cursor, 30)).rejects.toThrow('cursor_expired')
    await expect(contained(path, [join(root, 'other')])).rejects.toThrow('outside')
  })
  it('TD-08 reports oversized and malformed records instead of empty success', async () => {
    const root = await mkdtemp(join(tmpdir(), 'thread-read-size-')),
      path = join(root, 'source.jsonl')
    await writeFile(path, '{"text":"' + 'x'.repeat(5000) + '"}\ninvalid\n')
    const page = await jsonlPage(path, [root], undefined, 100)
    expect(page.coverage.length).toBeGreaterThan(0)
    expect(page.cursor).toBeTruthy()
  })
  it('Claude discovers archived app names outside UI filters and strips reasoning', async () => {
    const root = await mkdtemp(join(tmpdir(), 'thread-read-claude-')),
      paths = defaultPaths({ APPDATA: root }, root),
      id = '11111111-1111-1111-1111-111111111111'
    const project = join(paths.projectsDir, 'synthetic'),
      records = join(paths.appSessionsDir, 'account', 'org')
    await mkdir(project, { recursive: true })
    await mkdir(records, { recursive: true })
    await writeFile(
      join(records, 'local_test.json'),
      JSON.stringify({
        sessionId: 'local_test',
        cliSessionId: id,
        title: 'Synthetic archived chat',
        isArchived: true,
        cwd: 'C:/synthetic',
      }),
    )
    const transcript = join(project, `${id}.jsonl`)
    await writeFile(
      transcript,
      [
        { type: 'user', uuid: 'u', message: { content: 'Synthetic question' } },
        {
          type: 'assistant',
          uuid: 'a',
          message: {
            stop_reason: 'end_turn',
            content: [
              { type: 'thinking', thinking: 'PRIVATE' },
              { type: 'text', text: 'Synthetic answer' },
            ],
          },
        },
      ]
        .map((x) => JSON.stringify(x))
        .join('\n') + '\n',
    )
    const adapter = new ClaudeReadAdapter(paths),
      catalog = await adapter.catalog()
    const found = catalog.entries.find((e) => e.title === 'Synthetic archived chat')!
    expect(found.archived).toBe(true)
    const result = await adapter.read(found)
    expect(result.items.map((i) => i.text)).toEqual(['Synthetic question', 'Synthetic answer'])
    expect(JSON.stringify(result)).not.toContain('PRIVATE')
    await appendFile(
      transcript,
      JSON.stringify({ type: 'user', uuid: 'u2', message: { content: 'A newer request' } }) + '\n',
    )
    expect((await adapter.read(found)).status.state).toBe('unknown')
  })
  it('Codex reads native history read-only, then follows an archive movement', async () => {
    const root = await mkdtemp(join(tmpdir(), 'thread-read-codex-')),
      paths = codexPaths({ CODEX_HOME: root }),
      id = '22222222-2222-2222-2222-222222222222'
    await mkdir(paths.sessions, { recursive: true })
    await mkdir(paths.archivedSessions!, { recursive: true })
    const rollout = join(paths.sessions, 'synthetic.jsonl')
    await writeFile(
      rollout,
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          phase: 'final_answer',
          content: [{ type: 'output_text', text: 'Rollout result' }],
        },
      }) + '\n',
    )
    const state = new DatabaseSync(paths.state)
    state.exec(
      'CREATE TABLE threads(id TEXT PRIMARY KEY,name TEXT,cwd TEXT,archived INTEGER,updated_at INTEGER,rollout_path TEXT)',
    )
    state
      .prepare('INSERT INTO threads VALUES(?,?,?,?,?,?)')
      .run(id, 'Synthetic Codex', 'C:/synthetic', 0, 1, rollout)
    state.close()
    const history = new DatabaseSync(paths.history)
    history.exec(
      'CREATE TABLE thread_items(thread_id TEXT,rollout_ordinal INTEGER,item_json TEXT); CREATE TABLE thread_turns(thread_id TEXT,rollout_ordinal INTEGER,status TEXT,started_at INTEGER,completed_at INTEGER)',
    )
    history
      .prepare('INSERT INTO thread_items VALUES(?,?,?)')
      .run(id, 1, JSON.stringify({ type: 'agentMessage', id: 'reply', text: 'Native result' }))
    history.prepare('INSERT INTO thread_turns VALUES(?,?,?,?,?)').run(id, 1, 'completed', 1, 2)
    history.close()
    const before = await readFile(paths.state),
      adapter = new CodexReadAdapter(paths),
      found = (await adapter.catalog()).entries[0]!
    const result = await adapter.read(found)
    expect(result.items.some((i) => i.text === 'Native result')).toBe(true)
    expect(result.status.state).toBe('completed')
    expect(await readFile(paths.state)).toEqual(before)
    await rename(rollout, join(paths.archivedSessions!, 'synthetic.jsonl'))
    expect(
      (await adapter.read(found)).sources.find((s) => s.source === 'codex_rollout')?.health,
    ).toBe('ok')
  })
  it('TD-16 persists bounded receipts without touching provider metadata', async () => {
    const root = await mkdtemp(join(tmpdir(), 'thread-read-receipts-')),
      store = new ThreadEvidenceStore(join(root, 'sources.json'))
    const service = new ThreadReadService([], () => []),
      result = await service.find(service.open(), { query: 'Synthetic' })
    const source = {
      callId: 'call-one',
      tool: 'threadlight_find_threads',
      at: 1,
      correlation: 'local_runtime_call' as const,
      result,
    }
    await store.save('conversation', [{ id: 'source', kind: 'step', text: 'Source', source }])
    expect(
      (await new ThreadEvidenceStore(join(root, 'sources.json')).read('conversation'))[0]?.source
        ?.callId,
    ).toBe('call-one')
    expect(await store.read('different')).toEqual([])
  })
})
