import { execFile } from 'node:child_process'
import { open } from 'node:fs/promises'
import { join } from 'node:path'
import { CODEX_UUID } from './identity'

/** Read one byte, never acquire, create or remove Codex's writer lock. Windows enforces
 * its byte-range lock even on empty files. Readable leftovers are not live writers. */
export async function writerHeld(locks: string, id: string): Promise<boolean> {
  if (!CODEX_UUID.test(id)) return true
  let file: Awaited<ReturnType<typeof open>> | undefined
  try {
    file = await open(join(locks, `${id}.lock`), 'r')
    if (process.platform !== 'win32') return true // advisory locks cannot be read-probed
    await file.read(Buffer.alloc(1), 0, 1, 0)
    return false
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ENOENT'
  } finally {
    await file?.close()
  }
}

export function codexProcesses(): Promise<{ running: boolean; commands: string[] }> {
  if (process.platform !== 'win32') return Promise.resolve({ running: true, commands: [] })
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "@(Get-CimInstance Win32_Process -Filter \"Name='codex.exe' OR Name='ChatGPT.exe'\" | Select-Object Name,CommandLine) | ConvertTo-Json -Compress",
      ],
      { windowsHide: true, timeout: 10_000, maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        if (error) return resolve({ running: true, commands: ['unknown'] })
        try {
          const parsed: unknown = JSON.parse(stdout || '[]')
          const rows = (Array.isArray(parsed) ? parsed : [parsed]) as {
            Name?: string
            CommandLine?: string
          }[]
          resolve({
            running: rows.length > 0,
            commands: rows
              .filter((r) => r.Name === 'codex.exe')
              .map((r) => r.CommandLine || 'unknown'),
          })
        } catch {
          resolve({ running: true, commands: ['unknown'] })
        }
      },
    )
  })
}

export async function codexHeld(locks: string, id: string): Promise<boolean> {
  if (await writerHeld(locks, id)) return true
  const { commands } = await codexProcesses()
  return commands.some((command) => command === 'unknown' || command.includes(id))
}
