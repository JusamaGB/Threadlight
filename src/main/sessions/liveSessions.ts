// Claude Code's own register of running sessions: each process writes
// `<liveSessionsDir>/<pid>.json` naming its session. The Claude app's threads are found only
// this way (their processes do not name the session on the command line).

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { isObject, str } from './json'

/** Every session a still-running Claude Code process has registered. Leftovers do not count. */
export async function liveSessionIds(
  liveSessionsDir: string,
  isRunning: (pid: number) => boolean = processIsRunning,
): Promise<Set<string>> {
  const live = new Set<string>()
  let names: string[]
  try {
    names = (await readdir(liveSessionsDir)).filter((name) => /^\d+\.json$/.test(name))
  } catch {
    return live // no register (an older Claude Code)
  }
  for (const name of names) {
    let entry: unknown
    try {
      entry = JSON.parse(await readFile(join(liveSessionsDir, name), 'utf8'))
    } catch {
      continue
    }
    const sessionId = isObject(entry) ? str(entry['sessionId']) : null
    if (!sessionId || !isObject(entry)) continue
    const pid = typeof entry['pid'] === 'number' ? entry['pid'] : Number.parseInt(name, 10)
    if (isRunning(pid)) live.add(sessionId)
  }
  return live
}

export function processIsRunning(pid: number): boolean {
  try {
    process.kill(pid, 0) // signal 0 only asks whether the process exists
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM' // exists, owned by someone else
  }
}
