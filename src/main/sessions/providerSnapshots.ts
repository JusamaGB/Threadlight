import type { Provider, Snapshot } from '../../shared/types'

const empty = (): Snapshot => ({
  sessions: [],
  workspaces: [],
  allWorkspaces: [],
  currentWorkspace: null,
  currentThreadId: null,
})

/** Keep the previous complete pair visible while a new provider batch is being read. */
export class ProviderSnapshots {
  private pending = { claude: empty(), codex: empty() }
  private visible = this.pending
  private batches = 0
  constructor(private readonly changed: () => void) {}
  get snapshots() {
    return this.visible
  }
  update(provider: Provider, snapshot: Snapshot) {
    this.pending = { ...this.pending, [provider]: snapshot }
    if (!this.batches) this.commit()
  }
  async batch(work: () => Promise<unknown>): Promise<void> {
    this.batches++
    try {
      await work()
    } finally {
      if (!--this.batches) this.commit()
    }
  }
  private commit() {
    if (this.pending === this.visible) return
    this.visible = this.pending
    this.changed()
  }
}
