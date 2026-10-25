// Merges the three sources (hook state, transcripts, Claude app records) into the
// session list the UI shows. Keeps one TranscriptReader per session between calls.

import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

import type { Session, SessionState } from '../../shared/types'
import { AppRecordIndex } from './appRecords'
import type { HookStateStore } from './hookState'
import { oneLine } from './json'
import type { ClaudePaths } from './paths'
import { TranscriptReader, type TranscriptSummary } from './transcript'

/** "Working" with no heartbeat for this long means the session crashed or was killed. */
export const STALE_MS = 10 * 60 * 1000
/** For sessions without hook events: a transcript this fresh counts as working. */
export const FALLBACK_ACTIVE_MS = 30 * 1000

export interface TrackerOptions {
  paths: ClaudePaths
  hooks: HookStateStore
  /** Only sessions active within this window are listed. */
  windowHours?: number
  maxSessions?: number
  now?: () => number
}

interface TranscriptFile {
  path: string
  mtimeMs: number
}

const ORDER: Record<SessionState, number> = { working: 0, waiting: 1, idle: 2 }

export class Tracker {
  private readers = new Map<string, TranscriptReader>()
  private appRecords: AppRecordIndex
  private readonly windowMs: number
  private readonly maxSessions: number
  private readonly now: () => number

  constructor(private readonly options: TrackerOptions) {
    this.appRecords = new AppRecordIndex(options.paths.appSessionsDir)
    this.windowMs = (options.windowHours ?? 24) * 60 * 60 * 1000
    this.maxSessions = options.maxSessions ?? 10
    this.now = options.now ?? Date.now
  }

  /** Working sessions first, then waiting, then most recently active. */
  async snapshot(): Promise<Session[]> {
    const now = this.now()
    const [files, apps] = await Promise.all([this.findTranscripts(now), this.appRecords.refresh()])
    const hooks = new Map(this.options.hooks.all(now).map((h) => [h.sessionId, h]))

    const sessions: Session[] = []
    for (const id of new Set([...files.keys(), ...hooks.keys()])) {
      const app = apps.get(id)
      if (app?.archived) continue
      const hook = hooks.get(id)
      const file =
        files.get(id) ?? (hook?.transcriptPath ? { path: hook.transcriptPath, mtimeMs: 0 } : null)
      const summary = file ? await this.read(id, file.path) : null

      const lastActiveAt = Math.max(file?.mtimeMs ?? 0, hook?.updatedAt ?? 0)
      const state = resolveState({
        hookState: hook?.state ?? null,
        lastActiveAt,
        transcriptChangedAt: file?.mtimeMs ?? 0,
        interrupted: summary?.interrupted ?? false,
        now,
      })
      const cwd = hook?.cwd ?? app?.cwd ?? summary?.cwd ?? ''
      sessions.push({
        id,
        appId: app?.appId ?? null,
        title: oneLine(app?.title ?? summary?.title ?? lastPathPart(cwd) ?? id.slice(0, 8)),
        state,
        tracked: hook !== undefined,
        cwd,
        lastActiveAt,
        stage: stageLine(state, summary),
        lastPrompt: summary?.lastPrompt ?? null,
        plan: summary?.plan ?? [],
        currentStep: summary?.currentStep ?? null,
        recap: summary?.recap ?? null,
        lastReply: summary?.lastReply ?? null,
        lastAction: summary?.lastAction ?? null,
        permissionMode: app?.permissionMode ?? null,
        model: app?.model ?? null,
      })
    }
    sessions.sort((a, b) => ORDER[a.state] - ORDER[b.state] || b.lastActiveAt - a.lastActiveAt)
    return sessions.slice(0, this.maxSessions)
  }

  private async read(id: string, path: string): Promise<TranscriptSummary> {
    let reader = this.readers.get(id)
    if (!reader || reader.path !== path) {
      reader = new TranscriptReader(path)
      this.readers.set(id, reader)
    }
    await reader.update()
    return reader.summary()
  }

  /** `<projectsDir>/<project>/<sessionId>.jsonl`, modified within the window. */
  private async findTranscripts(now: number): Promise<Map<string, TranscriptFile>> {
    const found = new Map<string, TranscriptFile>()
    const cutoff = now - this.windowMs
    let projects: string[]
    try {
      const entries = await readdir(this.options.paths.projectsDir, { withFileTypes: true })
      projects = entries
        .filter((e) => e.isDirectory())
        .map((e) => join(this.options.paths.projectsDir, e.name))
    } catch {
      return found
    }
    for (const project of projects) {
      let entries
      try {
        entries = await readdir(project, { withFileTypes: true })
      } catch {
        continue
      }
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue
        const path = join(project, entry.name)
        try {
          const { mtimeMs } = await stat(path)
          if (mtimeMs > cutoff) found.set(entry.name.slice(0, -'.jsonl'.length), { path, mtimeMs })
        } catch {
          // deleted between listing and stat
        }
      }
    }
    return found
  }
}

export interface StateInputs {
  hookState: SessionState | null
  lastActiveAt: number
  transcriptChangedAt: number
  interrupted: boolean
  now: number
}

/** The rules for what state a session is in. Pure, so it is easy to test. */
export function resolveState(input: StateInputs): SessionState {
  // Stop has no hook event; the transcript's interrupt marker is the only signal.
  if (input.interrupted) return 'idle'
  if (input.hookState !== null) {
    const active = input.hookState !== 'idle'
    return active && input.now - input.lastActiveAt > STALE_MS ? 'idle' : input.hookState
  }
  return input.now - input.transcriptChangedAt < FALLBACK_ACTIVE_MS ? 'working' : 'idle'
}

/** One line for the row: the current step while working, the result once done. */
export function stageLine(state: SessionState, summary: TranscriptSummary | null): string {
  if (!summary) return state === 'working' ? 'Working' : 'Idle'
  if (state === 'idle') return oneLine(summary.recap ?? summary.lastReply) || 'Idle'
  const prefix = state === 'waiting' ? 'Needs approval · ' : ''
  const step = summary.currentStep
  if (step) return `${prefix}${step.index}/${step.total} · ${step.content}`
  return prefix + (summary.lastAction ?? 'Working')
}

function lastPathPart(path: string): string | null {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? null
}
