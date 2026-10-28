export interface QueuedMessage {
  id: string
  text: string
  images: number
  editable: boolean
}
export type QueueCommand =
  | { action: 'list' }
  | { action: 'remove'; id: string }
  | { action: 'steer'; id: string }
  | { action: 'edit'; id: string; text: string }
export type QueueResult = { ok: true; items: QueuedMessage[] } | { ok: false; reason: string }
