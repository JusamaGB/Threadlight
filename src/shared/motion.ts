import type { AgentStatus } from './agent'

/** Visual telemetry only: no audio samples or transcript crosses the dot's IPC channel. */
export interface AudioEnergy {
  level: number
  low: number
  mid: number
  high: number
}

export type MotionMode = 'idle' | 'listening' | 'thinking' | 'transcribing' | 'waiting' | 'error'
export interface MotionSnapshot {
  mode: MotionMode
  input: AudioEnergy
  output: AudioEnergy
}

export const SILENT_AUDIO: Readonly<AudioEnergy> = { level: 0, low: 0, mid: 0, high: 0 }
export const IDLE_MOTION: MotionSnapshot = {
  mode: 'idle',
  input: SILENT_AUDIO,
  output: SILENT_AUDIO,
}

export const unit = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0

export function motionMode({
  recording,
  microphone,
  agent,
  waitingForReply,
  failed,
}: {
  recording: 'idle' | 'listening' | 'transcribing'
  microphone: boolean
  agent: AgentStatus
  waitingForReply: boolean
  failed: boolean
}): MotionMode {
  if (recording !== 'idle') return recording
  if (failed || agent === 'error') return 'error'
  if (agent === 'waiting') return 'waiting'
  if (waitingForReply || agent === 'working' || agent === 'starting' || agent === 'stopping')
    return 'thinking'
  return microphone ? 'listening' : 'idle'
}

export function readMotion(value: unknown): MotionSnapshot | null {
  if (!value || typeof value !== 'object') return null
  const data = value as Record<string, unknown>
  if (
    !['idle', 'listening', 'thinking', 'transcribing', 'waiting', 'error'].includes(
      String(data.mode),
    )
  )
    return null
  const energy = (value: unknown): AudioEnergy | null => {
    if (!value || typeof value !== 'object') return null
    const e = value as Record<string, unknown>
    const keys = ['level', 'low', 'mid', 'high'] as const
    if (keys.some((key) => typeof e[key] !== 'number' || !Number.isFinite(e[key]))) return null
    return Object.fromEntries(
      keys.map((key) => [key, unit(e[key] as number)]),
    ) as unknown as AudioEnergy
  }
  const input = energy(data.input)
  const output = energy(data.output)
  return input && output ? { mode: data.mode as MotionMode, input, output } : null
}
