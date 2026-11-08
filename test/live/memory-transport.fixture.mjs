import { randomBytes } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Opt-in proofs must never rotate a running application's bootstrap credentials.
export function memoryFixture(root) {
  const key = randomBytes(32),
    directory = join(root, 'transport-auth'),
    authFile = join(directory, 'server.key')
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  writeFileSync(authFile, key.toString('hex'), { mode: 0o600 })
  return { key, directory, authFile }
}
