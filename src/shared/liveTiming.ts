// Diagnostics contain only named phases, monotonic timestamps and an optional PCM queue duration.
export const livePhases = [
  'connect',
  'mic-ready',
  'ready',
  'queue-drained',
  'queue-still-pending',
  'input',
  'user-transcript',
  'delegation',
  'backing-delta',
  'answer-frame',
  'speech-submit',
  'assistant-boundary',
  'done-boundary',
  'remote-pcm',
] as const
export type LivePhase = (typeof livePhases)[number]
export type LiveTiming = { session: string; phase: LivePhase; at: number; queueMs?: number }
export function timing(session: string, phase: LivePhase, queueMs?: number): LiveTiming {
  return {
    session,
    phase,
    at: performance.timeOrigin + performance.now(),
    ...(queueMs === undefined ? {} : { queueMs: Math.round(queueMs) }),
  }
}
