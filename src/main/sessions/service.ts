// Polls the tracker and reports what it finds only when something actually changes.

import { findInSnapshot } from '../../shared/snapshot'
import type { Session, Snapshot, TreeView } from '../../shared/types'
import type { Tracker } from './tracker'

export class SessionService {
  private latest: Snapshot = {
    sessions: [],
    workspaces: [],
    allWorkspaces: [],
    currentWorkspace: null,
  }
  private latestJson = ''
  private view: TreeView = { expanded: null, showAll: [] }
  private timer: NodeJS.Timeout | null = null
  private running = false
  private again = false

  constructor(
    private readonly tracker: Tracker,
    private readonly onChange: (snapshot: Snapshot) => void,
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

  async refresh(): Promise<void> {
    // A slow scan must not pile up behind itself; one more run afterwards is enough.
    if (this.running) {
      this.again = true
      return
    }
    this.running = true
    try {
      const snapshot = await this.tracker.snapshot(this.view)
      const json = JSON.stringify(snapshot)
      if (json !== this.latestJson) {
        this.latest = snapshot
        this.latestJson = json
        this.onChange(snapshot)
      }
    } catch (error) {
      console.error('Session scan failed', error)
    } finally {
      this.running = false
    }
    if (this.again) {
      this.again = false
      await this.refresh()
    }
  }
}
