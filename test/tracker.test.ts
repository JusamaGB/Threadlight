import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { HookStateStore } from '../src/main/sessions/hookState'
import {
  attentionFor,
  FALLBACK_ACTIVE_MS,
  resolveState,
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
    turnStartedAt: null,
    backgroundTasks: [],
    pendingQuestion: null,
    nextStep: null,
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
    })
    expect(attentionFor('idle', summary({ nextStep }))).toEqual({ kind: 'next-step', ...nextStep })
  })

  it('marks a question card answerable while Threadlight holds it', () => {
    const held = attentionFor('working', summary({ pendingQuestion: question }), {
      releasesAt: 123,
    })
    expect(held).toMatchObject({ kind: 'question', answerableUntil: 123 })
  })

  it('needs nothing while working, after Stop, or with nothing asked', () => {
    expect(attentionFor('working', summary({ nextStep }))).toBeNull()
    expect(attentionFor('idle', summary({ nextStep, interrupted: true }))).toBeNull()
    expect(attentionFor('idle', summary())).toBeNull()
    expect(attentionFor('idle', null)).toBeNull()
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
