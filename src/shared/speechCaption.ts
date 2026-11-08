// A submission and a native playback boundary have no shared request handle.
// Word evidence restricts which captions can be attributed to that submission.
export function plainSpeech(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\.(["'])$/, '$1.')
}

function prose(text: string) {
  return plainSpeech(text)
    .toLowerCase()
    .replace(/[,;:](?=\s|$)|\.(?=\s|$)/g, '')
}

function canonical(text: string) {
  return prose(text)
    .replace(/\bin ((?:this|the|your) [\p{L}-]+) i (?:can )?see\b/gu, 'i see $1')
    .replace(/\bi can see\b/g, 'i see')
    .replace(/\band then\b/g, 'and')
    .replace(
      /\b(was|were) ([\p{L}-]+) and ((?:(?:the|your|this) )?[\p{L}-]+) \1 ([\p{L}-]+)/gu,
      '$1 $2 and $3 $4',
    )
    .replace(/\bi(?:'ll| can| will) continue from (here|there)\b/g, 'i continue from $1')
}

// Finite alternatives allow a streaming prefix to be checked before a complete
// clause arrives. We never equate a bag of words, discard negation, or guess a synonym.
function alternatives(source: string): string[][] {
  const parts: string[][] = []
  const pattern =
    /\bi see ((?:this|the|your) [\p{L}-]+)|\bi continue from (here|there)|\b(was|were) ([\p{L}-]+) and ((?:(?:the|your|this) )?[\p{L}-]+) ([\p{L}-]+)|\band\b/gu
  let end = 0
  for (const m of source.matchAll(pattern)) {
    parts.push([source.slice(end, m.index)])
    if (m[1])
      parts.push([m[0], 'i can see ' + m[1], 'in ' + m[1] + ' i see', 'in ' + m[1] + ' i can see'])
    else if (m[2])
      parts.push([
        m[0],
        ...["i'll", 'i can', 'i will'].map((prefix) => prefix + ' continue from ' + m[2]),
      ])
    else if (m[3]) parts.push([m[0], m[3] + ' ' + m[4] + ' and ' + m[5] + ' ' + m[3] + ' ' + m[6]])
    else parts.push(['and', 'and then'])
    end = m.index + m[0].length
  }
  parts.push([source.slice(end)])
  return parts
}
export function matchesSpeech(requested: string, caption: string, partial = false): boolean {
  const target = plainSpeech(requested),
    words = plainSpeech(caption)
  if (!words) return false
  if (target === words || (partial && target.startsWith(words))) return true
  if (
    target.split(' ').length < 8 ||
    target.length > 8000 ||
    /[`{}<>=[\]\\]/.test(requested + caption) ||
    /\b(approv\w*|den(?:y|ied)|permission|authori[sz]\w*|delet\w*|refus\w*)\b/i.test(
      requested + caption,
    )
  )
    return false
  const source = canonical(requested),
    actual = prose(caption)
  if (!partial) return source === canonical(caption)
  let positions = new Set([0])
  for (const options of alternatives(source)) {
    const next = new Set<number>()
    for (const pos of positions)
      for (const option of options) {
        const rest = actual.slice(pos)
        if (option.startsWith(rest)) return true
        if (rest.startsWith(option)) next.add(pos + option.length)
      }
    if (!next.size) return false
    positions = next
  }
  return positions.has(actual.length)
}
