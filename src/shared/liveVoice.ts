/** One hotkey activation owns one native Codex voice session. No API credentials cross IPC. */
export type LiveVoiceResult = { ok: true; sdp: string } | { ok: false; reason: string }
export type LiveVoiceEvent = {
  sessionId: string
  type: 'closed' | 'error' | 'interrupt-narration'
  turnId?: string
  message?: string
}
export type PlaybackBoundary = 'assistant' | 'done' | 'user' | 'skip'
export type LiveVoicePhase = 'off' | 'connecting' | 'ready' | 'waiting' | 'live' | 'error'

export const validVoiceSession = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-zA-Z0-9-]{16,80}$/.test(value)

export const validVoiceOffer = (value: unknown): value is string =>
  typeof value === 'string' && value.length < 64_000 && value.startsWith('v=0')

export type ScreenVoiceEvent = { id: string; action: 'start' | 'stop' }
export type ScreenVoiceCommand = 'offer' | 'speak' | 'done' | 'failed'
