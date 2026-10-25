// Deterministic commands: exact keywords and title phrases, without model calls or fuzzy scores.

import type { Candidate } from './match'

export type OpenMicCommand =
  { kind: 'open' } | { kind: 'focus'; threadId: string } | { kind: 'ambiguous'; titles: string[] }

const normalise = (text: string) => (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).join(' ')
const spokenKey = (text: string) => normalise(text).replaceAll(' ', '')

/** Ignore speech-recognition word splits, while retaining the title's phrase boundaries. */
function containsSpokenName(title: string, name: string): boolean {
  const words = normalise(title).split(' ')
  for (let start = 0; start < words.length; start++) {
    let phrase = ''
    for (let end = start; end < words.length; end++) {
      phrase += words[end]
      if (phrase === name) return true
      if (phrase.length >= name.length) break
    }
  }
  return false
}

/** Exact titles win; otherwise require a unique, whole-word phrase within a title. */
function namedThread(text: string, threads: Candidate[]): OpenMicCommand | null {
  const name = spokenKey(text)
  if (!name) return null
  const unique = [...new Map(threads.map((thread) => [thread.id, thread])).values()]
  const exact = unique.filter((thread) => spokenKey(thread.title) === name)
  const matches = exact.length
    ? exact
    : unique.filter((thread) => containsSpokenName(thread.title, name))
  if (matches.length === 1) return { kind: 'focus', threadId: matches[0]!.id }
  if (matches.length > 1)
    return { kind: 'ambiguous', titles: matches.map((thread) => thread.title) }
  return null
}

/** The command `text` is, or null for anything else. */
export function parseOpenMicCommand(
  text: string,
  threads: Candidate[] = [],
): OpenMicCommand | null {
  const words = normalise(text)
  if (words === 'open') return { kind: 'open' }
  if (words.startsWith('open ')) return namedThread(words.slice(5), threads)
  return null
}

export type MicSessionMode = 'undecided' | 'commands' | 'agent'
export type MicRoute =
  | { kind: 'command'; command: OpenMicCommand }
  | { kind: 'agent'; text: string }
  | { kind: 'unmatched'; text: string }
  | { kind: 'ignored' }

/** One microphone session. Only a completed sentence can choose its route. */
export class MicSessionRouter {
  mode: MicSessionMode = 'undecided'

  route(text: string, threads: Candidate[] = []): MicRoute {
    const sentence = text.trim()
    if (!sentence) return { kind: 'ignored' }
    // Choose the route from command syntax, not from whether a title was recognised.
    // A misheard or unavailable title must never turn a command into an Agent request.
    if (this.mode === 'undecided') {
      const words = normalise(sentence)
      this.mode = words === 'open' || words.startsWith('open ') ? 'commands' : 'agent'
    }
    if (this.mode === 'agent') return { kind: 'agent', text: sentence }
    const command = parseOpenMicCommand(sentence, threads) ?? namedThread(sentence, threads)
    return command ? { kind: 'command', command } : { kind: 'unmatched', text: sentence }
  }
}
