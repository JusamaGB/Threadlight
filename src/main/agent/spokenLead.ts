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

/** Only narrate short, plain statements about the Agent's own read/check.
 * Instructional prose and code wait for the corresponding editor receipt. */
export function progressAcknowledgment(raw: string): string | null {
  const text = raw.trim()
  if (!text || text.length > 400 || /[\r\n`{}<>[\]()_#*=|\\?;:"“”—]/.test(text)) return null
  const sentences = text.split(/(?<=[.!])\s+/)
  const reading =
    /^(?:I(?:['’]ll| will|['’]m| am) |Let me )(?:(?:first|now|quickly) |going to )?(?:check(?:ing)?|read(?:ing)?|review(?:ing)?|inspect(?:ing)?|confirm(?:ing)?|verify(?:ing)?|look(?:ing)? (?:at|into))\b/i
  const continuity = /^(?:I (?:still )?(?:have|remember)|I['’]ve (?:still )?got)\b/i
  if (
    !sentences.some((s) => reading.test(s)) ||
    !sentences.every((s) => reading.test(s) || continuity.test(s))
  )
    return null
  if (
    /\b(?:type|press|paste|click|replace|insert|delete|execute|approve|should|must|recommend|suggest)\b|(?:,|\band|\bthen)\s+(?:please\s+)?(?:change|use|add|run|enter|keep|set|remove|write)\b/i.test(
      text,
    )
  )
    return null
  return text
}

export function completedSpeech(text: string): string {
  // Keep fenced examples in the transcript. A code-only answer gets a short location cue.
  const fence = /^\s*(?:`{3,}|~{3,})/m.exec(text)
  if (!fence) return spokenProse(text) || text
  const intro = text.slice(0, fence.index).trim()
  return spokenProse(text) || intro || 'The code example is in the Agent thread.'
}
