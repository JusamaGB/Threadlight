import { afterEach, describe, expect, it, vi } from 'vitest'
import { appendFile, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { CodexHolds } from '../src/main/codex/holds'
import { codexDeepLink, codexKey } from '../src/main/codex/identity'
import { writerHeld } from '../src/main/codex/live'
import { codexRelayArgs, interpretCodexOutput, sendCodex } from '../src/main/codex/relay'
import { CodexTracker, rolloutTail, summarizeCodex } from '../src/main/codex/tracker'
import { codexPaths } from '../src/main/sessions/paths'
import type { Session } from '../src/shared/types'
import { parseSettings, validatePatch } from '../src/shared/settings'
import { startHookServer } from '../src/main/hookServer'

const id = '11111111-1111-4111-8111-111111111111',
  key = codexKey(id)
const temp: string[] = []
afterEach(async () => {
  vi.useRealTimers()
  for (const path of temp.splice(0)) await rm(path, { recursive: true, force: true })
})
const event = (hook_event_name: string, extra: object = {}) => ({
  session_id: id,
  turn_id: 'synthetic-turn',
  hook_event_name,
  ...extra,
})

describe('Codex holds', () => {
  it('refuses an answer after the deadline even before the timer callback runs', () => {
    let now = 0
    const holds = new CodexHolds(
        () => {},
        () => now,
      ),
      reply = vi.fn()
    holds.hold(event('PermissionRequest'), reply)
    const card = holds.records.get(key)!.attention
    now = 60_001
    expect(holds.answer(key, card?.kind === 'approval' ? card.holdId : '', 'allow').ok).toBe(false)
    expect(reply).toHaveBeenCalledExactlyOnceWith(null)
  })
  it('carries approval decisions over the hook HTTP endpoint and releases without a decision', async () => {
    let arrive: () => void = () => {}
    const holds = new CodexHolds(() => {})
    const server = await startHookServer({
      port: 0,
      onEvent: (payload) => holds.event(payload),
      onAsk: (payload, reply, dropped) => {
        const held = holds.hold(payload, reply)
        if (held) dropped(() => holds.dropped(reply))
        arrive()
        return held
      },
    })
    try {
      for (const choice of ['allow', 'deny', 'release']) {
        const arrived = new Promise<void>((resolve) => {
          arrive = resolve
        })
        const response = fetch(`http://127.0.0.1:${server.port}/ask`, {
          method: 'POST',
          body: JSON.stringify(event('PermissionRequest')),
        })
        await arrived
        const card = holds.records.get(key)!.attention
        if (choice === 'release') holds.releaseAll()
        else holds.answer(key, card?.kind === 'approval' ? card.holdId : '', choice)
        const received = await response
        if (choice === 'release') {
          expect(received.status).toBe(204)
          expect(await received.text()).toBe('')
        } else
          expect(await received.json()).toMatchObject({
            hookSpecificOutput: { decision: { behavior: choice } },
          })
      }
    } finally {
      holds.releaseAll()
      await server.close()
    }
  })
  it('allows only the explicitly selected current approval, never an earlier card', () => {
    const holds = new CodexHolds(() => {}),
      first = vi.fn(),
      second = vi.fn()
    expect(
      holds.hold(event('PermissionRequest', { tool_input: { command: 'echo synthetic' } }), first),
    ).toBe(true)
    const old = holds.records.get(key)!.attention
    const oldId = old?.kind === 'approval' ? old.holdId : 'old'
    expect(
      holds.hold(event('PermissionRequest', { tool_input: { command: 'echo second' } }), second),
    ).toBe(true)
    expect(first).toHaveBeenCalledWith(null)
    const fresh = holds.records.get(key)!.attention
    expect(holds.answer(key, oldId, 'allow').ok).toBe(false)
    expect(second).not.toHaveBeenCalled()
    expect(holds.answer(key, fresh?.kind === 'approval' ? fresh.holdId : '', 'allow').ok).toBe(true)
    expect(JSON.parse(second.mock.calls[0]![0])).toEqual({
      hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } },
    })
    expect(holds.answer(key, fresh?.kind === 'approval' ? fresh.holdId : '', 'allow').ok).toBe(
      false,
    )
  })
  it('returns an explicit deny and never approves on timeout, close, open or disconnect', () => {
    vi.useFakeTimers()
    const holds = new CodexHolds(() => {}),
      reply = vi.fn()
    holds.hold(event('PermissionRequest'), reply)
    const attention = holds.records.get(key)!.attention
    holds.answer(key, attention?.kind === 'approval' ? attention.holdId : '', 'deny')
    expect(JSON.parse(reply.mock.calls[0]![0]).hookSpecificOutput.decision.behavior).toBe('deny')
    for (const release of [
      () => vi.advanceTimersByTime(60_000),
      () => holds.releaseAll(),
      () => holds.release(key),
      () => holds.dropped(reply),
    ]) {
      reply.mockClear()
      holds.hold(event('PermissionRequest'), reply)
      release()
      expect(reply).toHaveBeenCalledExactlyOnceWith(null)
    }
  })
  it('continues a Stop question through the documented contract and avoids loops', () => {
    const holds = new CodexHolds(() => {}),
      reply = vi.fn()
    expect(
      holds.hold(event('Stop', { last_assistant_message: 'Pick blue or green?' }), reply),
    ).toBe(true)
    const attention = holds.records.get(key)!.attention
    const holdId = attention?.kind === 'next-step' ? attention.holdId : ''
    expect(holds.answer(key, holdId, 'blue')).toEqual({ ok: true })
    expect(JSON.parse(reply.mock.calls[0]![0])).toEqual({
      decision: 'block',
      reason: 'The user answered in Threadlight: blue',
    })
    expect(
      holds.hold(
        event('Stop', { stop_hook_active: true, last_assistant_message: 'Again?' }),
        reply,
      ),
    ).toBe(false)
    expect(holds.hold(event('Stop', { last_assistant_message: 'Finished.' }), reply)).toBe(false)
    expect(
      holds.hold(event('Stop', { agent_id: 'child', last_assistant_message: 'Again?' }), reply),
    ).toBe(false)
  })
})

describe('Codex relay', () => {
  it('uses an exact namespaced id, stdin, and keeps model selection', () => {
    expect(codexRelayArgs({ id: key, model: 'gpt-test' })).toEqual([
      'exec',
      'resume',
      '--model',
      'gpt-test',
      '--skip-git-repo-check',
      '--json',
      id,
      '-',
    ])
    expect(() => codexRelayArgs({ id: '--last', model: null })).toThrow()
    expect(codexDeepLink(key)).toBe(`codex://threads/${id}`)
    expect(codexDeepLink('codex:../../other')).toBe(null)
  })
  it('refuses live sessions before spawning and passes shell punctuation literally', async () => {
    const session = { id: key, model: null, cwd: process.cwd() } as Session
    const cli = {
        command: process.execPath,
        prefixArgs: [resolve('test/fixtures/fake-codex.mjs')],
      },
      sent = vi.fn()
    expect((await sendCodex(session, 'hello', cli, async () => true, sent)).ok).toBe(false)
    expect(sent).not.toHaveBeenCalled()
    const text = 'quoted "text"; $(do-not-run) & |\nsecond line'
    expect(await sendCodex(session, text, cli, async () => false, sent)).toEqual({
      ok: true,
      reply: text,
    })
    expect(sent).toHaveBeenCalledTimes(1)
    sent.mockClear()
    expect((await sendCodex(session, 'conflict', cli, async () => false, sent)).ok).toBe(false)
    expect(sent).not.toHaveBeenCalled()
  })
  it('requires a completed turn, not exit zero or a spawned process', () => {
    expect(interpretCodexOutput('{"type":"thread.started"}', '', 0).ok).toBe(false)
    expect(interpretCodexOutput('{"type":"turn.completed"}', '', 1).ok).toBe(false)
    expect(interpretCodexOutput('', 'already has an active writer', 1)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('open'),
    })
  })
})

describe('read-only Codex discovery', () => {
  it('reads paginated history and groups workspaces without changing source files', async () => {
    const home = await mkdtemp(join(tmpdir(), 'threadlight-codex-'))
    temp.push(home)
    const paths = codexPaths({ CODEX_HOME: home }, home)
    await mkdir(join(home, 'sessions'), { recursive: true })
    const rollout = join(home, 'sessions', 'synthetic.jsonl')
    await writeFile(
      rollout,
      JSON.stringify({
        timestamp: new Date().toISOString(),
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: { model_context_window: 1000, last_token_usage: { input_tokens: 250 } },
          rate_limits: {
            limit_id: 'codex',
            primary: {
              used_percent: 27,
              window_minutes: 10080,
              resets_at: Math.floor(Date.now() / 1000) + 86400,
            },
            secondary: null,
          },
        },
      }) + '\n',
    )
    const state = new DatabaseSync(paths.state)
    state.exec(
      'CREATE TABLE threads (id TEXT, cwd TEXT, name TEXT, archived INTEGER, updated_at INTEGER, rollout_path TEXT, model TEXT, approval_mode TEXT)',
    )
    state
      .prepare('INSERT INTO threads VALUES (?,?,?,0,?,?,?,?)')
      .run(
        id,
        'C:/synthetic/project',
        'Synthetic Codex',
        Math.floor(Date.now() / 1000) - 7200,
        rollout,
        'gpt-test',
        'on-request',
      )
    state.close()
    const history = new DatabaseSync(paths.history)
    history.exec(
      'CREATE TABLE thread_items(thread_id TEXT, rollout_ordinal INTEGER, item_json TEXT); CREATE TABLE thread_turns(thread_id TEXT,rollout_ordinal INTEGER,status TEXT,started_at INTEGER,completed_at INTEGER)',
    )
    history
      .prepare('INSERT INTO thread_items VALUES (?,0,?)')
      .run(id, JSON.stringify({ type: 'plan', text: '# Synthetic plan\n- Build the display' }))
    for (let n = 1; n <= 201; n++)
      history.prepare('INSERT INTO thread_items VALUES (?,?,?)').run(
        id,
        n,
        JSON.stringify({
          type: 'reasoning',
          text: 'Synthetic reasoning must not become a plan.',
        }),
      )
    history.prepare('INSERT INTO thread_items VALUES (?,202,?)').run(
      id,
      JSON.stringify({
        type: 'userMessage',
        content: [{ type: 'text', text: 'Synthetic prompt' }],
      }),
    )
    history
      .prepare('INSERT INTO thread_items VALUES (?,203,?)')
      .run(id, JSON.stringify({ type: 'agentMessage', text: 'Synthetic reply.' }))
    history.prepare('INSERT INTO thread_turns VALUES (?,1,?,1,2)').run(id, 'completed')
    history.close()
    const before = await Promise.all(
      [paths.state, paths.history, rollout].map((path) => readFile(path)),
    )
    const tracker = new CodexTracker(paths, new CodexHolds(() => {}))
    const snapshot = await tracker.snapshot({ expanded: ['C:/synthetic/project'], showAll: [] })
    expect(snapshot.provider).toBe('codex')
    expect(snapshot.sessions[0]).toMatchObject({
      id: key,
      provider: 'codex',
      title: 'Synthetic Codex',
      lastPrompt: 'Synthetic prompt',
      lastReply: 'Synthetic reply.',
      state: 'idle',
      tracked: true,
      contextUsed: 0.25,
      planText: '# Synthetic plan\n- Build the display',
    })
    expect(snapshot.workspaces[0]?.threads[0]?.session.id).toBe(key)
    expect(snapshot.codexUsage).toMatchObject({ fiveHour: null, week: { used: 0.27 } })
    tracker.configure(1, 10)
    const noRecentChats = await tracker.snapshot()
    expect(noRecentChats.sessions).toEqual([])
    expect(noRecentChats.codexUsage).toEqual(snapshot.codexUsage)
    const after = await Promise.all(
      [paths.state, paths.history, rollout].map((path) => readFile(path)),
    )
    expect(after).toEqual(before)
    tracker.configure(24, 10)
    await appendFile(
      rollout,
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'function_call',
          name: 'functions.update_plan',
          arguments: JSON.stringify({ plan: [{ step: 'Retained step', status: 'in_progress' }] }),
        },
      }) + '\n',
    )
    expect((await tracker.snapshot()).sessions[0]?.plan[0]?.content).toBe('Retained step')
    await appendFile(
      rollout,
      (
        JSON.stringify({
          type: 'response_item',
          payload: { type: 'function_call_output', output: 'Synthetic output '.repeat(100) },
        }) + '\n'
      ).repeat(800),
    )
    const grown = await tracker.snapshot()
    expect(grown.sessions[0]?.plan[0]?.content).toBe('Retained step')
    expect(grown.codexUsage).toEqual(snapshot.codexUsage)
    await writeFile(rollout, '{}\n')
    expect((await tracker.snapshot()).sessions[0]?.plan).toEqual([])
    expect(await writerHeld(paths.locks, id)).toBe(false)
    expect(await writerHeld(paths.locks, '../bad')).toBe(true)
    const outside = join(home, 'outside.jsonl')
    await writeFile(outside, '{"secret":"not a transcript"}\n')
    expect(await rolloutTail(outside, home)).toEqual([])
  })
  it('shows native question cards without claiming a hook can submit them', () => {
    const summary = summarizeCodex([
      {
        type: 'function_call',
        name: 'request_user_input',
        arguments: JSON.stringify({
          questions: [
            {
              header: 'Colour',
              question: 'Which colour?',
              options: [{ label: 'Blue', description: 'Synthetic' }],
            },
          ],
        }),
      },
    ])
    expect(summary.attention).toMatchObject({ kind: 'question', answerableUntil: null })
  })
  it('reads desktop question projections and keeps async questions through unrelated work', () => {
    const records = [
      {
        type: 'agentMessage',
        text: 'Please choose.',
        questions: [{ title: 'Which colour?', options: ['Blue', 'Green'] }],
      },
      { type: 'commandExecution', command: 'echo synthetic' },
      { type: 'agentMessage', text: 'Continuing independent work.' },
    ]
    expect(summarizeCodex(records).attention).toMatchObject({
      kind: 'question',
      questions: [{ question: 'Which colour?', options: [{ label: 'Blue' }, { label: 'Green' }] }],
    })
    expect(summarizeCodex([...records, { type: 'userMessage', content: 'Blue' }]).attention).toBe(
      null,
    )
    const call = {
      type: 'function_call',
      name: 'request_user_input',
      call_id: 'question-call',
      arguments: JSON.stringify({ questions: [{ question: 'Which colour?' }] }),
    }
    expect(
      summarizeCodex([call, { type: 'function_call_output', call_id: 'other-call' }]).attention
        ?.kind,
    ).toBe('question')
    expect(
      summarizeCodex([call, { type: 'function_call_output', call_id: 'question-call' }]).attention,
    ).toBe(null)
  })
  it('keeps default Claude settings and separate workspace choices', () => {
    expect(parseSettings({}).enabledProviders).toEqual(['claude'])
    expect(validatePatch({ enabledProviders: ['codex'] })).toEqual({
      ok: true,
      patch: { enabledProviders: ['codex'] },
    })
    expect(
      parseSettings({
        provider: 'codex',
        focusWorkspace: 'claude-folder',
        codexFocusWorkspace: 'codex-folder',
      }),
    ).toMatchObject({ focusWorkspace: 'claude-folder', codexFocusWorkspace: 'codex-folder' })
  })
})
