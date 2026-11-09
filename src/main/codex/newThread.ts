import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { stat } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import type { NewThreadRequest, NewThreadResult } from '../../shared/newThread'
import type { CodexTransport } from '../agent/codexClient'
import { CODEX_UUID, codexKey } from './identity'
import { connectCodexDesktop } from './desktopConnection'
import { isObject } from '../sessions/json'
import { discoverModels } from '../agent/agentModels'

interface Receipt {
  cwd: string
  phase: 'prepared' | 'creating' | 'created'
  id?: string
  requestedModel?: string
  model?: string
}
interface Dependencies {
  bootstrap(cwd: string): Promise<CodexTransport & { initialize(): Promise<void> }>
  handoff(id: string): Promise<boolean>
}

/** Opens only the confirmed identity, then waits for its desktop owner. Never starts a turn. */
export async function handoffNewCodexThread(
  id: string,
  open: (url: string) => Promise<void>,
): Promise<boolean> {
  if (!CODEX_UUID.test(id)) return false
  await open(`codex://threads/${id}`)
  const connection = await connectCodexDesktop()
  try {
    const deadline = Date.now() + 15_000
    do {
      const owner = await connection.request(
        'thread-owner-discovery',
        { hostId: 'local', conversationId: id },
        1,
      )
      if (owner.resultType === 'success' && typeof owner.handledByClientId === 'string') return true
      await delay(300)
    } while (Date.now() < deadline)
    return false
  } finally {
    connection.close()
  }
}

/** Durable operations keep an interrupted handoff from creating another chat. */
export class NewCodexThreads {
  private active: { input: NewThreadRequest; promise: Promise<NewThreadResult> } | null = null
  constructor(
    private receipts: string,
    private workspaces: string,
    private deps: Dependencies,
  ) {}

  create(input: NewThreadRequest, beforeCreate?: () => void): Promise<NewThreadResult> {
    if (
      !input ||
      input.provider !== 'codex' ||
      !CODEX_UUID.test(input.operationId) ||
      (input.model !== undefined &&
        (typeof input.model !== 'string' || !input.model.trim() || input.model.length > 100)) ||
      (input.cwd !== null && (typeof input.cwd !== 'string' || !isAbsolute(input.cwd)))
    )
      return Promise.resolve({ ok: false, reason: 'That new-thread request is unavailable.' })
    if (this.active)
      return this.active.input.operationId === input.operationId &&
        this.active.input.model === input.model &&
        this.active.input.cwd === input.cwd
        ? this.active.promise
        : Promise.resolve({ ok: false, reason: 'Another chat is still opening.' })
    const promise = this.run(input, beforeCreate).finally(() => {
      this.active = null
    })
    this.active = { input, promise }
    return promise
  }

  private async run(input: NewThreadRequest, beforeCreate?: () => void): Promise<NewThreadResult> {
    const file = join(this.receipts, `${input.operationId}.json`)
    let receipt: Receipt | undefined
    const save = () => {
      mkdirSync(this.receipts, { recursive: true })
      writeFileSync(`${file}.tmp`, JSON.stringify(receipt))
      renameSync(`${file}.tmp`, file)
    }
    try {
      if (existsSync(file)) {
        const value: unknown = JSON.parse(readFileSync(file, 'utf8'))
        if (
          !isObject(value) ||
          typeof value.cwd !== 'string' ||
          (value.requestedModel !== undefined && typeof value.requestedModel !== 'string') ||
          (value.model !== undefined && typeof value.model !== 'string') ||
          !['prepared', 'creating', 'created'].includes(String(value.phase)) ||
          (value.id !== undefined &&
            (typeof value.id !== 'string' || !CODEX_UUID.test(value.id))) ||
          (value.phase === 'created' && !value.id)
        )
          throw Error('Invalid creation receipt')
        receipt = value as unknown as Receipt
        if (receipt.requestedModel !== input.model)
          return {
            ok: false,
            reason: 'This creation receipt belongs to a different model selection.',
          }
        if (input.cwd !== null && input.cwd !== receipt.cwd)
          return { ok: false, reason: 'The pending chat belongs to a different workspace.' }
      } else {
        receipt = {
          cwd: input.cwd ?? join(this.workspaces, input.operationId),
          phase: 'prepared',
          requestedModel: input.model,
        }
        if (input.cwd === null) mkdirSync(receipt.cwd, { recursive: true })
        save()
      }
      if (receipt.phase === 'creating')
        return {
          ok: false,
          reason:
            'Codex did not confirm creation. Check Codex before starting another chat; this request will not be repeated.',
        }
      if (!receipt.id) {
        if (!(await stat(receipt.cwd)).isDirectory()) throw Error('Workspace unavailable')
        const client = await this.deps.bootstrap(receipt.cwd)
        try {
          await client.initialize()
          let model: string | undefined
          if (input.model) {
            const models = await discoverModels(client)
            const words = (s: string) =>
              s
                .toLowerCase()
                .split(/[^a-z0-9.]+/)
                .filter((w) => w && w !== 'gpt')
                .sort()
                .join(' ')
            const candidates = models.filter((m) =>
              [m.id, m.name].some((s) => words(s) === words(input.model!)),
            )
            model =
              models.find((m) => m.id === input.model)?.id ??
              (candidates.length === 1 ? candidates[0]?.id : undefined)
            if (!model)
              return {
                ok: false,
                reason:
                  'Requested Codex model is unavailable or ambiguous. Use an exact installed model ID.',
              }
          }
          beforeCreate?.()
          receipt.phase = 'creating'
          save()
          // Leave native defaults in place unless the caller selected a model.
          const result = await client.request('thread/start', {
            cwd: receipt.cwd,
            ephemeral: false,
            ...(model && { model }),
          })
          const id = isObject(result.thread) ? result.thread.id : undefined
          if (typeof id !== 'string' || !CODEX_UUID.test(id)) throw Error('Missing chat identity')
          receipt.id = id
          if (typeof result.model === 'string' && (!model || result.model === model))
            receipt.model = result.model
          receipt.phase = 'created'
          save()
          // Blank threads are persisted lazily. Naming materializes the native history
          // before this short-lived app server exits, without inventing a user turn.
          await client.request('thread/name/set', { threadId: id, name: 'New Codex chat' })
          const saved = await client.request('thread/read', { threadId: id })
          if (!isObject(saved.thread) || saved.thread.id !== id)
            throw Error('Chat persistence was not confirmed')
          if (model && receipt.model !== model)
            return {
              ok: false,
              sessionId: codexKey(id),
              reason: 'Codex created the chat but did not confirm the requested model.',
            }
        } finally {
          // Release the bootstrap writer before asking the desktop to own the chat.
          await client.close()
        }
      } else {
        if (input.model && !receipt.model)
          return {
            ok: false,
            sessionId: codexKey(receipt.id),
            reason: 'The requested model was not confirmed.',
          }
        beforeCreate?.()
      }
      const id = receipt.id!
      if (!(await this.deps.handoff(id)))
        return {
          ok: false,
          sessionId: codexKey(id),
          reason:
            'Your chat was created, but Codex is not ready. Choose New again to reopen the same chat.',
        }
      return { ok: true, sessionId: codexKey(id), ...(receipt.model && { model: receipt.model }) }
    } catch {
      return {
        ok: false,
        ...(receipt?.id ? { sessionId: codexKey(receipt.id) } : {}),
        reason: receipt?.id
          ? 'Your chat was created. Choose New again to reconnect the same chat.'
          : receipt?.phase === 'creating'
            ? 'Creation could not be confirmed. Check Codex; this request will not be repeated.'
            : 'Could not prepare the chat. Check the workspace and Codex installation, then try again.',
      }
    }
  }
}
