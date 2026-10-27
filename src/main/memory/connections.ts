import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import { z } from 'zod'
import type { MemoryInput } from '../../shared/memory'
import type { MemoryPluginConnection } from '../../shared/memoryPlugins'
import { MemoryStore, MemoryError } from './store'

const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const requestSchema = z
  .object({
    action: z.enum(['request', 'status', 'disconnect']),
    id: z.string().uuid(),
    secret: z.string().regex(/^[a-f0-9]{64}$/),
    provider: z.enum(['claude', 'codex']).optional(),
    label: z.string().trim().min(1).max(80).optional(),
  })
  .strict()
type Connection = MemoryPluginConnection & { secretHash: string; token?: string }
const fail = (message: string): never => {
  throw new MemoryError('connection_unavailable', message)
}

/** Pairing secrets and raw grant credentials never leave this process or its bridge. */
export class MemoryConnections {
  private records = new Map<string, Connection>()
  private attempts: number[] = []
  onChange = () => {}
  constructor(
    private readonly store: MemoryStore,
    private readonly now = Date.now,
  ) {
    // A previous process may have crashed before revoking its ephemeral enrollments.
    for (const grant of store.snapshot().grants)
      if (grant.pluginConnectionId && !grant.revoked) this.revoke(grant.id)
  }
  private revoke(id: string) {
    // Restore may have removed or already revoked this ephemeral grant.
    const grant = this.store.snapshot().grants.find((g) => g.id === id)
    if (!grant || grant.revoked) return
    this.store.execute({ action: 'revoke_grant', id, operationId: randomUUID() })
  }
  private public(record: Connection): MemoryPluginConnection {
    const { secretHash: _secret, token: _token, ...view } = record
    return view
  }
  sweep() {
    let changed = false
    for (const [id, r] of this.records) {
      if (r.expiresAt > this.now()) continue
      this.records.delete(id)
      if (r.grantId) this.revoke(r.grantId)
      changed = true
    }
    if (changed) this.onChange()
  }
  list() {
    this.sweep()
    return [...this.records.values()].map((r) => this.public(r))
  }
  private find(id: string, secret: string) {
    this.sweep()
    const r = this.records.get(id)
    if (!r || r.secretHash !== digest(secret))
      fail('Connection expired or unavailable. Request a new connection in this chat.')
    return r!
  }
  request(raw: unknown): MemoryPluginConnection {
    const input = requestSchema.parse(raw)
    this.sweep()
    if (input.action === 'request') {
      const previous = this.records.get(input.id)
      if (previous) {
        const r = this.find(input.id, input.secret)
        if (r.label !== input.label || r.provider !== input.provider)
          fail('Connection ID already used.')
        return this.request({ action: 'status', id: input.id, secret: input.secret })
      }
      if (!input.provider || !input.label) fail('Provider and label are required.')
      this.attempts = this.attempts.filter((t) => this.now() - t < 60_000)
      if (
        this.attempts.length >= 10 ||
        this.records.size >= 64 ||
        [...this.records.values()].filter((r) => r.state === 'pending').length >= 16
      )
        fail(
          'Too many connection requests. Wait a minute or reject unused requests in Threadlight.',
        )
      this.attempts.push(this.now())
      const r: Connection = {
        id: input.id,
        code: randomBytes(6).toString('hex').toUpperCase(),
        provider: input.provider!,
        label: input.label!,
        secretHash: digest(input.secret),
        state: 'pending',
        expiresAt: this.now() + 5 * 60_000,
      }
      this.records.set(r.id, r)
      this.onChange()
      return this.public(r)
    }
    const r = this.find(input.id, input.secret)
    if (input.action === 'disconnect') this.reject(r.id)
    if (r.token) {
      try {
        this.store.authenticate(r.token)
      } catch {
        r.state = 'rejected'
        r.token = undefined
        this.onChange()
      }
    }
    return this.public(r)
  }
  approve(id: string, input: MemoryInput) {
    this.sweep()
    const r = this.records.get(id)
    if (!r || r.state !== 'pending') fail('This request is no longer waiting for approval.')
    if (
      input.assignee &&
      (input.assignee.startsWith('codex:') ? 'codex' : 'claude') !== r!.provider
    )
      fail('Choose a chat from the requesting provider.')
    const grant = this.store.execute({
      ...input,
      action: 'create_grant',
      connectionId: id,
      operationId: randomUUID(),
    }) as { id: string; token: string }
    Object.assign(r!, {
      state: 'approved',
      grantId: grant.id,
      token: grant.token,
      expiresAt: this.now() + 8 * 3600_000,
    })
    this.onChange()
    return this.public(r!)
  }
  reject(id: string) {
    const r = this.records.get(id)
    if (!r) return
    if (r.grantId) this.revoke(r.grantId)
    r.token = undefined
    r.state = 'rejected'
    this.onChange()
  }
  authenticate(id: string, secret: string) {
    const r = this.find(id, secret)
    if (!r.token || !['approved', 'connected'].includes(r.state))
      fail('Approve this connection in Threadlight first.')
    const actor = this.store.authenticate(r.token!)
    const publish = r.state !== 'connected' || this.now() - (r.lastUsedAt ?? 0) > 5000
    r.state = 'connected'
    r.lastUsedAt = this.now()
    if (publish) this.onChange()
    return actor
  }
  handle(request: IncomingMessage, finish: (status: number, value?: unknown) => void) {
    if (request.method !== 'POST') return finish(405)
    if (!request.headers['content-type']?.startsWith('application/json')) return finish(415)
    let size = 0,
      ended = false
    const chunks: Buffer[] = []
    request.on('error', () => {})
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 2048) {
        ended = true
        finish(413)
        request.destroy()
      } else chunks.push(chunk)
    })
    request.on('end', () => {
      if (ended) return
      try {
        finish(200, this.request(JSON.parse(Buffer.concat(chunks).toString('utf8'))))
      } catch (error) {
        finish(400, {
          error: error instanceof MemoryError ? error.message : 'Invalid connection request.',
        })
      }
    })
  }
  close() {
    const records = [...this.records.values()]
    this.records.clear()
    for (const r of records) if (r.grantId) this.revoke(r.grantId)
  }
}
