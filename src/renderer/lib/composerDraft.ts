import { useEffect, useSyncExternalStore } from 'react'
import { ComposerDraftController } from '../../shared/composerDraft'

const controllers = new Map<string, ComposerDraftController>()
export function useComposerDraft(id: string, initial: string) {
  let controller = controllers.get(id)
  if (!controller) {
    controller = new ComposerDraftController(id, window.threadlight)
    controllers.set(id, controller)
  }
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot)
  useEffect(() => {
    controller.start(initial)
  }, [controller, initial])
  return { ...state, setText: controller.set, flush: () => controller.flush() }
}
