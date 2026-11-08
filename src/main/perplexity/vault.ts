import { mkdir, lstat, readFile, writeFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  OAuthClientInformationMixed,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js'

export interface PerplexitySaved {
  client?: OAuthClientInformationMixed
  tokens?: OAuthTokens
  redirectUrl?: string
  threads: { id: string; title: string }[]
  operations: { id: string; state: 'pending' | 'done' | 'uncertain'; threadId?: string }[]
}
export interface SecretEncryption {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}
/** Electron safeStorage uses Windows DPAPI; there is no plaintext fallback. */
export class PerplexityVault {
  value: PerplexitySaved = { threads: [], operations: [] }
  private queue: Promise<void> = Promise.resolve()
  constructor(
    private directory: string,
    private encryption: SecretEncryption,
  ) {}
  private get file() {
    return join(this.directory, 'connection.bin')
  }
  async load() {
    if (!this.encryption.isEncryptionAvailable())
      throw new Error('Windows encrypted credential storage is unavailable.')
    await mkdir(this.directory, { recursive: true })
    if ((await lstat(this.directory)).isSymbolicLink())
      throw new Error('Perplexity storage cannot be a link.')
    try {
      const info = await lstat(this.file)
      if (info.isSymbolicLink() || !info.isFile() || info.size > 1024 * 1024)
        throw new Error('Invalid Perplexity credential file.')
      const value = JSON.parse(
        this.encryption.decryptString(await readFile(this.file)),
      ) as PerplexitySaved
      if (!Array.isArray(value.threads) || !Array.isArray(value.operations))
        throw new Error('Invalid Perplexity state.')
      this.value = value
      for (const operation of this.value.operations)
        if (operation.state === 'pending') operation.state = 'uncertain'
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw new Error(
          'Perplexity connection data could not be decrypted. Disconnect to clear it.',
          { cause: error },
        )
    }
  }
  save() {
    // Capture each revision before queueing; atomic replacement preserves the previous file on failure.
    const value = JSON.stringify(this.value)
    const work = this.queue.then(async () => {
      if (!this.encryption.isEncryptionAvailable())
        throw new Error('Encrypted storage is unavailable.')
      const temp = join(this.directory, `${randomUUID()}.tmp`)
      try {
        await writeFile(temp, this.encryption.encryptString(value), { flag: 'wx', mode: 0o600 })
        await rename(temp, this.file)
      } finally {
        await rm(temp, { force: true })
      }
    })
    this.queue = work.catch(() => {})
    return work
  }
  async clearCredentials() {
    delete this.value.client
    delete this.value.tokens
    delete this.value.redirectUrl
    await this.save()
  }
}
