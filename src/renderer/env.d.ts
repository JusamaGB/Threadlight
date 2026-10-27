import type { ThreadlightApi } from '../shared/ipc'

declare global {
  interface Window {
    threadlight: ThreadlightApi
  }
}
