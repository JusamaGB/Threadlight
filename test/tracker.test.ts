import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { HookStateStore } from '../src/main/sessions/hookState'
import {
  attentionFor,
  contextUsed,
  gitFolder,
  FALLBACK_ACTIVE_MS,
  isThinking,
  resolveState,
  stageLine,
  STALE_MS,
  Tracker,
} from '../src/main/sessions/tracker'
import type { TranscriptSummary } from '../src/main/sessions/transcript'
import {
  interrupt,
  plan,
  prompt,
  sandbox,
  setModified,
  textReply,
  transcriptPath,
  writeAppRecord,
  writeTranscript,
  type Sandbox,
} from './helpers'

const NOW = Date.UTC(2030, 0, 1, 12, 0, 0)
const MINUTE = 60 * 1000

let box: Sandbox
let hooks: HookStateStore

beforeEach(async () => {
  box = await sandbox()
  hooks = new HookStateStore()
})
afterEach(() => box.cleanup())

function tracker(options: { maxSessions?: number } = {}) {
  return new Tracker({ paths: box.paths, hooks, now: () => NOW, ...options })
}

/** The flat recent list (the Active view and counts). */
async function recent(t = tracker()) {
  return (await t.snapshot()).sessions
}

async function addSession(id: string, records: object[], modifiedAgoMs: number) {
  const path = transcriptPath(box.paths, 'demo-project', id)
  await writeTranscript(path, records)
  await setModified(path, NOW - modifiedAgoMs)
  return path
}

describe('resolveState', () => {
  const base = {
    hookState: null,
    lastActiveAt: NOW,
    transcriptChangedAt: NOW,
    interrupted: false,
    now: NOW,
  }

  it('trusts hook state while it is fresh', () => {
    expect(resolveState({ ...base, hookState: 'working' })).toBe('working')
    expect(resolveState({ ...base, hookState: 'waiting' })).toBe('waiting')
  })

  it('treats a silent working session as crashed', () => {
    expect(resolveState({ ...base, hookState: 'working', lastActiveAt: NOW - STALE_MS - 1 })).toBe(
      'idle',
    )
  })

  it('treats a stopped session as idle even if the last hook said working', () => {
    expect(resolveState({ ...base, hookState: 'working', interrupted: true })).toBe('idle')
  })

  it('guesses from transcript freshness when there are no hook events', () => {
    expect(resolveState({ ...base, transcriptChangedAt: NOW - 5000 })).toBe('working')
    expect(resolveState({ ...base, transcriptChangedAt: NOW - FALLBACK_ACTIVE_MS - 1 })).toBe(
      'idle',
    )
  })
})

describe('attentionFor', () => {
  const summary = (over: Partial<TranscriptSummary> = {}): TranscriptSummary => ({
    title: null,
    cwd: null,
    lastPrompt: null,
    plan: [],
    currentStep: null,
    recap: null,
    lastReply: null,
    lastAction: 'Running tests',
    activity: 'tool',
    turnStartedAt: null,
    backgroundTasks: [],
    pendingQuestion: null,
    nextStep: null,
    contextTokens: null,
    model: null,
    lastTouchedPath: null,
    interrupted: false,
    ...over,
  })
  const question = [{ header: '', question: 'Which?', multiSelect: false, options: [] }]
  const nextStep = { recap: null, ask: 'Publish?', actions: [] }

  it('puts a question first, then an approval, then the question a finished turn asked', () => {
    expect(attentionFor('working', summary({ pendingQuestion: question, nextStep }))).toEqual({
      kind: 'question',
      questions: question,
      answerableUntil: null,
    })
    expect(attentionFor('waiting', summary({ nextStep }))).toEqual({
      kind: 'approval',
      action: 'Running tests',
      tool: null,
      answerableUntil: null,
    })
    expect(attentionFor('idle', summary({ nextStep }))).toEqual({
      kind: 'next-step',
      ...nextStep,
      answerableUntil: null,
    })
  })

  it('shows a held approval or session offer first, answerable here', () => {
    const busy = summary({ pendingQuestion: question })
    expect(
      attentionFor('working', busy, {
        kind: 'approval',
        releasesAt: 9,
        tool: 'Bash',
        detail: 'git push',
      }),
    ).toEqual({ kind: 'approval', action: 'git push', tool: 'Bash', answerableUntil: 9 })
    expect(
      attentionFor('working', busy, { kind: 'offer', releasesAt: 9, detail: 'Fix it' }),
    ).toEqual({ kind: 'offer', title: 'Fix it', answerableUntil: 9 })
  })

  it('marks a question card answerable while Threadlight holds it', () => {
    const held = attentionFor('working', summary({ pendingQuestion: question }), {
      kind: 'question',
      releasesAt: 123,
    })
    expect(held).toMatchObject({ kind: 'question', answerableUntil: 123 })
    // A next step held at the end of its turn is answerable too, but only by its own kind.
    const step = attentionFor('idle', summary({ nextStep }), { kind: 'next-step', releasesAt: 9 })
    expect(step).toMatchObject({ kind: 'next-step', answerableUntil: 9 })
    const other = attentionFor('idle', summary({ nextStep }), { kind: 'question', releasesAt: 9 })
    expect(other).toMatchObject({ kind: 'next-step', answerableUntil: null })
  })

  it('needs nothing while working, after Stop, or with nothing asked', () => {
    expect(attentionFor('working', summary({ nextStep }))).toBeNull()
    expect(attentionFor('idle', summary({ nextStep, interrupted: true }))).toBeNull()
    expect(attentionFor('idle', summary())).toBeNull()
    expect(attentionFor('idle', null)).toBeNull()
  })
})

describe('stageLine', () => {
  const summary = (over: Partial<TranscriptSummary>): TranscriptSummary => ({
    title: null,
    cwd: null,
    lastPrompt: 'Why?',
    plan: [],
    currentStep: null,
    recap: null,
    lastReply: null,
    lastAction: null,
    activity: 'thinking',
    turnStartedAt: null,
    backgroundTasks: [],
    pendingQuestion: null,
    nextStep: null,
    contextTokens: null,
    model: null,
    lastTouchedPath: null,
    interrupted: false,
    ...over,
  })

  it('says Thinking for a turn with no plan until it writes or calls something', () => {
    expect(stageLine('working', summary({}))).toBe('Thinking')
    expect(isThinking('working', summary({}))).toBe(true)
    expect(isThinking('idle', summary({}))).toBe(false)
  })

  it('shows the reply as it is written, then the step or tool once there is one', () => {
    const replying = summary({ activity: 'replying', lastReply: 'It is  because\nof X.' })
    expect(stageLine('working', replying)).toBe('It is because of X.')
    expect(stageLine('working', summary({ activity: 'tool', lastAction: 'Run tests' }))).toBe(
      'Run tests',
    )
    const step = { index: 2, total: 3, content: 'Build' }
    expect(stageLine('working', summary({ currentStep: step }))).toBe('2/3 · Build')
    expect(isThinking('working', summary({ currentStep: step }))).toBe(false)
  })
})

describe('contextUsed', () => {
  // Only the context size and model matter here.
  const base = { contextTokens: null, model: null } as unknown as TranscriptSummary
  it('measures against a 1M window, or 200k for older models, and is null before any reply', () => {
    expect(contextUsed({ ...base, contextTokens: 520_000, model: 'claude-opus-5-5' }, null)).toBe(
      0.52,
    )
    expect(contextUsed({ ...base, contextTokens: 50_000, model: 'claude-haiku-4-5' }, null)).toBe(
      0.25,
    )
    expect(contextUsed({ ...base, contextTokens: 50_000, model: null }, 'claude-3-opus')).toBe(0.25)
    expect(contextUsed({ ...base, contextTokens: 2_000_000, model: null }, null)).toBe(1)
    expect(contextUsed(base, null)).toBeNull()
    expect(contextUsed(null, null)).toBeNull()
  })
})

describe('gitFolder', () => {
  const summary = (lastTouchedPath: string | null) =>
    ({ lastTouchedPath }) as unknown as TranscriptSummary
  it('prefers the app’s worktree, then the last file touched, then the working folder', () => {
    const app = { worktreePath: 'Z:/repo/.claude/worktrees/x' } as never
    const file = summary('Z:/work/api/src/a.ts')
    expect(gitFolder(app, file, 'Z:/work')).toBe('Z:/repo/.claude/worktrees/x')
    expect(gitFolder(undefined, file, 'Z:/work')).toBe('Z:/work/api/src')
    expect(gitFolder(undefined, summary(null), 'Z:/work')).toBe('Z:/work')
  })
})

describe('Tracker', () => {
  it('lists sessions with app titles, ids and the current stage', async () => {
    await addSession(
      'cli-1',
      [prompt('go'), plan({ items: [{ content: 'Write the fix', status: 'in_progress' }] })],
      MINUTE,
    )
    await writeAppRecord(box.paths, {
      sessionId: 'local_app-1',
      cliSessionId: 'cli-1',
      title: 'Docs site',
      isArchived: false,
      permissionMode: 'default',
      model: 'demo-model',
    })
    hooks.apply({ session_id: 'cli-1', hook_event_name: 'PreToolUse' }, NOW - 1000)

    const [session] = await recent()
    expect(session).toMatchObject({
      id: 'cli-1',
      appId: 'local_app-1',
      title: 'Docs site',
      state: 'working',
      tracked: true,
      stage: '1/1 · Write the fix',
      permissionMode: 'default',
      model: 'demo-model',
    })
  })

  it('carries the pull requests the app linked, skipping dismissed ones', async () => {
    await addSession('cli-1', [prompt('ship it')], MINUTE)
    await writeAppRecord(box.paths, {
      sessionId: 'local_app-1',
      cliSessionId: 'cli-1',
      isArchived: false,
      prs: [
        { prNumber: 3, state: 'CLOSED', dismissed: true },
        { prNumber: 4, state: 'MERGED' },
        { prNumber: 5, state: 'OPEN', isDraft: true },
        { prNumber: 'six', state: 'OPEN' },
      ],
    })
    const [session] = await recent()
    expect(session?.pullRequests).toEqual([
      { number: 4, state: 'merged' },
      { number: 5, state: 'draft' },
    ])
  })

  it('hides archived threads and anything outside the time window', async () => {
    await addSession('cli-archived', [prompt('old work')], MINUTE)
    await writeAppRecord(box.paths, {
      sessionId: 'local_x',
      cliSessionId: 'cli-archived',
      isArchived: true,
    })
    await addSession('cli-ancient', [prompt('last week')], 3 * 24 * 60 * MINUTE)
    expect(await recent()).toEqual([])
  })

  it('marks a stopped session idle straight away', async () => {
    await addSession('cli-1', [prompt('go'), interrupt()], 1000)
    hooks.apply({ session_id: 'cli-1', hook_event_name: 'PreToolUse' }, NOW - 2000)
    const [session] = await recent()
    expect(session?.state).toBe('idle')
  })

  it('orders working, then waiting, then most recent, and caps the list', async () => {
    await addSession('idle-new', [prompt('a'), textReply('done a')], 2 * MINUTE)
    await addSession('idle-old', [prompt('b'), textReply('done b')], 30 * MINUTE)
    await addSession('waiting', [prompt('c')], 5 * MINUTE)
    await addSession('working', [prompt('d')], 10 * MINUTE)
    hooks.apply(
      { session_id: 'waiting', hook_event_name: 'Notification', message: 'needs permission' },
      NOW,
    )
    hooks.apply({ session_id: 'working', hook_event_name: 'UserPromptSubmit' }, NOW)

    const ids = (await recent()).map((s) => s.id)
    expect(ids).toEqual(['working', 'waiting', 'idle-new', 'idle-old'])
    expect((await recent(tracker({ maxSessions: 2 }))).map((s) => s.id)).toEqual([
      'working',
      'waiting',
    ])
  })

  it('shows the last result for idle sessions', async () => {
    await addSession('cli-1', [prompt('go'), textReply('All   tests pass.')], 5 * MINUTE)
    const [session] = await recent()
    expect(session).toMatchObject({ state: 'idle', tracked: false, stage: 'All tests pass.' })
  })

  it('copes with missing folders', async () => {
    await box.cleanup()
    expect(await recent()).toEqual([])
  })
})
