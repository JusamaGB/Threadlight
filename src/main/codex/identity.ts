export const CODEX_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const codexKey = (id: string): string => `codex:${id}`
export function codexId(key: string): string | null {
  const id = key.startsWith('codex:') ? key.slice(6) : ''
  return CODEX_UUID.test(id) ? id : null
}
export function codexDeepLink(key: string): string | null {
  const id = codexId(key)
  return id ? `codex://threads/${id}` : null
}
