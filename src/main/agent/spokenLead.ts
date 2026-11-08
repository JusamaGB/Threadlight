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

/** A bounded vocabulary of read targets keeps an instruction embedded in an
 * otherwise plausible status from being spoken before the editor receipt. */
function editorRead(clause: string): boolean {
  const action =
    /^(?:check(?:ing)?|read(?:ing)?|review(?:ing)?|inspect(?:ing)?|confirm(?:ing)?|verify(?:ing)?|look(?:ing)? (?:at|into)) (.+)$/i.exec(
      clause,
    )
  if (!action) return false
  const target = action[1]!
  const state =
    /^(?:if|whether) (.+?) (?:is|are) (?:available|open|ready|connected|visible|accessible|loaded)(?: again| now)?$/i.exec(
      target,
    )
  return /^(?:(?:the|this|that|my|your|our|its|current|active|open|saved|unsaved|selected|highlighted|visible|source|editor|VS Code) )*(?:VS Code|coach|editor|connection|status|context|file|code|buffer|document|selection|function|line|window|screen|proposal|guide|workspace|example)(?: again| now| first)?$/i.test(
    state?.[1] ?? target,
  )
}

export function progressAcknowledgment(raw: string): string | null {
  const text = raw.trim()
  if (!text || text.length > 400 || /[\r\n`{}<>[\]()_#*=|\\?;:"“”—]/.test(text)) return null
  const sentences = text.split(/(?<=[.!])\s+/).map((s) => s.replace(/[.!]$/, ''))
  const continuity =
    /^I (?:still )?(?:have|remember) (?:the|this|that|our|your) (?:code change|example|request|issue|question)(?: we (?:were (?:preparing|discussing|reviewing|working on)|discussed|reviewed)| you (?:shared|mentioned))?$/i
  if (sentences.length > 1 && continuity.test(sentences[0]!)) sentences.shift()
  const intent =
    /^(?:I(?:['’]ll| will|['’]m| am) |Let me )(?:(?:first|now|quickly) |going to )?(.+)$/i
  const allReads = sentences.every((sentence) => {
    const body = intent.exec(sentence)?.[1]
    return !!body && body.split(/\s+and\s+/i).every(editorRead)
  })
  return allReads ? text : null
}

export function completedSpeech(text: string): string {
  // Keep fenced examples in the transcript. A code-only answer gets a short location cue.
  const fence = /^\s*(?:`{3,}|~{3,})/m.exec(text)
  if (!fence) return spokenProse(text) || text
  const intro = text.slice(0, fence.index).trim()
  return spokenProse(text) || intro || 'The code example is in the Agent thread.'
}
