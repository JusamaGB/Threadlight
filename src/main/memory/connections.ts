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
    chatId: z.string().uuid().optional(),
    spaceId: z.string().uuid().optional(),
  })
  .strict()
type Connection = MemoryPluginConnection & { secretHash: string }
const savedConnection = z
  .object({
    id: z.string().uuid(),
    code: z.string(),
    provider: z.enum(['claude', 'codex']),
    label: z.string(),
    chatId: z.string().uuid().optional(),
    spaceId: z.string().uuid(),
    projectName: z.string().optional(),
    state: z.enum(['approved', 'connected', 'rejected']),
    expiresAt: z.literal(0),
    grantId: z.string().uuid(),
    lastUsedAt: z.number().optional(),
    secretHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()
const waitSchema = z
  .object({
    action: z.literal('wait'),
    id: z.string().uuid(),
    secret: z.string().regex(/^[a-f0-9]{64}$/),
    chatId: z.string().uuid(),
    waitMs: z.number().int().min(0).max(50000),
  })
  .strict()
const fail = (message: string): never => {
  throw new MemoryError('connection_unavailable', message)
}

/** Durable approvals store only a secret hash; raw credentials stay in the private bridge cache. */
export class MemoryConnections {
  private records = new Map<string, Connection>()
  private attempts: number[] = []
  private waiting = new Set<string>()
  private signalled = new Set<string>()
  onChange = () => {}
  constructor(
    private readonly store: MemoryStore,
    private readonly now = Date.now,
  ) {
    for (const raw of store.savedPairings()) {
      const parsed = savedConnection.safeParse(raw)
      if (parsed.success) this.records.set(parsed.data.id, parsed.data)
    }
    // Historical transient grants have no durable proof of pairing. Never resurrect revoked grants.
    for (const grant of store.snapshot().grants)
      if (
        grant.pluginConnectionId &&
        !grant.revoked &&
        this.records.get(grant.pluginConnectionId)?.grantId !== grant.id
      )
        this.revoke(grant.id)
  }
  private persist(record: Connection) {
    if (record.grantId) this.store.savePairing(record.id, record)
  }
  private actor(record: Connection) {
    if (!record.grantId) fail('Approve this connection in Threadlight first.')
    return this.store.authenticatePairing(record.grantId!, record.id)
  }
  private revoke(id: string) {
    // Restore may have removed or already revoked this ephemeral grant.
    const grant = this.store.snapshot().grants.find((g) => g.id === id)
    if (!grant || grant.revoked) return
    this.store.execute({ action: 'revoke_grant', id, operationId: randomUUID() })
  }
  discover() {
    // Explicit projection: this endpoint never returns content, paths or credentials.
    return { projects: this.store.connectionProjects().map(({ id, name }) => ({ id, name })) }
  }
  private target(spaceId: string | undefined) {
    if (!spaceId)
      fail(
        'This legacy request has no project destination. Update the plugin, discover projects and request a new connection.',
      )
    const project = this.discover().projects.find((p) => p.id === spaceId)
    if (!project)
      fail(
        'Requested project is unavailable. Discover projects again; do not substitute another project.',
      )
    return project!
  }
  private public(record: Connection): MemoryPluginConnection {
    const { secretHash: _secret, ...view } = record
    return {
      ...view,
      projectName:
        this.discover().projects.find((p) => p.id === record.spaceId)?.name ?? record.projectName,
    }
  }
  sweep() {
    let changed = false
    for (const [id, r] of this.records) {
      if (!r.expiresAt) {
        if (r.state !== 'rejected') {
          try {
            this.actor(r)
          } catch {
            r.state = 'rejected'
            this.persist(r)
            changed = true
          }
        }
        continue
      }
      if (r.expiresAt > this.now()) continue
      this.records.delete(id)
      this.signalled.delete(id)
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
        if (
          r.label !== input.label ||
          r.provider !== input.provider ||
          r.chatId !== input.chatId ||
          r.spaceId !== input.spaceId
        )
          fail('Connection ID already used.')
        return this.request({ action: 'status', id: input.id, secret: input.secret })
      }
      const project = this.target(input.spaceId)
      if (!input.provider || !input.label) fail('Provider and label are required.')
      this.attempts = this.attempts.filter((t) => this.now() - t < 60_000)
      if (
        this.attempts.length >= 10 ||
        [...this.records.values()].filter((r) => r.state !== 'rejected').length >= 64 ||
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
        spaceId: project.id,
        projectName: project.name,
        ...(input.chatId ? { chatId: input.chatId } : {}),
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
    if (r.state !== 'rejected') this.target(r.spaceId)
    if (r.grantId && r.state !== 'rejected') {
      try {
        this.actor(r)
      } catch {
        r.state = 'rejected'
        this.persist(r)
        this.onChange()
      }
    }
    return this.public(r)
  }
  approve(id: string, input: MemoryInput) {
    this.sweep()
    const r = this.records.get(id)
    if (!r || r.state !== 'pending') fail('This request is no longer waiting for approval.')
    this.target(r!.spaceId)
    if (input.spaceId !== r!.spaceId) fail('Approval must use the requested project.')
    if (r!.chatId && input.assignee !== `${r!.provider === 'codex' ? 'codex:' : ''}${r!.chatId}`)
      fail('Approval must use the exact requesting native chat.')
    if (
      input.assignee &&
      (input.assignee.startsWith('codex:') ? 'codex' : 'claude') !== r!.provider
    )
      fail('Choose a chat from the requesting provider.')
    const next = this.store.atomicCommunication(() => {
      const grant = this.store.execute({
        ...input,
        action: 'create_grant',
        connectionId: id,
        operationId: randomUUID(),
      }) as { id: string }
      const nativeId = input.assignee?.replace(/^codex:/, '')
      const approved: Connection = {
        ...r!,
        state: 'approved',
        grantId: grant.id,
        expiresAt: 0,
        ...(!r!.chatId && nativeId && z.string().uuid().safeParse(nativeId).success
          ? { chatId: nativeId }
          : {}),
      }
      this.persist(approved)
      return approved
    })
    Object.assign(r!, next)
    this.onChange()
    return this.public(r!)
  }
  /** A response to the original tool caller, never an unsolicited provider wakeup. */
  async wait(raw: unknown) {
    const input = waitSchema.parse(raw)
    const initial = this.find(input.id, input.secret)
    if (!initial.chatId || initial.chatId !== input.chatId)
      fail('Wait requires the exact native chat ID stored on this request.')
    const current = () => {
      const record = this.find(input.id, input.secret)
      if (record !== initial) fail('This approval wait belongs to an expired request.')
      return record
    }
    if (this.waiting.has(input.id)) fail('This connection already has an approval wait.')
    this.waiting.add(input.id)
    const deadline = Date.now() + input.waitMs
    try {
      while (current().state === 'pending' && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, Math.min(100, deadline - Date.now())))
      const status = this.request({ action: 'status', id: input.id, secret: input.secret })
      if (!['approved', 'connected'].includes(status.state))
        return { ...status, continuation: 'none' as const }
      const record = current()
      const actor = this.actor(record)
      const grant = this.store.snapshot().grants.find((g) => g.id === actor.grantId)
      const target = `${record.provider === 'codex' ? 'codex:' : ''}${record.chatId}`
      if (grant?.spaceId !== record.spaceId)
        fail('Approved enrollment does not match the requested project.')
      if (grant?.assignee !== target)
        fail('Approved enrollment is not linked to the requesting native chat.')
      const continuation = this.signalled.has(input.id) ? 'already-delivered' : 'verify-connection'
      this.signalled.add(input.id)
      return { ...status, continuation }
    } finally {
      this.waiting.delete(input.id)
    }
  }
  reject(id: string) {
    const r = this.records.get(id)
    if (!r) return
    if (r.grantId) this.revoke(r.grantId)
    r.state = 'rejected'
    if (r.grantId) r.expiresAt = 0
    this.persist(r)
    this.onChange()
  }
  authenticate(id: string, secret: string) {
    const r = this.find(id, secret)
    if (!r.grantId || !['approved', 'connected'].includes(r.state))
      fail('Approve this connection in Threadlight first; its capability may have been revoked.')
    this.target(r.spaceId)
    const actor = this.actor(r)
    const grant = this.store.snapshot().grants.find((g) => g.id === actor.grantId)
    if (grant?.spaceId !== r.spaceId)
      fail('Approved enrollment does not match the requested project.')
    if (r.chatId && grant?.assignee !== `${r.provider === 'codex' ? 'codex:' : ''}${r.chatId}`)
      fail('Approved enrollment is not linked to the requesting native chat.')
    const publish = r.state !== 'connected' || this.now() - (r.lastUsedAt ?? 0) > 5000
    r.state = 'connected'
    r.lastUsedAt = this.now()
    if (publish) this.persist(r)
    if (publish) this.onChange()
    return { ...actor, enrollment: { provider: r.provider, connectionId: r.id } }
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
    request.on('end', async () => {
      if (ended) return
      try {
        const input = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        if (input?.action === 'discover') {
          z.object({ action: z.literal('discover') })
            .strict()
            .parse(input)
          return finish(200, this.discover())
        }
        finish(200, input?.action === 'wait' ? await this.wait(input) : this.request(input))
      } catch (error) {
        finish(400, {
          error: error instanceof MemoryError ? error.message : 'Invalid connection request.',
        })
      }
    })
  }
  close() {
    this.records.clear()
    this.signalled.clear()
  }
}
