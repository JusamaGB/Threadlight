/** A local first-sentence title; the original note body is never shortened. */
export function noteTitle(text: string): string {
  const trimmed = text.trim()
  const sentences = new Intl.Segmenter('en', { granularity: 'sentence' }).segment(trimmed)
  const first = sentences[Symbol.iterator]().next().value?.segment
  return (first ?? trimmed).replace(/\s+/g, ' ').trim().slice(0, 80)
}
