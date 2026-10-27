// Polls the tracker and reports what it finds only when something actually changes.

import { findInSnapshot } from '../../shared/snapshot'
import type { Session, Snapshot, TreeView } from '../../shared/types'
import type { Tracker } from './tracker'

/** A scan is expected to take well under this; longer ones are reported. */
const SLOW_SCAN_MS = 750

export class SessionService {
  private latest: Snapshot = {
    sessions: [],
    workspaces: [],
    allWorkspaces: [],
    currentWorkspace: null,
    currentThreadId: null,
  }
  private latestJson = ''
  private view: TreeView = { expanded: null, showAll: [] }
  private timer: NodeJS.Timeout | null = null
  /** The scan under way, and the one queued behind it for every call made meanwhile. */
  private running: Promise<void> | null = null
  private queued: Promise<void> | null = null

  constructor(
    private readonly tracker: Pick<Tracker, 'snapshot'>,
    private readonly onChange: (snapshot: Snapshot) => void,
    /** Told when a scan took long enough to matter, so a slow history can be seen and measured. */
    private readonly onSlow?: (ms: number, snapshot: Snapshot) => void,
  ) {}

  get sessions(): Session[] {
    return this.latest.sessions
  }

  get snapshot(): Snapshot {
    return this.latest
  }

  /** A session from either the recent list or an open workspace in the tree. */
  find(id: string): Session | undefined {
    return findInSnapshot(this.latest, id)
  }

  /** The UI opened or closed a workspace: rescan now, so its threads appear straight away. */
  setView(view: TreeView): void {
    this.view = view
    void this.refresh()
  }

  start(intervalMs: number): void {
    void this.refresh()
    this.timer = setInterval(() => void this.refresh(), intervalMs)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /**
   * Rescans, resolving once a scan that started after this call has finished, so the caller
   * sees everything that happened before it asked (the Stop hook relies on this). A slow scan
   * never piles up behind itself: every call made meanwhile shares one more run afterwards.
   */
  refresh(): Promise<void> {
    if (!this.running) {
      this.running = this.scan().finally(() => {
        this.running = null
      })
      return this.running
    }
    this.queued ??= this.running.then(() => {
      this.queued = null
      return this.refresh()
    })
    return this.queued
  }

  private async scan(): Promise<void> {
    try {
      const started = performance.now()
      const snapshot = await this.tracker.snapshot(this.view)
      const took = performance.now() - started
      if (took > SLOW_SCAN_MS) this.onSlow?.(took, snapshot)
      const json = JSON.stringify(snapshot)
      if (json !== this.latestJson) {
        this.latest = snapshot
        this.latestJson = json
        this.onChange(snapshot)
      }
    } catch (error) {
      console.error('Session scan failed', error)
    }
  }
}
