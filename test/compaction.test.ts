import { expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { CodexTracker, codexStage } from '../src/main/codex/tracker'
import { CodexHolds } from '../src/main/codex/holds'
import { codexPaths } from '../src/main/sessions/paths'
import * as live from '../src/main/codex/live'

it('reads the active Codex compaction lifecycle without mistaking old or completed items for work', async () => {
  const home = await mkdtemp(join(tmpdir(), 'threadlight-compaction-'))
  const paths = codexPaths({ CODEX_HOME: home }, home)
  const id = '11111111-1111-4111-8111-111111111111'
  const writer = vi.spyOn(live, 'writerHeld').mockResolvedValue(true)
  const state = new DatabaseSync(paths.state)
  const history = new DatabaseSync(paths.history)
  try {
    await mkdir(paths.sessions)
    const rollout = join(paths.sessions, 'session.jsonl')
    await writeFile(rollout, '{}\n')
    state.exec(
      'CREATE TABLE threads(id TEXT,cwd TEXT,name TEXT,archived INTEGER,updated_at INTEGER,rollout_path TEXT)',
    )
    state
      .prepare('INSERT INTO threads VALUES (?,?,?,0,?,?)')
      .run(id, home, 'Compaction proof', Date.now() / 1000, rollout)
    history.exec(
      'CREATE TABLE thread_turns(thread_id TEXT,turn_id TEXT,rollout_ordinal INTEGER,status TEXT,started_at INTEGER,completed_at INTEGER); CREATE TABLE thread_items(thread_id TEXT,turn_id TEXT,rollout_ordinal INTEGER,item_json TEXT,item_type TEXT,started_at_ms INTEGER,completed_at_ms INTEGER)',
    )
    history
      .prepare("INSERT INTO thread_turns VALUES (?,'current',2,'inProgress',?,NULL)")
      .run(id, Date.now() / 1000)
    const add = history.prepare('INSERT INTO thread_items VALUES (?,?,?,?,?,?,?)')
    add.run(id, 'old', 1, '{"type":"contextCompaction"}', 'contextCompaction', 1, null)
    add.run(
      id,
      'current',
      2,
      '{"type":"agentMessage","phase":"commentary","text":"Checking files"}',
      'agentMessage',
      2,
      3,
    )
    const tracker = new CodexTracker(paths, new CodexHolds(() => {}))
    const read = async () => (await tracker.snapshot()).sessions[0]!
    expect(await read()).toMatchObject({ compacting: false, stage: 'Checking files' })
    add.run(id, 'current', 3, '{"type":"contextCompaction"}', 'contextCompaction', Date.now(), null)
    expect(await read()).toMatchObject({
      state: 'working',
      compacting: true,
      stage: 'Compacting context',
      thinking: false,
    })
    history.exec('UPDATE thread_items SET completed_at_ms=100 WHERE rollout_ordinal=3')
    expect(await read()).toMatchObject({ compacting: false, stage: 'Checking files' })
    history.exec(
      "UPDATE thread_items SET completed_at_ms=NULL WHERE rollout_ordinal=3; UPDATE thread_turns SET status='interrupted'",
    )
    expect((await read()).compacting).toBe(false)
    history.exec("UPDATE thread_turns SET status='inProgress'")
    writer.mockResolvedValue(false)
    expect((await read()).compacting).toBe(false)
  } finally {
    writer.mockRestore()
    history.close()
    state.close()
    await rm(home, { recursive: true, force: true })
  }
})

it('compaction replaces an in-progress plan only while the thread is working', () => {
  const step = { index: 1, total: 2, content: 'Build the app' }
  expect(codexStage('working', step, 'Old update', null, null, true)).toBe('Compacting context')
  expect(codexStage('working', step, 'Old update', null, null, false)).toBe('1/2 · Build the app')
  expect(codexStage('idle', step, null, 'Finished', null, true)).toBe('Finished')
})
