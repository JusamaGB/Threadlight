import type { ThreadlightApi } from './ipc'

type DraftApi = Pick<ThreadlightApi, 'getComposerDraft' | 'saveComposerDraft'>

/** Shared across composer mounts so a late save cannot overwrite a reopened chat's draft. */
export class ComposerDraftController {
  state = { text: '', loading: true, reviewRequired: false, error: null as string | null }
  private revision = 0
  private listeners = new Set<() => void>()
  private started = false
  private tail: Promise<void> = Promise.resolve()
  private initialValues = new Set<string>()

  constructor(
    private readonly id: string,
    private readonly api: DraftApi,
  ) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  snapshot = () => this.state

  start(initial: string) {
    if (!this.started) {
      this.started = true
      this.tail = this.api
        .getComposerDraft(this.id)
        .then((result) => {
          if (!result.ok) throw new Error(result.reason)
          this.revision = result.draft.revision
          this.publish({
            text: result.draft.text,
            loading: false,
            reviewRequired: !!result.draft.text,
            error: null,
          })
        })
        .catch(() =>
          this.publish({
            ...this.state,
            loading: false,
            error: 'Saved drafts could not be loaded. Keep a copy of your text before closing.',
          }),
        )
    }
    if (initial && !this.initialValues.has(initial)) {
      this.initialValues.add(initial)
      this.tail = this.tail.then(() => {
        if (this.state.text) this.publish({ ...this.state, reviewRequired: true })
        this.set((current) => (current ? `${current.trimEnd()}\n${initial}` : initial))
      })
    }
  }

  set = (value: string | ((previous: string) => string)) => {
    if (this.state.loading) {
      this.tail = this.tail.then(() => this.set(value))
      return
    }
    const text = typeof value === 'function' ? value(this.state.text) : value
    this.publish({ ...this.state, text, reviewRequired: !!text && this.state.reviewRequired })
    this.tail = this.tail.then(async () => {
      if (this.state.error) return
      try {
        const result = await this.api.saveComposerDraft(this.id, text, this.revision)
        if (!result.ok) throw new Error(result.reason)
        this.revision = result.draft.revision
      } catch {
        this.publish({
          ...this.state,
          error: 'Draft not saved. Keep a copy before closing Threadlight.',
        })
      }
    })
  }

  async flush() {
    // A load may enqueue the initial spoken text while it completes.
    let pending: Promise<void>
    do {
      pending = this.tail
      await pending
    } while (pending !== this.tail)
    if (this.state.error) throw new Error(this.state.error)
  }

  private publish(state: typeof this.state) {
    this.state = state
    for (const listener of this.listeners) listener()
  }
}
