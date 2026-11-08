import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { afterEach } from 'vitest'
import type { MemoryProxy } from '../src/main/memory/transport'

const clients = new Map<string, ReturnType<typeof client>>()
function client(config: MemoryProxy) {
  const child = spawn(config.command, config.args, {
    env: { ...process.env, ...config.env },
    windowsHide: true,
    stdio: 'pipe',
  })
  let counter = 0
  const pending = new Map<number, { resolve: (r: Response) => void; reject: (e: Error) => void }>()
  createInterface({ input: child.stdout }).on('line', (line) => {
    const value = JSON.parse(line)
    pending.get(value.id)?.resolve(new Response(line, { status: 200 }))
    pending.delete(value.id)
  })
  child.on('error', (error) => {
    for (const p of pending.values()) p.reject(error)
  })
  child.on('exit', () => {
    for (const p of pending.values()) p.reject(Error('Proxy exited'))
  })
  return {
    call: (message: object) =>
      new Promise<Response>((resolve, reject) => {
        const id = ++counter
        const timer = setTimeout(() => {
          pending.delete(id)
          reject(Error('Proxy timed out'))
        }, 7000)
        pending.set(id, {
          resolve: (r) => {
            clearTimeout(timer)
            resolve(r)
          },
          reject: (e) => {
            clearTimeout(timer)
            reject(e)
          },
        })
        child.stdin.write(JSON.stringify({ ...message, id }) + '\n')
      }),
    close: () =>
      new Promise<void>((done) => {
        if (child.exitCode !== null) return done()
        child.once('close', () => done())
        child.kill()
      }),
  }
}
export function proxyRpc(config: MemoryProxy, message: object) {
  const key = JSON.stringify(config)
  if (!clients.has(key)) clients.set(key, client(config))
  return clients.get(key)!.call(message)
}
afterEach(async () => {
  await Promise.all([...clients.values()].map((c) => c.close()))
  clients.clear()
})
