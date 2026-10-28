import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { HookStateStore } from '../src/main/sessions/hookState'
import { Tracker } from '../src/main/sessions/tracker'
import type { ThreadNode, Workspace } from '../src/shared/types'
import {
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
const HOUR = 60 * 60 * 1000

let box: Sandbox
let hooks: HookStateStore
let n = 0

beforeEach(async () => {
  box = await sandbox()
  hooks = new HookStateStore()
  n = 0
})
afterEach(() => box.cleanup())

const tracker = (maxSessions = 10, windowHours = 24) =>
  new Tracker({ paths: box.paths, hooks, now: () => NOW, maxSessions, windowHours })

/** A synthetic thread: an app record plus a transcript, in the given workspace folder. */
async function thread(
  workspace: string,
  title: string,
  options: { agoMs?: number; parent?: string; focusedAgoMs?: number; archived?: boolean } = {},
) {
  n += 1
  const cli = `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
  const appId = `local_${cli}`
  const path = transcriptPath(box.paths, 'demo', cli)
  await writeTranscript(path, [prompt(`about ${title}`), textReply(`${title} is done.`)])
  await setModified(path, NOW - (options.agoMs ?? HOUR))
  await writeAppRecord(box.paths, {
    sessionId: appId,
    cliSessionId: cli,
    title,
    originCwd: workspace,
    cwd: workspace,
    isArchived: options.archived ?? false,
    lastActivityAt: NOW - (options.agoMs ?? HOUR),
    lastFocusedAt: options.focusedAgoMs === undefined ? 0 : NOW - options.focusedAgoMs,
    ...(options.parent ? { spawnedFrom: { sessionId: options.parent } } : {}),
  })
  return appId
}

const titles = (nodes: ThreadNode[]): unknown[] =>
  nodes.map((node) =>
    node.children.length ? [node.session.title, titles(node.children)] : node.session.title,
  )
const byName = (workspaces: Workspace[], name: string) => workspaces.find((w) => w.name === name)!

describe('workspace tree', () => {
  it('keeps collapsed rows warm within a budget, prioritizing the selected workspace', async () => {
    await thread('C:\\demo\\new', 'Newest', { agoMs: HOUR })
    await thread('C:\\demo\\selected', 'Selected', { agoMs: 2 * HOUR })
    await thread('C:\\demo\\old', 'Old', { agoMs: 3 * HOUR })
    const limited = new Tracker({ paths: box.paths, hooks, now: () => NOW, treeBudget: 2 })
    const snapshot = await limited.snapshot({
      expanded: ['C:\\demo\\selected'],
      showAll: [],
      preload: true,
    })
    expect(titles(byName(snapshot.workspaces, 'selected').threads)).toEqual(['Selected'])
    expect(titles(byName(snapshot.workspaces, 'new').threads)).toEqual(['Newest'])
    expect(byName(snapshot.workspaces, 'old').threads).toEqual([])
    const collapsed = await limited.snapshot({ expanded: [], showAll: [], preload: true })
    expect(titles(byName(collapsed.workspaces, 'selected').threads)).toEqual(['Selected'])
  })
  it('keeps running rows fixed through messages and permission pauses, then reorders on Stop', async () => {
    const older = await thread('C:\\demo\\stable', 'Older', { agoMs: 2 * HOUR })
    const newer = await thread('C:\\demo\\stable', 'Newer', { agoMs: HOUR })
    const t = tracker()
    const view = { expanded: ['C:\\demo\\stable'], showAll: [] }
    const read = async () => {
      const snapshot = await t.snapshot(view)
      return {
        recent: snapshot.sessions.map((s) => s.title),
        tree: titles(byName(snapshot.workspaces, 'stable').threads),
      }
    }
    const original = { recent: ['Newer', 'Older'], tree: ['Newer', 'Older'] }
    expect(await read()).toEqual(original)
    hooks.apply({ session_id: older.slice(6), hook_event_name: 'UserPromptSubmit' }, NOW)
    hooks.apply({ session_id: newer.slice(6), hook_event_name: 'UserPromptSubmit' }, NOW + 1)
    expect(await read()).toEqual(original)
    hooks.apply({ session_id: older.slice(6), hook_event_name: 'PostToolUse' }, NOW + 1000)
    expect(await read()).toEqual(original)
    hooks.apply(
      { session_id: older.slice(6), hook_event_name: 'Notification', message: 'needs permission' },
      NOW + 2000,
    )
    expect(await read()).toEqual(original)
    hooks.apply({ session_id: older.slice(6), hook_event_name: 'Stop' }, NOW + 3000)
    expect(await read()).toEqual({ recent: ['Older', 'Newer'], tree: ['Older', 'Newer'] })
    hooks.apply({ session_id: newer.slice(6), hook_event_name: 'PostToolUse' }, NOW + 4000)
    expect(await read()).toEqual({ recent: ['Older', 'Newer'], tree: ['Older', 'Newer'] })
  })

  it('groups threads by workspace, alphabetically, ignoring case and archived threads', async () => {
    await thread('C:\\demo\\zebra', 'Z1')
    await thread('C:\\demo\\Apple', 'A1')
    await thread('C:\\demo\\banana', 'B1')
    await thread('C:\\demo\\banana', 'B-old', { archived: true })
    const { workspaces } = await tracker().snapshot()
    expect(workspaces.map((w) => w.name)).toEqual(['Apple', 'banana', 'zebra'])
    expect(byName(workspaces, 'banana').threadCount).toBe(1)
  })

  it('opens the workspace of the thread last focused in Claude, and only that one', async () => {
    await thread('C:\\demo\\one', 'Older focus', { focusedAgoMs: 5 * HOUR })
    await thread('C:\\demo\\two', 'Latest focus', { focusedAgoMs: HOUR })
    const { workspaces, currentWorkspace } = await tracker().snapshot()
    expect(currentWorkspace).toBe('C:\\demo\\two')
    expect(titles(byName(workspaces, 'two').threads)).toEqual(['Latest focus'])
    expect(byName(workspaces, 'one').threads).toEqual([]) // collapsed: nothing read
  })

  it('nests side threads under the thread that started them, newest first', async () => {
    const parent = await thread('C:\\demo\\ws', 'Parent', { agoMs: 3 * HOUR })
    await thread('C:\\demo\\ws', 'Child old', { agoMs: 2 * HOUR, parent })
    await thread('C:\\demo\\ws', 'Child new', { agoMs: HOUR, parent })
    await thread('C:\\demo\\ws', 'Solo', { agoMs: 0.5 * HOUR })
    const { workspaces } = await tracker().snapshot({ expanded: ['C:\\demo\\ws'], showAll: [] })
    expect(titles(byName(workspaces, 'ws').threads)).toEqual([
      'Solo',
      ['Parent', ['Child new', 'Child old']],
    ])
  })

  it('keeps a side thread under its parent even when it works in another folder', async () => {
    const parent = await thread('C:\\demo\\home', 'Parent')
    await thread('C:\\demo\\elsewhere', 'Side thread', { parent })
    const { workspaces } = await tracker().snapshot({ expanded: ['C:\\demo\\home'], showAll: [] })
    expect(workspaces.map((w) => w.name)).toEqual(['home']) // no "elsewhere" group of its own
    expect(titles(byName(workspaces, 'home').threads)).toEqual([['Parent', ['Side thread']]])
  })

  it('shows the most recent threads first, and the rest on request', async () => {
    for (let i = 0; i < 5; i++) await thread('C:\\demo\\busy', `T${i}`, { agoMs: (i + 1) * HOUR })
    const view = { expanded: ['C:\\demo\\busy'], showAll: [] as string[] }
    let ws = byName((await tracker(3).snapshot(view)).workspaces, 'busy')
    expect(titles(ws.threads)).toEqual(['T0', 'T1', 'T2'])
    expect(ws.hiddenCount).toBe(2)
    ws = byName(
      (await tracker(3).snapshot({ ...view, showAll: ['c:\\DEMO\\busy\\'] })).workspaces,
      'busy',
    )
    expect(ws.threads).toHaveLength(5) // paths match regardless of case and trailing slash
    expect(ws.hiddenCount).toBe(0)
  })

  it('only lists threads active within "Show sessions from the last"', async () => {
    await thread('C:\\demo\\fresh', 'Today', { agoMs: 2 * HOUR })
    await thread('C:\\demo\\fresh', 'Last week', { agoMs: 7 * 24 * HOUR })
    await thread('C:\\demo\\stale', 'Old only', { agoMs: 5 * 24 * HOUR })
    const view = { expanded: ['C:\\demo\\fresh', 'C:\\demo\\stale'], showAll: [] }
    const { workspaces } = await tracker(10, 24).snapshot(view)
    expect(workspaces.map((w) => w.name)).toEqual(['fresh']) // nothing recent in "stale"
    expect(byName(workspaces, 'fresh')).toMatchObject({ threadCount: 1 })
    expect(titles(byName(workspaces, 'fresh').threads)).toEqual(['Today'])
    // A wider window brings them back.
    const wide = (await tracker(10, 168).snapshot(view)).workspaces
    expect(wide.map((w) => w.name)).toEqual(['fresh', 'stale'])
  })

  it('never builds more than its budget of threads, however many workspaces are open', async () => {
    // Eight workspaces of two threads each, the newest first, all within the widest window.
    const names: string[] = []
    for (let w = 0; w < 8; w++) {
      const folder = `C:\\demo\\w${w}`
      names.push(`w${w}`)
      await thread(folder, `W${w}a`, { agoMs: (2 + w * 3) * HOUR })
      await thread(folder, `W${w}b`, { agoMs: (3 + w * 3) * HOUR })
    }
    const view = {
      expanded: names.map((name) => `C:\\demo\\${name}`),
      showAll: [] as string[],
    }
    const limited = new Tracker({
      paths: box.paths,
      hooks,
      now: () => NOW,
      maxSessions: 10,
      windowHours: 168,
      treeBudget: 6,
    })
    const { workspaces } = await limited.snapshot(view)
    // Every workspace is still listed with its count, but only the newest three are built.
    expect(workspaces).toHaveLength(8)
    expect(workspaces.every((w) => w.threadCount === 2)).toBe(true)
    const loaded = workspaces.filter((w) => w.threads.length > 0).map((w) => w.name)
    expect(loaded).toEqual(['w0', 'w1', 'w2'])
    // The rest wait to be asked for, and asking for one loads it despite the budget.
    expect(byName(workspaces, 'w7')).toMatchObject({ threads: [], hiddenCount: 2 })
    const asked = await limited.snapshot({ ...view, showAll: ['C:\\demo\\w7'] })
    expect(titles(byName(asked.workspaces, 'w7').threads)).toEqual(['W7a', 'W7b'])
  })

  it('fills a workspace over a few scans when its transcripts are read a few at a time', async () => {
    for (let i = 0; i < 6; i++)
      await thread('C:\\demo\\big', `Thread ${i}`, { agoMs: (i + 1) * HOUR })
    const rationed = new Tracker({
      paths: box.paths,
      hooks,
      now: () => NOW,
      maxSessions: 10,
      windowHours: 24,
      coldBuilds: 2,
    })
    const view = { expanded: ['C:\\demo\\big'], showAll: [] as string[] }
    const loaded = async () => byName((await rationed.snapshot(view)).workspaces, 'big').threads
    expect(titles(await loaded())).toEqual(['Thread 0', 'Thread 1'])
    expect(titles(await loaded())).toHaveLength(4)
    expect(titles(await loaded())).toHaveLength(6)
  })

  it('still offers every workspace for choosing one, whatever the window', async () => {
    await thread('C:\\demo\\fresh', 'Today', { agoMs: 2 * HOUR })
    await thread('C:\\demo\\stale', 'Old only', { agoMs: 5 * 24 * HOUR })
    const { allWorkspaces } = await tracker(10, 24).snapshot()
    expect(allWorkspaces).toEqual([
      { id: 'C:\\demo\\fresh', name: 'fresh' },
      { id: 'C:\\demo\\stale', name: 'stale' },
    ])
  })

  it('keeps an old parent when one of its side threads is recent', async () => {
    const parent = await thread('C:\\demo\\ws', 'Old parent', { agoMs: 5 * 24 * HOUR })
    await thread('C:\\demo\\ws', 'Recent child', { agoMs: HOUR, parent })
    await thread('C:\\demo\\ws', 'Old child', { agoMs: 6 * 24 * HOUR, parent })
    const { workspaces } = await tracker(10, 24).snapshot({
      expanded: ['C:\\demo\\ws'],
      showAll: [],
    })
    expect(titles(byName(workspaces, 'ws').threads)).toEqual([['Old parent', ['Recent child']]])
  })

  it('marks a collapsed workspace that has a thread working', async () => {
    await thread('C:\\demo\\quiet', 'Idle one')
    await thread('C:\\demo\\loud', 'Busy one', { agoMs: 5_000 }) // transcript just changed
    const { workspaces } = await tracker().snapshot({ expanded: [], showAll: [] })
    expect(byName(workspaces, 'loud')).toMatchObject({ anyWorking: true, activeCount: 1 })
    expect(byName(workspaces, 'quiet')).toMatchObject({ anyWorking: false, activeCount: 0 })
  })

  it('lists every workspace in full for All drives, however many there are', async () => {
    for (let k = 0; k < 40; k++) await thread(`C:\\demo\\w${k}`, `Thread ${k}`, { agoMs: HOUR + k })
    const live = tracker()
    const view = { expanded: [], showAll: [], everything: true }
    await live.snapshot(view) // first-time reads are rationed per scan; the rest follow
    const { workspaces } = await live.snapshot(view)
    expect(workspaces.flatMap((w) => w.threads)).toHaveLength(40)
  })
})
