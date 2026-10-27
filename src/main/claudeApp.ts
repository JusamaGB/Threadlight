// Talking to the Claude desktop app from the outside: is it running, and open a thread in it.

import { open } from 'node:fs/promises'

import { shell } from 'electron'

import { appDeepLink } from './sessions/paths'

/**
 * Electron apps hold an exclusive lock on `<userData>/lockfile` while they run, so a busy
 * lockfile means the Claude app is open. Cheaper and more reliable than listing processes.
 */
export async function isClaudeAppRunning(lockFile: string): Promise<boolean> {
  try {
    const handle = await open(lockFile, 'r+')
    await handle.close()
    return false // left over from a previous run, not held by anyone
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    return code === 'EBUSY' || code === 'EPERM' || code === 'EACCES'
  }
}

/** The app's thread ids look like `local_` + a UUID; anything else is refused. */
const APP_ID = /^local_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export function openThread(appId: string): boolean {
  if (!APP_ID.test(appId)) return false
  void shell.openExternal(appDeepLink(appId))
  return true
}
