import { readFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'

/** Existing opt-in observer's heartbeat. Read only; never stops a test or capture. */
export function observerActive(appRoot: string, now = Date.now()): boolean {
  const root = resolve(process.env.THREADLIGHT_E2E_DIR || join(dirname(appRoot), 'threadlight-e2e'))
  try {
    const pointer = JSON.parse(readFileSync(join(root, 'latest.json'), 'utf8'))
    if (typeof pointer.folder !== 'string') return true
    const folder = resolve(pointer.folder)
    if (
      !folder.toLowerCase().startsWith(`${root.toLowerCase()}\\`) &&
      !folder.startsWith(`${root}/`)
    )
      return true
    const status = JSON.parse(readFileSync(join(folder, 'status.json'), 'utf8'))
    return status.running === true && now - Date.parse(status.at) < 15000
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ENOENT'
  }
}
