// Understanding a spoken message: "message docs site, check the build passed".
// parseVoiceCommand splits out the thread name and the message; matchThread finds the thread.

export interface VoiceCommand {
  /** The spoken thread name, as heard. */
  thread: string
  message: string
}

// "message X, …", "tell X to …", "ask X to …", "send (a message) to X saying …", optionally with
// a polite or wake-up word in front. The thread name ends at punctuation or at a joining word.
const COMMAND =
  /^(?:(?:hey|ok|okay|please)[\s,]+)*(?:message|tell|ask|send(?:\s+a\s+message)?\s+to|send)\s+(.+?)(?:\s*[,:;.!?-]\s+|\s+(?:that|to|saying|and say|and tell (?:it|them) to)\s+)(.+)$/is

export function parseVoiceCommand(text: string): VoiceCommand | null {
  const match = COMMAND.exec(text.trim())
  if (!match) return null
  const thread = match[1]!
    .trim()
    .replace(/^(?:the|my)\s+/i, '')
    .replace(/\s+(?:thread|session|chat)$/i, '')
  const message = match[2]!.trim()
  if (!thread || !message) return null
  return { thread, message: capitalise(message) }
}

export interface Candidate {
  id: string
  title: string
}

/** Below this, Threadlight asks you to pick rather than guess. */
export const MATCH_THRESHOLD = 0.6
/** The best match must beat the runner-up by this much, or it is ambiguous. */
export const MATCH_MARGIN = 0.15

/** The thread `spoken` most likely means, or null when nothing is close enough or it is a toss-up. */
export function matchThread(spoken: string, candidates: Candidate[]): Candidate | null {
  const scored = candidates
    .map((candidate) => ({ candidate, score: similarity(spoken, candidate.title) }))
    .sort((a, b) => b.score - a.score)
  const [best, next] = scored
  if (!best || best.score < MATCH_THRESHOLD) return null
  if (next && best.score - next.score < MATCH_MARGIN) return null
  return best.candidate
}

/**
 * How well a spoken name fits a title, from 0 to 1. Mostly the share of spoken words found in
 * the title (allowing small mishearings and prefixes); partly how much of the title they cover,
 * so "docs" fits a thread called "Docs" better than one called "Docs site rebuild".
 */
export function similarity(spoken: string, title: string): number {
  const said = words(spoken)
  const have = words(title)
  if (said.length === 0 || have.length === 0) return 0
  const hits = said.filter((word) => have.some((candidate) => sameWord(word, candidate))).length
  const found = hits / said.length
  const covered = Math.min(1, hits / have.length)
  return 0.75 * found + 0.25 * covered
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

function sameWord(said: string, have: string): boolean {
  if (said === have) return true
  if (said.length >= 3 && have.startsWith(said)) return true // "config" for "configuration"
  if (Math.min(said.length, have.length) >= 5) return editDistance(said, have) <= 1 // misheard
  return false
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0]!
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const current = row[j]!
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1))
      previous = current
    }
  }
  return row[b.length]!
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}
