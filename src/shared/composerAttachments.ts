export const COMPOSER_FILE_LIMIT = 512 * 1024 * 1024
export interface ComposerAttachment {
  id: string
  name: string
  size: number
  kind: 'image' | 'file'
}
export type ComposerFileInput = { name: string; path?: string; bytes?: Uint8Array }
export type ComposerAttachmentsRequest =
  | { action: 'list'; threadId: string }
  | { action: 'add'; threadId: string; file: ComposerFileInput }
  | { action: 'pick'; threadId: string }
  | { action: 'remove'; threadId: string; id: string }
export type ComposerAttachmentsReply =
  { ok: true; items: ComposerAttachment[] } | { ok: false; reason: string }
