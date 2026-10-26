import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { codexGitFolders, codexPullRequest } from '../src/main/codex/badges'
import { CodexTracker } from '../src/main/codex/tracker'
import { CodexHolds } from '../src/main/codex/holds'
import { codexPaths } from '../src/main/sessions/paths'
import type { GitState } from '../src/shared/types'

const temp: string[] = []
afterEach(async () => {
  for (const path of temp.splice(0)) await rm(path, { recursive: true, force: true })
})

describe('Codex thread badges', () => {
  it('uses structured native and legacy paths, newest first, without interpreting tool source', () => {
    expect(
      codexGitFolders([
        { type: 'turn_context', payload: { cwd: 'Z:/General' } },
        {
          type: 'response_item',
          payload: {
            type: 'function_call',
            name: 'functions.exec_command',
            arguments: JSON.stringify({ workdir: 'Z:/General/repo' }),
          },
        },
        { type: 'commandExecution', cwd: 'Z:/General/repo' },
        { type: 'fileChange', changes: [{ path: 'Z:\\General\\repo\\src\\main.ts' }] },
        { type: 'fileChange', changes: [{ path: 'relative/file.ts' }] },
        { type: 'custom_tool_call', name: 'exec', input: 'workdir: "Z:/other"' },
        { type: 'agentMessage', text: 'Read Z:/other/private' },
      ]),
    ).toEqual(['Z:\\General\\repo\\src', 'Z:/General/repo', 'Z:/General'])
    expect(codexGitFolders([{ type: 'commandExecution', cwd: '\\\\?\\Z:\\repo' }])).toEqual([
      '\\\\?\\Z:\\repo',
    ])
  })

  it('labels attached PRs without inventing a remote state or extracting links from prose', () => {
    expect(codexPullRequest({ url: 'https://github.com/example/repo/pull/25' })).toEqual({
      number: 25,
      state: 'unknown',
    })
    expect(
      codexPullRequest({ url: 'https://gitlab.example/group/repo/-/merge_requests/8' }),
    ).toEqual({ number: 8, state: 'unknown' })
    for (const url of ['file:///repo/pull/2', 'https://example/repo/issues/2', 'not a URL'])
      expect(codexPullRequest({ url })).toBeNull()
  })

  it.each(['recent', 'older', 'legacy', 'worktree'])(
    'populates badges for General chats from %s activity without changing workspace grouping or source files',
    async (mode) => {
      const home = await mkdtemp(join(tmpdir(), 'threadlight-codex-badges-'))
      temp.push(home)
      const paths = codexPaths({ CODEX_HOME: home }, home)
      const id = '11111111-1111-4111-8111-111111111111'
      await mkdir(paths.sessions)
      const rollout = join(paths.sessions, 'synthetic.jsonl')
      await writeFile(
        rollout,
        JSON.stringify({
          type: 'response_item',
          payload: {
            type: 'function_call',
            name: 'functions.exec_command',
            arguments: JSON.stringify({ workdir: 'Z:/General/repo' }),
          },
        }) + '\n',
      )
      const state = new DatabaseSync(paths.state)
      state.exec(
        'CREATE TABLE threads(id TEXT,cwd TEXT,name TEXT,archived INTEGER,updated_at INTEGER,rollout_path TEXT); CREATE TABLE thread_attachments(id TEXT,thread_id TEXT,attachment_type TEXT,identity_key TEXT,payload TEXT,created_at INTEGER)',
      )
      state
        .prepare('INSERT INTO threads VALUES (?,?,?,0,?,?)')
        .run(id, 'Z:/General', 'Synthetic Codex', Math.floor(Date.now() / 1000), rollout)
      state
        .prepare('INSERT INTO thread_attachments VALUES (?,?,?,?,?,1)')
        .run(
          'pr',
          id,
          'pull_request',
          'synthetic-pr',
          JSON.stringify({ url: 'https://github.com/example/repo/pull/25' }),
        )
      if (mode === 'worktree')
        state
          .prepare('INSERT INTO thread_attachments VALUES (?,?,?,?,?,2)')
          .run(
            'worktree',
            id,
            'worktree',
            'synthetic-worktree',
            JSON.stringify({ root: 'Z:/worktrees/repo', workspaceRoot: 'Z:/worktrees/repo' }),
          )
      state.close()
      if (mode !== 'legacy') {
        const history = new DatabaseSync(paths.history)
        history.exec(
          'CREATE TABLE thread_items(thread_id TEXT,rollout_ordinal INTEGER,item_type TEXT,item_json TEXT); CREATE TABLE thread_turns(thread_id TEXT,rollout_ordinal INTEGER,status TEXT,started_at INTEGER,completed_at INTEGER)',
        )
        history
          .prepare('INSERT INTO thread_items VALUES (?,0,?,?)')
          .run(
            id,
            'commandExecution',
            JSON.stringify({ type: 'commandExecution', cwd: 'Z:/General/repo' }),
          )
        for (let i = 1; i <= (mode === 'older' ? 201 : 1); i++)
          history.prepare('INSERT INTO thread_items VALUES (?,?,?,?)').run(
            id,
            i,
            'agentMessage',
            JSON.stringify({
              type: 'agentMessage',
              phase: 'final_answer',
              text: 'Which colour?',
            }),
          )
        history.prepare('INSERT INTO thread_turns VALUES (?,0,?,0,0)').run(id, 'completed')
        history.close()
      }
      const files = [paths.state, rollout, ...(mode === 'legacy' ? [] : [paths.history])]
      const before = await Promise.all(files.map((path) => readFile(path)))
      const repo = mode === 'worktree' ? 'Z:/worktrees/repo' : 'Z:/General/repo'
      const git: GitState = {
        root: repo,
        branch: 'main',
        added: 124,
        removed: 13,
        files: 2,
        newFiles: 0,
        ahead: 2,
        behind: 0,
        worktrees: [repo],
      }
      const tracker = new CodexTracker(paths, new CodexHolds(() => {}), (folder) =>
        folder === repo ? git : null,
      )
      const snapshot = await tracker.snapshot({ expanded: ['Z:/General'], showAll: [] })
      expect(snapshot.sessions[0]).toMatchObject({
        cwd: 'Z:/General',
        git,
        pullRequests: [{ number: 25, state: 'unknown' }],
        ...(mode === 'legacy' ? {} : { attention: { kind: 'next-step' }, state: 'waiting' }),
      })
      expect(snapshot.workspaces[0]?.id).toBe('Z:/General')
      expect(snapshot.workspaces[0]?.threads[0]?.session.git).toEqual(git)
      expect(await Promise.all(files.map((path) => readFile(path)))).toEqual(before)
    },
  )
})
