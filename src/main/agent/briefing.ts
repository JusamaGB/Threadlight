// What the agent is told about the user's threads with each question, so "the +847 on Thread
// activity indicator" means something to it. It is the same data Threadlight shows, as text:
// enough to answer most questions outright, and the folders to look in for the rest.

import type { Session, Snapshot, ThreadNode } from '../../shared/types'

/** The briefing's thread list stops here, newest first. */
const MAX_THREADS = 30

/** Every thread Threadlight lists, once, newest first. */
export function listedThreads(snapshot: Snapshot): Session[] {
  const walk = (nodes: ThreadNode[]): Session[] =>
    nodes.flatMap((node) => [node.session, ...walk(node.children)])
  const seen = new Set<string>()
  return [...snapshot.sessions, ...snapshot.workspaces.flatMap((w) => walk(w.threads))]
    .filter((s) => !seen.has(s.id) && seen.add(s.id))
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
}

/** The folders the agent may read and run read-only git in: each thread's folder and repository. */
export function readableFolders(snapshot: Snapshot): string[] {
  const folders = new Set<string>()
  for (const session of listedThreads(snapshot)) {
    if (session.cwd) folders.add(session.cwd)
    if (session.git?.root) folders.add(session.git.root)
  }
  return [...folders]
}

/** The briefing, as a block the front desk reads before the user's message. */
export function briefing(snapshot: Snapshot, now = Date.now()): string {
  const threads = listedThreads(snapshot).slice(0, MAX_THREADS)
  const lines = threads.map((s) => threadLine(s, now))
  return [
    '<threadlight-briefing>',
    "The user's Claude threads as Threadlight shows them, newest first. A thread's numbers like",
    '"+847 −3" are lines changed in its git folder since the last commit (new files count as',
    'added); "↑2" is commits to push, "↓5" commits behind main. You may read files in these',
    'folders and run read-only git there (status, log, diff, show) without asking.',
    ...lines,
    '</threadlight-briefing>',
  ].join('\n')
}

function threadLine(s: Session, now: number): string {
  const parts = [
    `- "${s.title}"`,
    s.state,
    s.attention ? 'needs the user' : null,
    s.cwd ? `folder ${s.cwd}` : null,
    s.git ? gitPart(s) : null,
    s.currentStep
      ? `step ${s.currentStep.index}/${s.currentStep.total}: ${s.currentStep.content}`
      : null,
    `active ${ago(now - s.lastActiveAt)} ago`,
  ]
  return parts.filter(Boolean).join(' · ')
}

function gitPart(s: Session): string {
  const git = s.git!
  const changes =
    git.files > 0
      ? `${git.files} files uncommitted (${git.newFiles} new), +${git.added} −${git.removed}`
      : 'nothing uncommitted'
  return [
    `git ${git.root} on ${git.branch ?? 'no branch'}`,
    changes,
    git.ahead > 0 ? `↑${git.ahead} to push` : null,
    git.behind > 0 ? `↓${git.behind} behind main` : null,
  ]
    .filter(Boolean)
    .join(', ')
}

function ago(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  return hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`
}
