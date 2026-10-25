import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import type { CliCommand } from '../relay'
import { isObject, type JsonObject } from '../sessions/json'

export type RpcId = number | string
export interface CodexTransport {
  request(method: string, params?: JsonObject, timeout?: number): Promise<JsonObject>
  respond(id: RpcId, result: JsonObject): void
  onEvent: (method: string, params: JsonObject, id?: RpcId) => void
  onFailure: (error: Error) => void
  close(): void
}

/** One owned stdio connection. Request IDs are typed, never coerced across the wire. */
export class CodexClient implements CodexTransport {
  onEvent: CodexTransport['onEvent'] = () => {}
  onFailure: CodexTransport['onFailure'] = () => {}
  private child: ChildProcessWithoutNullStreams
  private pending = new Map<
    RpcId,
    {
      resolve: (v: JsonObject) => void
      reject: (e: Error) => void
      timer: ReturnType<typeof setTimeout>
    }
  >()
  private next = 0
  private buffer = ''
  private closed = false

  constructor(cli: CliCommand, cwd: string, start = spawn) {
    const env = { ...process.env }
    for (const key of ['CODEX_THREAD_ID', 'CODEX_TURN_ID', 'CODEX_INTERNAL_ORIGINATOR_OVERRIDE'])
      delete env[key]
    this.child = start(cli.command, [...cli.prefixArgs, 'app-server'], {
      cwd,
      env,
      windowsHide: true,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as ChildProcessWithoutNullStreams
    this.child.stdout.setEncoding('utf8').on('data', (chunk: string) => this.read(chunk))
    // Diagnostics may include credentials/tool inputs. Consume without echoing or persisting them.
    this.child.stderr.resume()
    this.child.stdin.on('error', () =>
      this.fail(new Error('Codex connection closed. Check its sign-in and setup.')),
    )
    this.child.on('error', () =>
      this.fail(new Error('Could not start Codex. Check its installation.')),
    )
    this.child.on('close', () =>
      this.fail(new Error('Codex disconnected. Reopen the conversation before sending again.')),
    )
  }

  async initialize(): Promise<void> {
    await this.request(
      'initialize',
      {
        clientInfo: { name: 'threadlight_agent', title: 'Threadlight Agent', version: '0.0.0' },
        capabilities: { experimentalApi: true },
      },
      15_000,
    )
    this.write({ method: 'initialized', params: {} })
  }

  request(method: string, params: JsonObject = {}, timeout = 30_000): Promise<JsonObject> {
    if (this.closed) return Promise.reject(new Error('Codex connection is closed.'))
    const id = ++this.next
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(
          new Error(`Codex did not acknowledge ${method}. Check the conversation before retrying.`),
        )
      }, timeout)
      this.pending.set(id, { resolve, reject, timer })
      try {
        this.write({ id, method, params })
      } catch (error) {
        this.fail(error as Error)
      }
    })
  }

  respond(id: RpcId, result: JsonObject): void {
    this.write({ id, result })
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.child.stdin.end()
    this.child.kill()
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error('Codex connection ended.'))
    }
    this.pending.clear()
  }

  private write(value: object): void {
    if (this.closed) throw new Error('Codex connection ended.')
    this.child.stdin.write(`${JSON.stringify(value)}\n`)
  }

  private fail(error: Error): void {
    if (this.closed) return
    this.close()
    this.onFailure(error)
  }

  private read(chunk: string): void {
    if (this.closed) return
    this.buffer += chunk
    if (this.buffer.length > 8 * 1024 * 1024)
      return this.fail(new Error('Codex response exceeded the supported size.'))
    let end: number
    while ((end = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, end).trim()
      this.buffer = this.buffer.slice(end + 1)
      if (!line) continue
      let message: unknown
      try {
        message = JSON.parse(line)
      } catch {
        return this.fail(new Error('Codex returned an invalid protocol message.'))
      }
      if (!isObject(message))
        return this.fail(new Error('Codex returned an invalid protocol message.'))
      const id =
        typeof message.id === 'string' || typeof message.id === 'number' ? message.id : undefined
      if (typeof message.method === 'string') {
        this.onEvent(message.method, isObject(message.params) ? message.params : {}, id)
      } else if (id !== undefined) {
        const pending = this.pending.get(id)
        if (!pending) continue
        this.pending.delete(id)
        clearTimeout(pending.timer)
        if (isObject(message.error))
          pending.reject(
            new Error(
              typeof message.error.message === 'string'
                ? message.error.message.slice(0, 1000)
                : 'Codex rejected the request.',
            ),
          )
        else if (isObject(message.result)) pending.resolve(message.result)
        else pending.reject(new Error('Codex returned an unsupported response.'))
      }
    }
  }
}
