export interface MemoryPluginConnection {
  id: string
  code: string
  provider: 'claude' | 'codex'
  label: string
  /** Requester-supplied native identity; the human still matches the code and approves. */
  chatId?: string
  /** Immutable Shared Space destination; absent only on legacy requests. */
  spaceId?: string
  projectName?: string
  state: 'pending' | 'approved' | 'connected' | 'rejected'
  /** Zero means the approved link lasts until explicitly disconnected/revoked. */
  expiresAt: number
  grantId?: string
  lastUsedAt?: number
}
