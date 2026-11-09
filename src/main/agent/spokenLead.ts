import { spokenProse } from '../../shared/spokenProse'

/** Speak only a finished prose sentence from the start of an explicitly final answer.
 * A following separator makes the sentence stable across streamed deltas. */
export function spokenLead(text: string): string | null {
  const opening = text.trimStart()
  const separator = /\r?\n[ \t]*\r?\n/.exec(opening)
  const raw = opening.slice(0, separator?.index)
  if (
    !raw ||
    raw.length > 4096 ||
    /^(?:#{1,6}\s|```|~~~|[*-]\s)/.test(raw) ||
    (raw.includes('`') && !separator)
  )
    return null
  const line = spokenProse(raw)
  const stable = line + (/\s$/.test(raw) || !!separator ? ' ' : '')
  if (
    separator &&
    line.length <= 360 &&
    /[.!?]["'”’]?$/.test(line) &&
    line.split(/\s+/).length >= 5
  )
    return line
  if (!line || /^\s*(?:[#>|*-]|\d+[.)]\s)/.test(line)) return null
  for (const match of line.matchAll(/[.!?](?:["'”’])?(?=\s|$)/g)) {
    const end = match.index + match[0].length
    const sentence = line.slice(0, end)
    if (end > 360 || /[`{}<>[\]]|:\/\//.test(sentence)) return null
    if (
      !/^\s/.test(stable.slice(end)) ||
      /(?:\b(?:Mr|Mrs|Dr|Prof|Ms|etc|e\.g|i\.e)|\b[A-Z])\.$/i.test(sentence)
    )
      continue
    if (sentence.split(/\s+/).length >= 5) return sentence
  }
  return null
}

// Tool status stays visual. The speech source is the assistant's own prose.
export function commentarySpeech(text: string): string {
  const prose = spokenProse(text)
  return /^(?:just a (?:sec(?:ond)?|moment)|I[’']m still checking the editor for you)[.!…]?$/i.test(
    prose,
  )
    ? ''
    : prose
}

export function completedSpeech(text: string): string {
  // Keep fenced examples in the transcript. A code-only answer gets a short location cue.
  const fence = /^\s*(?:`{3,}|~{3,})/m.exec(text)
  if (!fence) return spokenProse(text) || text
  const intro = text.slice(0, fence.index).trim()
  return spokenProse(text) || intro || 'The code example is in the Agent thread.'
}
