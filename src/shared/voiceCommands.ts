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
