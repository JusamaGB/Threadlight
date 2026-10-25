// The one contract between the UI (renderer) and the Node side (main).
// Channel names and payload types live here so both sides stay in step.

export const IPC = {
  getVersion: 'threadlight:get-version',
} as const

/** What the preload script exposes on `window.threadlight`. */
export interface ThreadlightApi {
  getVersion(): Promise<string>
}
