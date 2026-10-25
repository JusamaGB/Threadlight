// Tidies what Whisper wrote. On unclear audio it can get stuck repeating a phrase ("it's like,
// it's like, it's like…" for a minute); a run of three or more of the same phrase (one to six
// words) is cut back to one, followed by "…". Saying something twice is left alone.

const MAX_PHRASE_WORDS = 6
const RUN = 3

export function collapseRepeats(text: string): string {
  const words = text.split(/\s+/).filter(Boolean)
  const norm = (word: string) => word.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '')
  const out: string[] = []
  let i = 0
  while (i < words.length) {
    let collapsed = false
    for (let size = 1; size <= MAX_PHRASE_WORDS && !collapsed; size++) {
      const phrase = words.slice(i, i + size).map(norm)
      if (phrase.length < size || phrase.every((w) => !w)) break
      let runs = 1
      while (
        words
          .slice(i + runs * size, i + (runs + 1) * size)
          .map(norm)
          .join(' ') === phrase.join(' ')
      ) {
        runs += 1
      }
      if (runs >= RUN) {
        out.push(...words.slice(i, i + size).map((w, k) => (k === size - 1 ? stripEnd(w) : w)))
        out[out.length - 1] += '…'
        i += runs * size
        collapsed = true
      }
    }
    if (!collapsed) out.push(words[i++]!)
  }
  return out.join(' ')
}

/** A phrase's last word without its trailing comma or full stop, before the "…". */
function stripEnd(word: string): string {
  return word.replace(/[,.;:!?]+$/, '')
}
