import { useEffect, useSyncExternalStore } from 'react'
import {
  COMPOSER_FILE_LIMIT,
  type ComposerAttachment,
  type ComposerAttachmentsRequest,
} from '../../shared/composerAttachments'

type State = { items: ComposerAttachment[]; loading: boolean; busy: boolean; error: string | null }
class Attachments {
  private state: State = { items: [], loading: true, busy: false, error: null }
  private listeners = new Set<() => void>()
  private started = false
  constructor(private threadId: string) {}
  snapshot = () => this.state
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  private patch(next: Partial<State>) {
    this.state = { ...this.state, ...next }
    for (const listener of this.listeners) listener()
  }
  load = async () => {
    if (this.started) return
    this.started = true
    if (!this.threadId.startsWith('codex:')) {
      this.patch({ loading: false })
      return
    }
    try {
      await this.request({ action: 'list', threadId: this.threadId })
    } catch (error) {
      this.patch({ error: error instanceof Error ? error.message : 'Attachments unavailable.' })
    } finally {
      this.patch({ loading: false })
    }
  }
  private async request(input: ComposerAttachmentsRequest) {
    const reply = await window.threadlight.composerAttachments(input)
    if (!reply.ok) throw Error(reply.reason)
    this.patch({ items: reply.items })
  }
  private async work(action: () => Promise<void>) {
    if (this.state.busy) return
    this.patch({ busy: true, error: null })
    try {
      await action()
    } catch (error) {
      // A multi-file picker can stage earlier files before a later file is rejected.
      await this.request({ action: 'list', threadId: this.threadId }).catch(() => {})
      this.patch({ error: error instanceof Error ? error.message : 'Could not attach files.' })
    } finally {
      this.patch({ busy: false })
    }
  }
  add = (files: File[]) =>
    this.work(async () => {
      for (const file of files) {
        if (file.size > COMPOSER_FILE_LIMIT) throw Error('Files must be 512 MiB or smaller.')
        const path = window.threadlight.composerFilePath(file)
        await this.request({
          action: 'add',
          threadId: this.threadId,
          file: {
            name: file.name || 'pasted-image.png',
            ...(path ? { path } : { bytes: new Uint8Array(await file.arrayBuffer()) }),
          },
        })
      }
    })
  pick = () => this.work(() => this.request({ action: 'pick', threadId: this.threadId }))
  remove = (id: string) =>
    this.work(() => this.request({ action: 'remove', threadId: this.threadId, id }))
  accepted = (ids: string[]) => {
    this.patch({ items: this.state.items.filter((item) => !ids.includes(item.id)), error: null })
  }
}
const controllers = new Map<string, Attachments>()
export function useComposerAttachments(threadId: string) {
  let controller = controllers.get(threadId)
  if (!controller) {
    controller = new Attachments(threadId)
    controllers.set(threadId, controller)
  }
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot)
  useEffect(() => {
    void controller.load()
  }, [controller])
  return {
    ...state,
    add: controller.add,
    pick: controller.pick,
    remove: controller.remove,
    accepted: controller.accepted,
  }
}
