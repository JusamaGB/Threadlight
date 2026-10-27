export interface MemoryPluginConnection {
  id: string
  code: string
  provider: 'claude' | 'codex'
  label: string
  state: 'pending' | 'approved' | 'connected' | 'rejected'
  expiresAt: number
  grantId?: string
  lastUsedAt?: number
}
