import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { defaultPaths } from '../sessions/paths'

export interface ClaudeRuntimeIdentity {
  pid: number
  start: string
  executable: string
  hash: string
}
export interface ClaudePipe {
  inspect(socket: string, target: string): Promise<ClaudeRuntimeIdentity>
  write(socket: string, identity: ClaudeRuntimeIdentity, payload: string): void
}
const hashes = new Map<string, string>()
function windows() {
  if (process.platform !== 'win32')
    throw new Error('Claude runtime inbox currently requires native Windows.')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const koffi = require('koffi') as typeof import('koffi')
  const dll = koffi.load('kernel32.dll')
  const open = dll.func(
    'void * __stdcall CreateFileW(str16 name, uint32 access, uint32 share, void *security, uint32 creation, uint32 flags, void *templateFile)',
  )
  const close = dll.func('int __stdcall CloseHandle(void *handle)')
  const serverPid = dll.func(
    'int __stdcall GetNamedPipeServerProcessId(void *pipe, _Out_ uint32 *pid)',
  )
  const processOpen = dll.func(
    'void * __stdcall OpenProcess(uint32 access, int inherit, uint32 pid)',
  )
  const times = dll.func(
    'int __stdcall GetProcessTimes(void *process, void *creation, void *exit, void *kernel, void *user)',
  )
  const executable = dll.func(
    'int __stdcall QueryFullProcessImageNameW(void *process, uint32 flags, void *name, _Inout_ uint32 *size)',
  )
  const write = dll.func(
    'int __stdcall WriteFile(void *file, void *buffer, uint32 size, _Out_ uint32 *written, void *overlapped)',
  )
  function processIdentity(pid: number) {
    const handle = processOpen(0x1000, 0, pid)
    if (!handle) throw new Error('Native runtime process is unavailable.')
    try {
      const creation = Buffer.alloc(8),
        name = Buffer.alloc(65536),
        size = [32768]
      if (
        !times(handle, creation, Buffer.alloc(8), Buffer.alloc(8), Buffer.alloc(8)) ||
        !executable(handle, 0, name, size)
      )
        throw new Error('Cannot verify native runtime identity.')
      return {
        pid,
        start: creation.readBigUInt64LE().toString(),
        executable: name.toString('utf16le', 0, size[0]! * 2),
      }
    } finally {
      close(handle)
    }
  }
  function pipe<T>(
    path: string,
    fn: (handle: unknown, identity: ReturnType<typeof processIdentity>) => T,
  ): T {
    if (!/^\\\\\.\\pipe\\(?:LOCAL\\)?[A-Za-z0-9_.-]{1,200}$/.test(path))
      throw new Error('Expected a local Windows named pipe.')
    const handle = open(path, 0x40000000, 0, null, 3, 0, null)
    if (!handle || koffi.address(handle) === 0xffffffffffffffffn)
      throw new Error('Native runtime inbox is unavailable.')
    try {
      const pid = [0]
      if (!serverPid(handle, pid)) throw new Error('Cannot verify the named-pipe owner.')
      return fn(handle, processIdentity(pid[0]!))
    } finally {
      close(handle)
    }
  }
  return { pipe, processIdentity, write }
}
let api: ReturnType<typeof windows> | undefined
const native = () => (api ??= windows())
export const claudePipe: ClaudePipe = {
  async inspect(socket, target) {
    const identity = native().pipe(socket, (_handle, identity) => identity)
    const directory = defaultPaths().liveSessionsDir
    const records = await Promise.all(
      (await readdir(directory))
        .filter((f) => /^\d+\.json$/.test(f))
        .map(async (f) => {
          try {
            return JSON.parse(await readFile(join(directory, f), 'utf8')) as {
              pid: number
              sessionId: string
              procStart: string
            }
          } catch {
            return null
          }
        }),
    )
    const live = records.filter((r) => {
      if (!r || r.sessionId !== target) return false
      try {
        return native().processIdentity(r.pid).start === r.procStart
      } catch {
        return false
      }
    })
    if (live.length !== 1 || live[0]!.pid !== identity.pid || live[0]!.procStart !== identity.start)
      throw new Error('Native chat ownership is missing or ambiguous.')
    const info = await stat(identity.executable)
    const key = `${identity.executable}:${info.size}:${info.mtimeMs}`
    let hash = hashes.get(key)
    if (!hash) {
      hash = createHash('sha256')
        .update(await readFile(identity.executable))
        .digest('hex')
      hashes.clear()
      hashes.set(key, hash)
    }
    return { ...identity, hash }
  },
  write(socket, expected, payload) {
    // Verify and write through the SAME handle, so a replaced pipe cannot receive the token.
    native().pipe(socket, (handle, identity) => {
      if (
        identity.pid !== expected.pid ||
        identity.start !== expected.start ||
        identity.executable !== expected.executable
      )
        throw new Error('Native inbox owner changed.')
      const data = Buffer.from(payload),
        written = [0]
      if (
        data.length > 8192 ||
        !native().write(handle, data, data.length, written, null) ||
        written[0] !== data.length
      )
        throw new Error('Native wakeup write was incomplete; delivery is uncertain.')
    })
  },
}
