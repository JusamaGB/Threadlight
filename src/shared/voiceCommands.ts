// What the open mic acts on. Deterministic on purpose: an utterance is a command only when its
// words are exactly a command's words (case and punctuation aside), so ordinary talk near the
// microphone, or Whisper hearing words in noise, never does anything.

export type OpenMicCommand = { kind: 'open' }

/** The command `text` is, or null for anything else. */
export function parseOpenMicCommand(text: string): OpenMicCommand | null {
  const words = text.toLowerCase().match(/[a-z']+/g) ?? []
  if (words.length === 1 && words[0] === 'open') return { kind: 'open' }
  return null
}

export type MicSessionMode = 'undecided' | 'commands' | 'agent'
export type MicRoute =
  | { kind: 'command'; command: OpenMicCommand }
  | { kind: 'agent'; text: string }
  | { kind: 'ignored' }

/** One microphone session. Only a completed sentence can choose its route. */
export class MicSessionRouter {
  mode: MicSessionMode = 'undecided'

  route(text: string): MicRoute {
    const sentence = text.trim()
    if (!sentence) return { kind: 'ignored' }
    const command = parseOpenMicCommand(sentence)
    if (this.mode === 'undecided') this.mode = command ? 'commands' : 'agent'
    if (this.mode === 'agent') return { kind: 'agent', text: sentence }
    return command ? { kind: 'command', command } : { kind: 'ignored' }
  }
}
