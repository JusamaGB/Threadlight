import { describe, expect, it } from 'vitest'

import { Segmenter, VAD } from '../src/shared/vad'
import { collapseRepeats } from '../src/shared/speechText'
import { parseOpenMicCommand } from '../src/shared/voiceCommands'
import { SENTENCE_PAUSE_MS, SentenceAssembler } from '../src/shared/voiceTurns'

const RATE = 16_000
const FRAME = 512
const FRAME_MS = (FRAME / RATE) * 1000

/** Frames of a steady tone at `level` peak, for `ms`. */
function sound(level: number, ms: number): Float32Array[] {
  return Array.from({ length: Math.round(ms / FRAME_MS) }, () =>
    Float32Array.from({ length: FRAME }, (_, i) => level * Math.sin(i / 3)),
  )
}

/** Feeds every frame, returning each utterance's length in ms. */
function run(segmenter: Segmenter, ...parts: Float32Array[][]): number[] {
  const found: number[] = []
  for (const frame of parts.flat()) {
    const event = segmenter.feed(frame)
    if (event?.kind === 'utterance') found.push((event.audio.length / RATE) * 1000)
  }
  return found
}

describe('open mic segmenter', () => {
  it('finds a word in a quiet room, with its lead-in, once the quiet has lasted', () => {
    const found = run(new Segmenter(RATE), sound(0.01, 1000), sound(0.3, 400), sound(0.01, 700))
    expect(found).toHaveLength(1)
    // Lead-in (up to PRE_ROLL_MS) + the word + the quiet that ended it.
    expect(found[0]).toBeGreaterThan(400 + VAD.END_SILENCE_MS)
    expect(found[0]).toBeLessThan(400 + VAD.END_SILENCE_MS + VAD.PRE_ROLL_MS + 2 * FRAME_MS)
  })

  it('drops a cough or a click too short to be a word', () => {
    expect(run(new Segmenter(RATE), sound(0.01, 1000), sound(0.4, 64), sound(0.01, 700))).toEqual(
      [],
    )
  })

  it('accepts a quiet word whose strongest syllable is below the old fixed cutoff', () => {
    expect(
      run(
        new Segmenter(RATE),
        sound(0.0015, 1000),
        sound(0.015, 96),
        sound(0.049, 128),
        sound(0.015, 96),
        sound(0.0015, 700),
      ),
    ).toHaveLength(1)
  })

  it('still rejects low-level noise and short quiet clicks', () => {
    expect(
      run(new Segmenter(RATE), sound(0.0015, 1000), sound(0.009, 400), sound(0.0015, 700)),
    ).toEqual([])
    expect(
      run(new Segmenter(RATE), sound(0.0015, 1000), sound(0.049, 64), sound(0.0015, 700)),
    ).toEqual([])
    expect(
      run(new Segmenter(RATE), sound(0.0015, 1000), sound(0.02, 400), sound(0.0015, 700)),
    ).toEqual([])
  })

  it('in a loud room, wants speech well above the room', () => {
    // The telly sits at 0.05: the floor learns it, and the speech line goes to 0.2.
    const room = () => sound(0.05, 1500)
    expect(run(new Segmenter(RATE), room(), sound(0.15, 400), room())).toEqual([])
    expect(run(new Segmenter(RATE), room(), sound(0.3, 400), room())).toHaveLength(1)
  })

  it('never acts while it is still learning the room', () => {
    expect(run(new Segmenter(RATE), sound(0.3, 300))).toEqual([])
  })

  it('cuts off a very long utterance at the limit, and forgets one under way on drop', () => {
    const long = run(new Segmenter(RATE), sound(0.01, 1000), sound(0.3, VAD.MAX_UTTERANCE_MS + 500))
    expect(long).toHaveLength(1)
    const segmenter = new Segmenter(RATE)
    run(segmenter, sound(0.01, 1000), sound(0.3, 300))
    segmenter.drop()
    expect(run(segmenter, sound(0.01, 700))).toEqual([])
  })
})

describe('open mic commands', () => {
  it('takes exactly "open", however it is written', () => {
    expect(parseOpenMicCommand('Open.')).toEqual({ kind: 'open' })
    expect(parseOpenMicCommand('  open!  ')).toEqual({ kind: 'open' })
  })

  it('ignores anything more, or less', () => {
    for (const text of ['Open the door', 'opened', 'Thank you.', '', 'open open']) {
      expect(parseOpenMicCommand(text)).toBeNull()
    }
  })
})

describe('open mic sentences', () => {
  it('judges "open" only once the pause after it is long enough', () => {
    const turns = new SentenceAssembler()
    turns.started()
    turns.ended(1000)
    turns.heard('Open.')
    expect(turns.take(1000 + SENTENCE_PAUSE_MS - 1)).toBeNull()
    expect(turns.take(1000 + SENTENCE_PAUSE_MS)).toBe('Open.')
    expect(turns.take(5000)).toBeNull() // taken once
  })

  it('joins words that carry on before the pause is up into one sentence', () => {
    const turns = new SentenceAssembler()
    turns.started()
    turns.ended(1000)
    turns.heard('Open')
    turns.started() // speaking again 600 ms later: the same sentence
    expect(turns.take(1600)).toBeNull()
    turns.ended(3000)
    turns.heard('the docs thread and tell it to rebuild.')
    expect(turns.take(3000 + SENTENCE_PAUSE_MS)).toBe(
      'Open the docs thread and tell it to rebuild.',
    )
    expect(parseOpenMicCommand('Open the docs thread and tell it to rebuild.')).toBeNull()
  })

  it('waits for words still being transcribed, and lets a cough pass', () => {
    const turns = new SentenceAssembler()
    turns.started()
    turns.ended(1000)
    expect(turns.take(9000)).toBeNull() // "open" is not back from Whisper yet
    turns.started()
    turns.dropped() // a cough
    turns.heard('Open')
    expect(turns.take(1000 + SENTENCE_PAUSE_MS)).toBe('Open')
  })

  it('forgets everything on reset', () => {
    const turns = new SentenceAssembler()
    turns.started()
    turns.ended(1000)
    turns.reset()
    turns.heard('')
    expect(turns.take(9000)).toBeNull()
  })
})

describe('repeat collapsing', () => {
  it('cuts a phrase stuck on repeat back to one', () => {
    const stuck = "I'm going to go low. It's like, yeah. " + "It's like, ".repeat(40) + "it's"
    expect(collapseRepeats(stuck)).toBe("I'm going to go low. It's like, yeah. It's like… it's")
  })

  it('leaves something said once or twice alone', () => {
    const text = 'Run the tests, run the tests and then commit.'
    expect(collapseRepeats(text)).toBe(text)
    expect(collapseRepeats('no no no')).toBe('no…')
  })
})
