import type { Duplex } from 'node:stream'
import { randomUUID } from 'node:crypto'
import { isObject } from '../sessions/json'
import { openVerifiedCodexPipe } from './verifiedPipe'

type Message = Record<string, unknown>
export interface DesktopConnection {
  request(
    method: string,
    params: Message,
    version?: number,
    targetClientId?: string,
  ): Promise<Message>
  close(): void
}

export interface StreamingDesktopConnection extends DesktopConnection {
  broadcast(method: string, params: Message, version: number, targets: string[]): void
  onBroadcast(listener: (message: Message) => void): () => void
  onClose(listener: () => void): () => void
}

/** Codex's local client-coordination channel. Never claims thread ownership or hosts a router. */
export async function connectCodexDesktop(): Promise<StreamingDesktopConnection> {
  if (process.platform !== 'win32') throw new Error('Native Codex answers require Windows.')
  const socket = await openVerifiedCodexPipe()
  return initializeDesktopConnection(socket)
}

export async function initializeDesktopConnection(
  socket: Duplex,
): Promise<StreamingDesktopConnection> {
  let buffer = Buffer.alloc(0),
    clientId: string | undefined,
    closed = false
  const broadcasts = new Set<(message: Message) => void>()
  const closedListeners = new Set<() => void>()
  const pending = new Map<
    string,
    {
      resolve: (value: Message) => void
      reject: (error: Error) => void
      timer: NodeJS.Timeout
      method: string
      target?: string
    }
  >()
  const close = () => {
    if (closed) return
    closed = true
    socket.destroy()
    for (const task of pending.values()) {
      clearTimeout(task.timer)
      task.reject(new Error('Codex connection ended.'))
    }
    pending.clear()
    for (const listener of closedListeners) listener()
    broadcasts.clear()
    closedListeners.clear()
  }
  const write = (value: Message) => {
    if (closed) throw new Error('Codex connection ended.')
    const body = Buffer.from(JSON.stringify(value)),
      header = Buffer.alloc(4)
    if (body.length > 16 * 1024 * 1024 || socket.writableLength > 16 * 1024 * 1024) {
      close()
      throw new Error('Codex connection capacity exceeded.')
    }
    header.writeUInt32LE(body.length)
    socket.write(Buffer.concat([header, body]))
  }
  const request: DesktopConnection['request'] = (method, params, version = 0, targetClientId) => {
    if (closed) return Promise.reject(new Error('Codex connection ended.'))
    if (pending.size >= 128) return Promise.reject(new Error('Too many pending Codex requests.'))
    const requestId = randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId)
        reject(new Error('Codex did not confirm the request.'))
        close()
      }, 8000)
      pending.set(requestId, { resolve, reject, timer, method, target: targetClientId })
      try {
        write({
          type: 'request',
          requestId,
          sourceClientId: clientId,
          method,
          version,
          params,
          targetClientId,
        })
      } catch {
        close()
      }
    })
  }
  socket.on('error', close).on('close', close)
  socket.on('data', (chunk: Buffer) => {
    if (buffer.length + chunk.length > 16 * 1024 * 1024) return close()
    buffer = Buffer.concat([buffer, chunk])
    try {
      while (buffer.length >= 4) {
        const length = buffer.readUInt32LE(0)
        if (!length || length > 16 * 1024 * 1024) return close()
        if (buffer.length < 4 + length) return
        const message: unknown = JSON.parse(buffer.subarray(4, 4 + length).toString('utf8'))
        buffer = buffer.subarray(4 + length)
        if (!isObject(message)) return close()
        if (message.type === 'response' && typeof message.requestId === 'string') {
          const task = pending.get(message.requestId)
          if (task) {
            // Correlation is defense in depth. The upstream router must authenticate senders.
            if (message.resultType === 'success') {
              if (
                message.method !== task.method ||
                typeof message.handledByClientId !== 'string' ||
                !message.handledByClientId ||
                (task.target && message.handledByClientId !== task.target)
              )
                return close()
            } else if (
              message.resultType !== 'error' ||
              typeof message.error !== 'string' ||
              (task.target &&
                message.handledByClientId !== undefined &&
                message.handledByClientId !== task.target)
            )
              return close()
            pending.delete(message.requestId)
            clearTimeout(task.timer)
            task.resolve(message)
          }
        } else if (
          clientId &&
          message.type === 'client-discovery-request' &&
          typeof message.requestId === 'string'
        ) {
          write({
            type: 'client-discovery-response',
            requestId: message.requestId,
            response: { canHandle: false },
          })
        }
        if (
          clientId &&
          message.type === 'broadcast' &&
          typeof message.sourceClientId === 'string' &&
          typeof message.method === 'string' &&
          Number.isInteger(message.version) &&
          isObject(message.params) &&
          (message.targetClientIds === undefined ||
            (Array.isArray(message.targetClientIds) && message.targetClientIds.includes(clientId)))
        )
          for (const listener of broadcasts) listener(message)
      }
    } catch {
      close()
    }
  })
  try {
    const result = await request('initialize', { clientType: 'threadlight' })
    if (
      result.resultType !== 'success' ||
      !isObject(result.result) ||
      typeof result.result.clientId !== 'string' ||
      !result.result.clientId ||
      result.handledByClientId !== result.result.clientId
    )
      throw new Error('Codex did not initialize the connection.')
    clientId = result.result.clientId
    return {
      request,
      close,
      broadcast: (method, params, version, targets) => {
        if (!targets.length) return
        write({
          type: 'broadcast',
          sourceClientId: clientId,
          targetClientIds: targets,
          method,
          version,
          params,
        })
      },
      onBroadcast: (listener) => {
        broadcasts.add(listener)
        return () => {
          broadcasts.delete(listener)
        }
      },
      onClose: (listener) => {
        if (closed) listener()
        else closedListeners.add(listener)
        return () => {
          closedListeners.delete(listener)
        }
      },
    }
  } catch (error) {
    close()
    throw error
  }
}
