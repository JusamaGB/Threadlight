import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import type { CliCommand } from '../relay'

// Installed-runtime probe: two independent resumes of the SAME disposable native
// thread. This binary rejects the competing writer with thread-store conflict.
// Claude's tested resume permitted both writers and is deliberately not admitted.
const CODEX_OWNERSHIP_HASH = '1103e9e09c71fa2cd0afd6d8f3b9a2d63174fe8efd7cb5bd09f1cb14ef58a098'
let cached: { key: string; admitted: boolean } | undefined
export async function codexCommunicationAdmitted(cli: CliCommand | null) {
  if (!cli || cli.prefixArgs.length) return false
  const info = await stat(cli.command)
  const key = `${cli.command}:${info.size}:${info.mtimeMs}`
  if (cached?.key === key) return cached.admitted
  const hash = createHash('sha256')
    .update(await readFile(cli.command))
    .digest('hex')
  const admitted = hash === CODEX_OWNERSHIP_HASH
  cached = { key, admitted }
  return admitted
}
