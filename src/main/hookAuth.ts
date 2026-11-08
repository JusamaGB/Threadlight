import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { mkdir, writeFile, rename, rm, lstat } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { execFile } from 'node:child_process'

export function sealHook(key: Buffer, aad: string, value: unknown): string {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(aad))
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
  return JSON.stringify({
    iv: iv.toString('hex'),
    tag: cipher.getAuthTag().toString('hex'),
    data: data.toString('base64'),
  })
}
export function openHook(key: Buffer, aad: string, wire: string): { iv: string; value: unknown } {
  const { iv, tag, data } = JSON.parse(wire)
  if (
    typeof iv !== 'string' ||
    !/^[a-f0-9]{24}$/.test(iv) ||
    typeof tag !== 'string' ||
    !/^[a-f0-9]{32}$/.test(tag) ||
    typeof data !== 'string'
  )
    throw new Error('Invalid hook envelope.')
  const cipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'))
  cipher.setAAD(Buffer.from(aad))
  cipher.setAuthTag(Buffer.from(tag, 'hex'))
  const clear = Buffer.concat([cipher.update(Buffer.from(data, 'base64')), cipher.final()])
  return { iv, value: JSON.parse(clear.toString('utf8')) }
}

export class HookAuthentication {
  private seen = new Map<string, number>()
  constructor(
    readonly key: Buffer,
    private now = Date.now,
  ) {
    if (key.length !== 32) throw new Error('Invalid hook key.')
  }
  accept(path: string, wire: string): { nonce: string; body: string } {
    const { iv, value } = openHook(this.key, `POST:${path}`, wire)
    const v = value as { time?: unknown; body?: unknown }
    if (
      !v ||
      typeof v.time !== 'number' ||
      !Number.isFinite(v.time) ||
      Math.abs(this.now() - v.time) > 60000 ||
      typeof v.body !== 'string' ||
      Buffer.byteLength(v.body) > 16 * 1024 * 1024
    )
      throw new Error('Expired or invalid hook request.')
    for (const [nonce, expiry] of this.seen) if (expiry < this.now()) this.seen.delete(nonce)
    if (this.seen.has(iv) || this.seen.size >= 8192)
      throw new Error('Repeated or excessive hook request.')
    this.seen.set(iv, this.now() + 120000)
    return { nonce: iv, body: v.body }
  }
}

/** User-scoped bootstrap, never a claim to isolate hostile processes of the same user. */
export async function publishHookKey(port: number): Promise<Buffer> {
  if (![47615, 47616].includes(port) || process.platform !== 'win32')
    throw new Error(
      'Hook authentication requires a supported Windows port or an explicit test key.',
    )
  return publishLocalKey('hook-auth', `${port}.key`)
}

/** Publish only after binding the service, so a failed second instance cannot rotate it. */
export async function publishLocalKey(
  area:
    'hook-auth' | 'memory-auth' | 'thread-read-auth' | 'space-context-auth' | 'app-control-auth',
  filename: string,
): Promise<Buffer> {
  if (process.platform !== 'win32' || !/^[a-z0-9.-]+$/.test(filename))
    throw new Error('Unsupported local credential location.')
  const directory = join(
    process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'),
    'Threadlight',
    area,
  )
  await mkdir(directory, { recursive: true })
  if ((await lstat(directory)).isSymbolicLink())
    throw new Error('Hook credential directory must not be a link.')
  // Explicit protected DACL, including removal of inherited access. Never put the key on argv.
  const script = `$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; $p=[Console]::In.ReadToEnd() | ConvertFrom-Json; $a=New-Object System.Security.AccessControl.DirectorySecurity; $a.SetAccessRuleProtection($true,$false); $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User; foreach($s in @($sid,[System.Security.Principal.SecurityIdentifier]::new('S-1-5-18'),[System.Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))) { $a.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($s,'FullControl','ContainerInherit,ObjectInherit','None','Allow')) }; [System.IO.Directory]::SetAccessControl($p,$a)`
  const windows = process.env.SystemRoot ?? 'C:\\Windows'
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'psmodulepath'),
  )
  env.PSModulePath = join(windows, 'System32', 'WindowsPowerShell', 'v1.0', 'Modules')
  await new Promise<void>((resolve, reject) => {
    const child = execFile(
      join(windows, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      [
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(script, 'utf16le').toString('base64'),
      ],
      { windowsHide: true, timeout: 10000, env },
      (error) => (error ? reject(new Error('Cannot protect hook credentials.')) : resolve()),
    )
    child.stdin?.on('error', reject)
    child.stdin?.end(JSON.stringify(directory))
  })
  const key = randomBytes(32),
    temporary = join(directory, `${filename}-${randomBytes(8).toString('hex')}.tmp`)
  try {
    await writeFile(temporary, key.toString('hex'), { flag: 'wx', mode: 0o600 })
    await rename(temporary, join(directory, filename))
  } finally {
    await rm(temporary, { force: true })
  }
  return key
}
