import { describe, expect, it } from 'vitest'
import { appendFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { execFileSync } from 'node:child_process'
import { ThreadDiffLedger, recordedPath } from '../src/main/sessions/threadDiff'
import {
  ClaudeDiffReplay,
  ClaudeThreadDiff,
  codexThreadDiff,
} from '../src/main/sessions/threadDiffSources'
import { ThreadChanges } from '../src/main/sessions/threadChanges'
import type { Session, Snapshot } from '../src/shared/types'

const path = 'C:/repo/shared.ts'
const patch = (before: string, after: string, start = 1) =>
  `@@ -${start},1 +${start},1 @@\n-${before}\n+${after}\n`
const assistant = (id: string, name: string, input: object) => ({
  type: 'assistant',
  message: { content: [{ type: 'tool_use', id, name, input }] },
})
const result = (id: string, output: object = {}, failed = false) => ({
  type: 'user',
  toolUseResult: output,
  message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: failed }] },
})
const codex = (id: string, diff: string, kind = 'update', file = path) => ({
  type: 'fileChange',
  id,
  status: 'completed',
  changes: [{ path: file, kind: { type: kind }, diff }],
})

describe('recorded net thread diffs', () => {
  it('retains newline-only changes and cancels their recorded reversal', () => {
    const ledger = new ThreadDiffLedger()
    ledger.record({
      path,
      kind: 'update',
      diff: '@@ -1 +1 @@\n-same\n\\ No newline at end of file\n+same\n',
    })
    expect(ledger.data().summary.files).toBe(1)
    ledger.record({
      path,
      kind: 'update',
      diff: '@@ -1 +1 @@\n-same\n+same\n\\ No newline at end of file\n',
    })
    expect(ledger.data().summary.files).toBe(0)
    ledger.record({ path, kind: 'update', diff: '', move: 'C:/repo/new.ts' })
    expect(ledger.data('C:/repo').files[0]!.file.path).toBe('new.ts')
    expect(ledger.data().summary.complete).toBe(true)
  })
  it('combines repeated edits and removes a reverted change', () => {
    const ledger = new ThreadDiffLedger()
    ledger.record({ path, kind: 'update', diff: patch('one', 'two') })
    ledger.record({ path, kind: 'update', diff: patch('two', 'three') })
    expect(ledger.data().summary).toMatchObject({ files: 1, added: 1, removed: 1, complete: true })
    expect(JSON.stringify(ledger.data().files[0]!.diff)).not.toContain('two')
    ledger.record({ path, kind: 'update', diff: patch('three', 'one') })
    expect(ledger.data().summary).toMatchObject({ files: 0, added: 0, removed: 0, complete: true })
  })
  it('keeps a created file as net additions, then cancels its deletion', () => {
    const ledger = new ThreadDiffLedger()
    ledger.record({ path, kind: 'add', diff: 'one\ntwo\n' })
    ledger.record({ path, kind: 'update', diff: patch('one', 'ONE') })
    expect(ledger.data('C:/repo').files[0]!.file).toMatchObject({
      path: 'shared.ts',
      status: 'added',
      added: 2,
      removed: 0,
    })
    ledger.record({ path, kind: 'delete', diff: 'ONE\ntwo\n' })
    expect(ledger.data().summary.files).toBe(0)
  })
  it('uses full Claude preimages without counting unchanged lines', () => {
    const ledger = new ThreadDiffLedger()
    ledger.record({ path, kind: 'update', before: 'one\ntwo\nthree\n', after: 'one\nTWO\nthree\n' })
    ledger.record({
      path,
      kind: 'update',
      before: 'one\nTWO\nthree\n',
      after: 'one\nTWO\nthree\nfour\n',
    })
    expect(ledger.data().summary).toMatchObject({ added: 2, removed: 1, complete: true })
  })
  it('handles sparse file positions, zero-length insertion ranges and several hunks', () => {
    const ledger = new ThreadDiffLedger()
    ledger.record({
      path,
      kind: 'update',
      diff: '@@ -7,2 +7,3 @@\n seven\n+new\n eight\n@@ -12,1 +13,1 @@\n-before\n+after\n',
    })
    expect(ledger.data().summary).toMatchObject({ added: 2, removed: 1, complete: true })
    ledger.record({
      path,
      kind: 'update',
      diff: '@@ -7,3 +7,2 @@\n seven\n-new\n eight\n@@ -13,1 +12,1 @@\n-after\n+before\n',
    })
    expect(ledger.data().summary.files).toBe(0)
    ledger.record({ path, kind: 'update', diff: '@@ -3,0 +4,1 @@\n+inserted\n' })
    expect(ledger.data().summary).toMatchObject({ added: 1, removed: 0, complete: true })
  })
  it('keeps interleaved writers separate even when they edit the same file', () => {
    const a = new ThreadDiffLedger(),
      b = new ThreadDiffLedger()
    a.record({ path, kind: 'update', diff: patch('old', 'from A') })
    b.record({ path, kind: 'update', diff: patch('from A', 'from B') })
    expect(JSON.stringify(a.data().files)).not.toContain('from B')
    expect(JSON.stringify(b.data().files)).toContain('from B')
    expect(a.data().summary.added).toBe(1)
    expect(b.data().summary.added).toBe(1)
  })
  it('marks conflicting history as separate recorded patches instead of inventing a net diff', () => {
    const ledger = new ThreadDiffLedger()
    ledger.record({ path, kind: 'update', diff: patch('old', 'own first') })
    ledger.record({ path, kind: 'update', diff: patch('external preimage', 'own second') })
    const data = ledger.data()
    expect(data.summary.complete).toBe(false)
    expect(JSON.stringify(data.files[0]!.diff)).toContain('Recorded edit 2')
    expect(data.summary).toMatchObject({ added: 2, removed: 2 })
  })
  it('keeps unknown/binary edits and renames visible without borrowing disk content', () => {
    const ledger = new ThreadDiffLedger()
    ledger.record({ path, kind: 'unknown' })
    expect(ledger.data().files[0]!.diff).toEqual({ kind: 'unavailable' })
    expect(ledger.data().summary.complete).toBe(false)
    const manyLines = new ThreadDiffLedger()
    manyLines.record({ path, kind: 'add', diff: '\n'.repeat(50_001) })
    expect(manyLines.data().summary.complete).toBe(false)
    const moved = new ThreadDiffLedger()
    moved.record({ path, kind: 'update', diff: patch('old', 'new'), move: 'C:/repo/renamed.ts' })
    expect(moved.data('C:/repo').files[0]!.file.path).toBe('renamed.ts')
    expect(moved.data().summary).toMatchObject({ files: 1, added: 1, removed: 1 })
    const casing = new ThreadDiffLedger()
    casing.record({ path, kind: 'update', diff: '', move: 'C:/repo/Shared.ts' })
    expect(casing.data('C:/repo').files[0]!.file.path).toBe('Shared.ts')
  })
  it('bounds oversized events and preserves distinct absolute paths', () => {
    const ledger = new ThreadDiffLedger()
    ledger.record({ path, kind: 'add', diff: 'x'.repeat(2 * 1024 * 1024 + 1) })
    expect(ledger.data().summary.complete).toBe(false)
    expect(recordedPath('../other/a.ts', 'C:/repo')).toBe('C:/other/a.ts')
    expect(recordedPath('a.ts', '')).toBeNull()
    expect(recordedPath('\\\\?\\C:\\repo\\a.ts', '')).toBe('C:/repo/a.ts')
    expect(recordedPath('C:\\\\repo\\\\a.ts', '')).toBe('C:/repo/a.ts')
    expect(recordedPath('file:///C:/private.txt', 'C:/repo')).toBeNull()
  })
})

describe('provider-owned change evidence', () => {
  it('only accepts completed native Codex patches and deduplicates item IDs', () => {
    const item = codex('one', patch('old', 'new'))
    const ledger = codexThreadDiff(
      [
        item,
        item,
        { ...codex('failed', patch('new', 'wrong')), status: 'failed' },
        { type: 'agentMessage', text: 'apply_patch malicious source' },
      ],
      'C:/repo',
    )
    expect(ledger.data().summary).toMatchObject({ files: 1, added: 1, removed: 1, complete: true })
    expect(JSON.stringify(ledger.data())).not.toContain('wrong')
  })
  it('waits for a successful Claude result and ignores failures and sidechains', () => {
    const source = new ClaudeThreadDiff('C:/repo')
    source.feed(
      assistant('edit', 'Edit', { file_path: path, old_string: 'old', new_string: 'new' }),
    )
    expect(source.ledger.data().summary.files).toBe(0)
    source.feed(result('edit', { originalFile: 'old\n' }))
    source.feed(result('edit', { originalFile: 'old\n' }))
    source.feed(assistant('bad', 'Write', { file_path: path, content: 'wrong' }))
    source.feed(result('bad', { type: 'create' }, true))
    source.feed({
      ...assistant('side', 'Write', { file_path: 'C:/repo/child.ts', content: 'child' }),
      isSidechain: true,
    })
    source.feed(result('side', { type: 'create' }))
    expect(source.ledger.data().summary).toMatchObject({
      files: 1,
      added: 1,
      removed: 1,
      complete: true,
    })
    expect(JSON.stringify(source.ledger.data())).not.toContain('wrong')
    expect(JSON.stringify(source.ledger.data())).not.toContain('child.ts')
  })
  it('supports Claude creates, replacements, MultiEdit and structured patches', () => {
    const source = new ClaudeThreadDiff('C:/repo')
    source.feed(assistant('create', 'Write', { file_path: path, content: 'a\nb\n' }))
    source.feed(result('create', { type: 'create' }))
    source.feed(
      assistant('multi', 'MultiEdit', {
        file_path: path,
        edits: [
          { old_string: 'a', new_string: 'A' },
          { old_string: 'b', new_string: 'B' },
        ],
      }),
    )
    source.feed(result('multi', { originalFile: 'a\nb\n' }))
    expect(source.ledger.data().summary).toMatchObject({ added: 2, removed: 0, complete: true })
    source.feed(
      assistant('partial', 'Edit', {
        file_path: 'C:/repo/existing.ts',
        old_string: 'before',
        new_string: 'after',
      }),
    )
    source.feed(
      result('partial', {
        structuredPatch: [
          { oldStart: 5, oldLines: 1, newStart: 5, newLines: 1, lines: ['-before', '+after'] },
        ],
      }),
    )
    expect(source.ledger.data().summary).toMatchObject({
      files: 2,
      added: 3,
      removed: 1,
      complete: true,
    })
  })
})

describe('thread diff source and caller integration', () => {
  it('does not replay the voice/search-only catalogue', async () => {
    let reads = 0
    const service = new ThreadChanges({
      history: 'not-opened.sqlite',
      transcript: () => {
        reads++
        return null
      },
      changed: () => {},
    })
    service.annotate({
      sessions: [],
      workspaces: [],
      lookupSessions: [{ id: 'lookup-only', cwd: 'C:/repo', git: null }],
    } as unknown as Snapshot)
    service.refreshListed()
    await Promise.resolve()
    expect(reads).toBe(0)
  })
  it('replays UTF-8 appends, waits for partial JSON and resets a rewritten transcript', async () => {
    const home = await mkdtemp(join(tmpdir(), 'threadlight-thread-diff-'))
    try {
      const file = join(home, 'claude.jsonl')
      await writeFile(
        file,
        JSON.stringify(assistant('write', 'Write', { file_path: path, content: 'héllo\n' })) + '\n',
      )
      const replay = new ClaudeDiffReplay(file, 'C:/repo')
      await replay.update()
      const completion = Buffer.from(JSON.stringify(result('write', { type: 'create' })) + '\n')
      await appendFile(file, completion.subarray(0, 10))
      await replay.update()
      expect(replay.reader.ledger.data().summary.files).toBe(0)
      await appendFile(file, completion.subarray(10))
      await replay.update()
      expect(replay.reader.ledger.data().summary).toMatchObject({ files: 1, added: 1 })
      await replay.update()
      expect(replay.reader.ledger.data().summary.added).toBe(1)
      await writeFile(file, '{}\n')
      await replay.update()
      expect(replay.reader.ledger.data().summary.files).toBe(0)
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })
  it('hydrates badges/viewer from the same cache, refreshes native edits, rejects unrelated paths and ignores Git totals', async () => {
    const home = await mkdtemp(join(tmpdir(), 'threadlight-thread-diff-'))
    const history = join(home, 'history.sqlite')
    const db = new DatabaseSync(history)
    try {
      db.exec(
        'CREATE TABLE thread_items(thread_id TEXT,item_json TEXT,rollout_ordinal INTEGER,item_type TEXT)',
      )
      const insert = db.prepare('INSERT INTO thread_items VALUES (?,?,?,?)')
      const git = (...args: string[]) =>
        execFileSync('git', ['-C', home, ...args], { windowsHide: true })
      git('init')
      git('config', 'user.email', 'test@example.com')
      git('config', 'user.name', 'Test')
      const file = join(home, 'shared.ts')
      await writeFile(file, 'old\nother\n')
      git('add', '.')
      git('commit', '-m', 'baseline')
      await writeFile(file, 'own A\nown B\n')
      insert.run(
        'a',
        JSON.stringify(codex('one', patch('old', 'own A'), 'update', file)),
        1,
        'fileChange',
      )
      insert.run(
        'b',
        JSON.stringify(codex('two', patch('other', 'own B', 2), 'update', file)),
        2,
        'fileChange',
      )
      let time = 0,
        notices = 0
      const service = new ThreadChanges({
        history,
        transcript: () => null,
        changed: () => notices++,
        now: () => time,
      })
      const a = {
        id: 'codex:a',
        cwd: home,
        git: { root: home, branch: 'main', files: 99, added: 9999 },
      } as Session
      const b = { ...a, id: 'codex:b' }
      // A cold chat may be seen before Git root discovery. Arrival must bypass the old 5s throttle.
      expect(await service.changes({ ...a, git: null })).toBeNull()
      const changes = await service.changes(a)
      expect(changes?.files).toEqual([
        { path: 'shared.ts', status: 'modified', added: 1, removed: 1, binary: false },
      ])
      expect(JSON.stringify(await service.file(a, 'shared.ts'))).toContain('own A')
      expect(JSON.stringify(await service.file(b, 'shared.ts'))).not.toContain('own A')
      expect(await service.file(a, 'other.ts')).toEqual({ kind: 'unavailable' })
      expect(await service.absolute(a, '../other.ts')).toBeNull()
      expect(service.summary(a)).toMatchObject({ added: 1, removed: 1, files: 1 })
      const revision = service.summary(a)!.revision
      service.annotate({ sessions: [a, b], workspaces: [] } as unknown as Snapshot)
      insert.run(
        'a',
        JSON.stringify(codex('three', patch('own A', 'updated A'), 'update', file)),
        3,
        'fileChange',
      )
      await writeFile(file, 'updated A\nown B\n')
      // Hook/filesystem invalidation must refresh even with no polling-clock advance.
      service.invalidate(home)
      service.refreshListed()
      await service.changes(a)
      expect(service.summary(a)!.revision).not.toBe(revision)
      expect(JSON.stringify(await service.file(a, 'shared.ts'))).toContain('updated A')
      expect(notices).toBeGreaterThan(0)
      const snapshot = {
        sessions: [a, b],
        lookupSessions: [a, b],
        workspaces: [{ threads: [{ session: a, children: [{ session: b, children: [] }] }] }],
      } as unknown as Snapshot
      const annotated = service.annotate(snapshot)
      expect(annotated.sessions[0]!.threadDiff?.added).toBe(1)
      expect(annotated.workspaces[0]!.threads[0]!.children[0]!.session.threadDiff?.files).toBe(1)
      expect(snapshot.sessions[0]!.threadDiff).toBeUndefined()
      git('add', 'shared.ts')
      git('commit', '-m', 'commit both chats')
      time = 12000
      expect((await service.changes(a))?.files).toEqual([])
      expect(service.summary(a)).toMatchObject({ files: 0, added: 0, removed: 0, complete: true })
      expect((await service.changes(b))?.files).toEqual([])
      const restarted = new ThreadChanges({ history, transcript: () => null, changed: () => {} })
      expect((await restarted.changes(a))?.files).toEqual([])
      expect(await readFile(history)).toBeTruthy()
    } finally {
      db.close()
      await rm(home, { recursive: true, force: true })
    }
  })
})
