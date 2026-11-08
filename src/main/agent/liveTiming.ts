import { appendFile, stat, writeFile } from 'node:fs/promises'
import { livePhases, type LiveTiming } from '../../shared/liveTiming'
import { validVoiceSession } from '../../shared/liveVoice'

let file: string | undefined
let writes = Promise.resolve()
let sequence = 0
const sessions = new Map<string, number>()
export function setLiveTimingFile(path?: string) {
  file = path
}

export function recordLiveTiming(event: LiveTiming) {
  if (
    !file ||
    !event ||
    !validVoiceSession(event.session) ||
    !livePhases.includes(event.phase) ||
    !Number.isFinite(event.at) ||
    Math.abs(event.at - Date.now()) > 86400000 ||
    (event.queueMs !== undefined &&
      (!Number.isFinite(event.queueMs) || event.queueMs < 0 || event.queueMs > 60000))
  )
    return
  const path = file
  if (!sessions.has(event.session)) {
    if (sessions.size >= 64) sessions.delete(sessions.keys().next().value!)
    sessions.set(event.session, ++sequence)
  }
  const line =
    JSON.stringify({
      call: sessions.get(event.session),
      phase: event.phase,
      at: event.at,
      queueMs: event.queueMs,
    }) + '\n'
  writes = writes
    .then(async () => {
      const size = await stat(path).then(
        (s) => s.size,
        () => 0,
      )
      if (size > 256000) await writeFile(path, line)
      else await appendFile(path, line)
    })
    .catch(() => {})
}
