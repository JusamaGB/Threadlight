// Turns the open mic's utterances into sentences, and decides when one is finished.
//
// A command counts only when it is followed by a real pause: "open", then quiet, opens the
// panel. If the speaker goes on before the pause is up ("open… the docs thread and tell it…"),
// the words are joined into one sentence and judged together once they do pause, so a command
// word at the start of a longer sentence never fires on its own. Nothing is judged while words
// are still being transcribed, and a cough or click between words neither ends nor breaks the
// sentence. Times are on the audio's own clock (Segmenter.now).

/** The quiet after the last word before a sentence is taken as finished. */
export const SENTENCE_PAUSE_MS = 1000

export class SentenceAssembler {
  private parts: string[] = []
  private transcribing = 0
  private speaking = false
  private lastEnded = Number.NEGATIVE_INFINITY

  /** An utterance began. */
  started(): void {
    this.speaking = true
  }

  /** An utterance that counts ended at `endedAt` (its last loud frame); its words are on the way. */
  ended(endedAt: number): void {
    this.speaking = false
    this.lastEnded = endedAt
    this.transcribing += 1
  }

  /** An utterance turned out to be a cough or a click: as if it never happened. */
  dropped(): void {
    this.speaking = false
  }

  /** The words of the oldest utterance still being transcribed (empty if none were heard). */
  heard(text: string): void {
    this.transcribing = Math.max(0, this.transcribing - 1)
    const words = text.trim()
    if (words) this.parts.push(words)
  }

  /** The finished sentence, once the speaker has paused long enough; else null. */
  take(now: number): string | null {
    if (this.speaking || this.transcribing > 0 || this.parts.length === 0) return null
    if (now - this.lastEnded < SENTENCE_PAUSE_MS) return null
    const sentence = this.parts.join(' ')
    this.parts = []
    return sentence
  }

  /** Forgets everything under way (the open mic was paused or turned off). */
  reset(): void {
    this.parts = []
    this.transcribing = 0
    this.speaking = false
  }
}
