import { randomUUID } from 'node:crypto'
import type { Duplex } from 'node:stream'

import { CHAT_RATE_LIMITED } from '../../shared/accountChats'
export { CHAT_RATE_LIMITED }
export class ChatRateLimited extends Error {
  constructor(readonly retryAfterMs?: number) {
    super(CHAT_RATE_LIMITED)
  }
}

export class ChatRpcRejected extends Error {
  constructor(readonly code: number) {
    super('The desktop app rejected this request.')
  }
}

/** Private framing only. Provider adapters own the closed set of permitted reads. */
export class ReadRpc {
  private buffer = Buffer.alloc(0)
  private pending = new Map<
    string,
    { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
  >()
  private notifications = new Map<string, (v: unknown) => void>()
  constructor(
    private pipe: Duplex,
    private framing: 'length' | 'header',
  ) {
    pipe.on('data', (data: Buffer) => {
      try {
        this.buffer = Buffer.concat([this.buffer, data])
        if (this.buffer.length > 8 * 1024 * 1024 + 4096) throw new Error('Response limit')
        while (true) {
          let offset: number, size: number
          if (framing === 'length') {
            if (this.buffer.length < 4) break
            offset = 4
            size = this.buffer.readUInt32LE(0)
          } else {
            const end = this.buffer.indexOf('\r\n\r\n')
            if (end < 0) {
              if (this.buffer.length > 4096) throw new Error('Invalid header')
              break
            }
            const match = /^Content-Length: ([0-9]+)$/i.exec(
              this.buffer.subarray(0, end).toString('ascii'),
            )
            if (!match) throw new Error('Invalid header')
            size = Number(match[1])
            offset = end + 4
          }
          if (!Number.isSafeInteger(size) || size < 1 || size > 8 * 1024 * 1024)
            throw new Error('Response limit')
          if (this.buffer.length < offset + size) break
          const value = JSON.parse(this.buffer.subarray(offset, offset + size).toString())
          this.buffer = this.buffer.subarray(offset + size)
          if (value?.jsonrpc !== '2.0') throw new Error('Invalid response')
          const pending = this.pending.get(value.id)
          if (pending) {
            this.pending.delete(value.id)
            clearTimeout(pending.timer)
            if (value.error || !Object.hasOwn(value, 'result'))
              pending.reject(
                new ChatRpcRejected(typeof value.error?.code === 'number' ? value.error.code : 0),
              )
            else pending.resolve(value.result)
          } else if (typeof value.method === 'string')
            this.notifications.get(value.method)?.(value.params)
        }
      } catch {
        this.close()
      }
    })
    pipe.on('error', () => this.close())
    pipe.on('close', () => this.close())
  }
  request(method: string, params: object, timeoutMs = 15000): Promise<unknown> {
    if (this.pipe.destroyed || this.pending.size >= 2)
      return Promise.reject(new Error('Desktop connection unavailable.'))
    const id = randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.close(), timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
      let frame: Buffer
      if (this.framing === 'length') {
        frame = Buffer.alloc(body.length + 4)
        frame.writeUInt32LE(body.length)
        body.copy(frame, 4)
      } else frame = Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body])
      this.pipe.write(frame, (error) => {
        if (error) this.close()
      })
    })
  }
  listen(method: string, callback: (v: unknown) => void) {
    this.notifications.set(method, callback)
    return () => this.notifications.delete(method)
  }
  close() {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer)
      p.reject(new Error('Desktop chat read interrupted. Refresh to reconnect.'))
    }
    this.pending.clear()
    this.notifications.clear()
    this.pipe.destroy()
  }
}
