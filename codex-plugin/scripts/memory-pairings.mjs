// Private bridge credentials inherit the app's protected memory-auth directory.
// Never place this cache in the workspace, shared documents or tool responses.
import { lstatSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { memoryAuthFile } from './memory-transport.mjs'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function directory() {
  const path = dirname(memoryAuthFile())
  const stat = lstatSync(path)
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw Error('Private pairing directory unavailable.')
  return path
}
function pathFor(provider, id) {
  if (!['claude', 'codex'].includes(provider) || !uuid.test(id))
    throw Error('Invalid pairing identity.')
  return join(directory(), `pairing-${provider}-${id}.json`)
}
function read(provider, id) {
  const path = pathFor(provider, id),
    stat = lstatSync(path, { throwIfNoEntry: false })
  if (!stat) return undefined
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1 ||
    stat.size > 4096 ||
    (process.platform !== 'win32' && stat.mode & 0o077)
  )
    throw Error('Private pairing file is not protected.')
  const r = JSON.parse(readFileSync(path, 'utf8'))
  if (
    r.id !== id ||
    r.provider !== provider ||
    !uuid.test(r.spaceId) ||
    !uuid.test(r.chatId) ||
    !/^[a-f0-9]{64}$/.test(r.secret) ||
    typeof r.label !== 'string' ||
    r.label.length > 80
  )
    throw Error('Private pairing file is invalid.')
  return {
    id: r.id,
    provider,
    spaceId: r.spaceId,
    chatId: r.chatId,
    secret: r.secret,
    label: r.label,
  }
}
export function savePairing(r) {
  if (!uuid.test(r.chatId)) return // An unidentified request cannot be silently rebound after restart.
  if (
    !uuid.test(r.spaceId) ||
    !/^[a-f0-9]{64}$/.test(r.secret) ||
    typeof r.label !== 'string' ||
    !r.label.trim() ||
    r.label.length > 80
  )
    throw Error('Invalid private pairing identity.')
  const path = pathFor(r.provider, r.id),
    old = read(r.provider, r.id)
  if (old) {
    if (
      JSON.stringify(old) !==
      JSON.stringify({
        id: r.id,
        provider: r.provider,
        spaceId: r.spaceId,
        chatId: r.chatId,
        secret: r.secret,
        label: r.label,
      })
    )
      throw Error('Private pairing identity changed.')
    return
  }
  writeFileSync(path, JSON.stringify(r), { flag: 'wx', mode: 0o600 })
}
export function restorePairing(provider, { connectionId, chatId, spaceId }) {
  if (!uuid.test(chatId) || !uuid.test(spaceId)) return undefined
  const ids = connectionId
    ? [connectionId]
    : readdirSync(directory())
        .filter((name) => name.startsWith(`pairing-${provider}-`) && name.endsWith('.json'))
        .map((name) => name.slice(`pairing-${provider}-`.length, -5))
  const matches = ids
    .map((id) => read(provider, id))
    .filter((r) => r && r.chatId === chatId && r.spaceId === spaceId)
  if (matches.length > 1)
    throw Error('Multiple saved links match. Supply this chat’s original connectionId.')
  return matches[0]
}
export function removePairing(r) {
  const path = pathFor(r.provider, r.id)
  if (lstatSync(path, { throwIfNoEntry: false })) unlinkSync(path)
}
