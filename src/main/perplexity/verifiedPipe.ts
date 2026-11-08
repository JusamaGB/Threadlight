import { Duplex } from 'node:stream'
import { win32 } from 'node:path'
import { execFile } from 'node:child_process'

export const PIPE_OPEN_FLAGS = 0x40100000 // OVERLAPPED | SECURITY_SQOS_PRESENT (ANONYMOUS)
const family = 'PerplexityAI.PerplexityApp_3jh4kjrg4dzr2'
const failure = () =>
  new Error(
    'Cannot verify the Perplexity desktop connection. Open the supported installed Perplexity app and try again.',
  )

export interface PackageIdentity {
  family: string
  root: string
  executable: string
  sameLogon: boolean
}
export function checkPerplexityIdentity(identity: PackageIdentity): void {
  if (
    !identity.sameLogon ||
    identity.family !== family ||
    !win32.isAbsolute(identity.root) ||
    win32.normalize(identity.executable).toLowerCase() !==
      win32.join(identity.root, 'app', 'resources', 'native', 'bin', 'perplexity.exe').toLowerCase()
  )
    throw failure()
}

// All identity queries and I/O use the original handle. Never verify then reconnect.
function windows() {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw failure()
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const koffi = require('koffi') as typeof import('koffi')
  const k = koffi.load('kernel32.dll'),
    a = koffi.load('advapi32.dll')
  const open = k.func(
    'void * __stdcall CreateFileW(str16,uint32,uint32,void *,uint32,uint32,void *)',
  )
  const close = k.func('int __stdcall CloseHandle(void *)')
  const lastError = k.func('uint32 __stdcall GetLastError()')
  const pid = k.func('int __stdcall GetNamedPipeServerProcessId(void *,_Out_ uint32 *)')
  const openProcess = k.func('void * __stdcall OpenProcess(uint32,int,uint32)')
  const current = k.func('void * __stdcall GetCurrentProcess()')
  const image = k.func(
    'int __stdcall QueryFullProcessImageNameW(void *,uint32,void *,_Inout_ uint32 *)',
  )
  const packageFamily = k.func(
    'long __stdcall GetPackageFamilyName(void *,_Inout_ uint32 *,void *)',
  )
  const packageFull = k.func('long __stdcall GetPackageFullName(void *,_Inout_ uint32 *,void *)')
  const packagePath = k.func(
    'long __stdcall GetPackagePathByFullName(str16,_Inout_ uint32 *,void *)',
  )
  const tokenOpen = a.func('int __stdcall OpenProcessToken(void *,uint32,_Out_ void **)')
  const tokenInfo = a.func(
    'int __stdcall GetTokenInformation(void *,int,void *,uint32,_Out_ uint32 *)',
  )
  const equalSid = a.func('int __stdcall EqualSid(void *,void *)')
  const event = k.func('void * __stdcall CreateEventW(void *,int,int,str16)')
  const read = k.func('int __stdcall ReadFile(void *,void *,uint32,void *,void *)')
  const write = k.func('int __stdcall WriteFile(void *,void *,uint32,void *,void *)')
  const result = k.func('int __stdcall GetOverlappedResult(void *,void *,_Out_ uint32 *,int)')
  const cancel = k.func('int __stdcall CancelIoEx(void *,void *)')
  const directory = k.func('uint32 __stdcall GetWindowsDirectoryW(void *,uint32)')
  const text = (call: (buffer: Buffer, length: number[]) => number, success = 0) => {
    const buffer = Buffer.alloc(65536),
      length = [32768]
    if (call(buffer, length) !== success) throw failure()
    return buffer.toString('utf16le').split('\0')[0]!
  }
  const logon = (processHandle: unknown) => {
    const handles = [null]
    if (!tokenOpen(processHandle, 8, handles)) throw failure()
    const handle = handles[0]
    try {
      const user = Buffer.alloc(1024),
        stats = Buffer.alloc(128),
        length = [0]
      if (
        !tokenInfo(handle, 1, user, user.length, length) ||
        !tokenInfo(handle, 10, stats, stats.length, length)
      )
        throw failure()
      return { user, authentication: Buffer.from(stats.subarray(8, 16)) }
    } finally {
      close(handle)
    }
  }
  const inspect = (handle: unknown) => {
    const id = [0]
    if (!pid(handle, id)) throw failure()
    const processHandle = openProcess(0x1000, 0, id[0])
    if (!processHandle) throw failure()
    try {
      const ours = logon(current()),
        theirs = logon(processHandle)
      const sameLogon =
        !!equalSid(koffi.decode(ours.user, 'void *'), koffi.decode(theirs.user, 'void *')) &&
        ours.authentication.equals(theirs.authentication)
      const full = text((b, n) => packageFull(processHandle, n, b))
      const identity = {
        sameLogon,
        family: text((b, n) => packageFamily(processHandle, n, b)),
        root: text((b, n) => packagePath(full, n, b)),
        executable: text((b, n) => image(processHandle, 0, b, n), 1),
      }
      checkPerplexityIdentity(identity)
      // Keep the process handle alive through signature verification and pipe adoption.
      return { identity, release: () => close(processHandle) }
    } catch (error) {
      close(processHandle)
      throw error
    }
  }
  const windowsDirectory = () => {
    const b = Buffer.alloc(65536),
      n = directory(b, 32768)
    if (!n || n >= 32768) throw failure()
    return b.toString('utf16le', 0, n * 2)
  }
  return {
    koffi,
    open,
    close,
    lastError,
    event,
    read,
    write,
    result,
    cancel,
    inspect,
    windowsDirectory,
  }
}
type Native = ReturnType<typeof windows>
let native: Native | undefined

const signatures = new Map<string, Promise<void>>()
function verifySignature(executable: string, windowsDirectory: string): Promise<void> {
  const existing = signatures.get(executable)
  if (existing) return existing
  // Store package registration and health are the trust anchor: its executables
  // do not carry independent Authenticode signatures. Never accept loose binaries.
  const script = `$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; $expected=[Console]::In.ReadToEnd() | ConvertFrom-Json; $p=Get-AppxPackage -Name 'PerplexityAI.PerplexityApp' | Where-Object { [IO.Path]::Combine($_.InstallLocation,'app','resources','native','bin','perplexity.exe') -eq $expected }; if (@($p).Count -ne 1 -or $p.PackageFamilyName -ne 'PerplexityAI.PerplexityApp_3jh4kjrg4dzr2' -or $p.Publisher -ne 'CN=8FB64E05-C798-4941-B93C-0027DCE83E56' -or $p.SignatureKind -ne 'Store' -or $p.Status -ne 'Ok') { exit 1 }`
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'psmodulepath'),
  )
  env.PSModulePath = win32.join(
    windowsDirectory,
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'Modules',
  )
  const pending = new Promise<void>((resolve, reject) => {
    const child = execFile(
      win32.join(windowsDirectory, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(script, 'utf16le').toString('base64'),
      ],
      { windowsHide: true, timeout: 15000, maxBuffer: 4096, env },
      (error) => (error ? reject(failure()) : resolve()),
    )
    child.stdin?.on('error', () => reject(failure()))
    child.stdin?.end(JSON.stringify(executable))
  })
  // Only OS-identified package paths reach this cache; failures are never cached.
  if (signatures.size > 8) signatures.clear()
  signatures.set(executable, pending)
  void pending.catch(() => signatures.delete(executable))
  return pending
}

/** Bounded overlapped I/O; cancellation completes before buffers/handles are released. */
class NativePipeStream extends Duplex {
  private operations = new Set<Promise<void>>()
  private buffers = new Set<Buffer>()
  private reading = false
  constructor(
    private api: Native,
    private handle: unknown,
  ) {
    super()
  }
  private io(data: Buffer, reading: boolean): Promise<number> {
    const { api, handle } = this
    const event = api.event(null, 1, 0, null)
    if (!event) return Promise.reject(failure())
    const overlapped = Buffer.alloc(32)
    overlapped.writeBigUInt64LE(api.koffi.address(event), 24)
    // Native overlapped I/O outlives the FFI call. Keep explicit strong references
    // rather than relying on a closure whose unused captures V8 can collect.
    this.buffers.add(data)
    this.buffers.add(overlapped)
    const release = () => {
      api.close(event)
      this.buffers.delete(data)
      this.buffers.delete(overlapped)
    }
    const pending = new Promise<number>((resolve, reject) => {
      const operation = reading ? api.read : api.write
      if (!operation(handle, data, data.length, null, overlapped) && api.lastError() !== 997) {
        release()
        reject(new Error('Perplexity pipe I/O failed.'))
        return
      }
      const poll = () => {
        const count = [0]
        if (api.result(handle, overlapped, count, 0)) {
          release()
          resolve(count[0]!)
          return
        }
        if (api.lastError() !== 996) {
          release()
          reject(new Error('Perplexity pipe disconnected.'))
          return
        }
        setTimeout(poll, 10)
      }
      poll()
    })
    const settled = pending.then(
      () => {},
      () => {},
    )
    this.operations.add(settled)
    void settled.then(() => this.operations.delete(settled))
    return pending
  }
  override _read(): void {
    if (this.reading || this.destroyed) return
    this.reading = true
    const buffer = Buffer.alloc(65536)
    void this.io(buffer, true).then(
      (size) => {
        this.reading = false
        if (!this.destroyed) {
          if (!size) this.destroy()
          else if (this.push(buffer.subarray(0, size))) this._read()
        }
      },
      (error: Error) => this.destroy(error),
    )
  }
  override _write(
    data: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    if (this.destroyed) {
      callback(new Error('Perplexity pipe closed.'))
      return
    }
    void this.io(data, false).then(
      (size) => callback(size === data.length ? null : new Error('Incomplete Perplexity write.')),
      callback,
    )
  }
  override _destroy(error: Error | null, callback: (error: Error | null) => void): void {
    this.api.cancel(this.handle, null)
    void Promise.all([...this.operations]).then(() => {
      this.api.close(this.handle)
      callback(error)
    })
  }
}

export async function openVerifiedPerplexityPipe(path: string): Promise<Duplex> {
  const api = (native ??= windows())
  // A non-production path is useful for isolated negative tests, never a trust bypass.
  if (!/^\\\\\.\\pipe\\perplexity-rpc-[a-f0-9]{32}$/.test(path)) throw failure()
  const handle = api.open(path, 0xc0000000, 0, null, 3, PIPE_OPEN_FLAGS, null)
  const openError = api.lastError()
  if (!handle || api.koffi.address(handle) === 0xffffffffffffffffn) {
    if (openError === 5)
      throw Error(
        'Perplexity access was denied. Run Threadlight in the same Windows sign-in as Perplexity.',
      )
    if (openError === 231)
      throw Error(
        'The Perplexity desktop pipe is busy. Wait for the current connection and try again.',
      )
    throw failure()
  }
  let verified: ReturnType<Native['inspect']> | undefined
  try {
    verified = api.inspect(handle)
    await verifySignature(verified.identity.executable, api.windowsDirectory())
    return new NativePipeStream(api, handle)
  } catch (error) {
    api.close(handle)
    throw error
  } finally {
    verified?.release()
  }
}
