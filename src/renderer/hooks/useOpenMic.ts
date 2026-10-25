import { useEffect, useRef, useState } from 'react'

import { STT_SAMPLE_RATE } from '../../shared/stt'
import { Segmenter } from '../../shared/vad'
import { SentenceAssembler } from '../../shared/voiceTurns'
import { MicSessionRouter, type MicRoute, type MicSessionMode } from '../../shared/voiceCommands'
import type { Candidate } from '../../shared/match'

/** 32 ms frames at 16 kHz: fine enough for the level rules, light on the main thread. */
const FRAME = 512

export type OpenMicState = 'off' | 'listening' | 'hearing' | 'blocked'

interface OpenMicOptions {
  /** On in Settings, and the speech model is ready. */
  enabled: boolean
  /** Push-to-talk is recording: the open mic ignores the room until it is done. */
  paused: boolean
  /** Current list titles; refreshed without resetting the microphone session. */
  threads: Candidate[]
  /** Each finished sentence: words joined across short pauses, after a long enough one. */
  onSentence: (route: MicRoute) => void
}

/**
 * The open mic: listens continuously while enabled, splits what it hears into utterances on
 * the device (shared/vad.ts), transcribes each with the local Whisper in order, and hands on
 * whole sentences once the speaker pauses (shared/voiceTurns.ts). Nothing is recorded or kept
 * beyond the words of the sentence under way. Runs in the (possibly hidden) panel window.
 *
 * The page's root carries `data-open-mic` with the state, set when the microphone is actually
 * taken and released, so a check can see that switching off really lets the microphone go.
 */
export function useOpenMic({ enabled, paused, threads, onSentence }: OpenMicOptions) {
  const [state, setState] = useState<OpenMicState>('off')
  const [mode, setMode] = useState<MicSessionMode>('undecided')
  // A visual-only level shared with the divider; audio callbacks need not rerender the panel.
  const level = useRef(0)
  const latest = useRef({ paused, threads, onSentence })
  useEffect(() => {
    latest.current = { paused, threads, onSentence }
  })

  useEffect(() => {
    if (!enabled) return
    let stopped = false
    level.current = 0
    let release = () => {}
    const show = (next: OpenMicState) => {
      document.documentElement.dataset['openMic'] = next
      if (!stopped || next === 'off') setState(next)
    }
    void (async () => {
      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          // As BLAM8's Concierge: automatic gain off, or after a loud moment it turns the mic
          // down and the next quiet word never stands out from the room.
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: false,
          },
        })
      } catch {
        if (!stopped) show('blocked')
        return
      }
      if (stopped) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      // At Whisper's own rate, so an utterance goes to it as it is.
      const context = new AudioContext({ sampleRate: STT_SAMPLE_RATE })
      const source = context.createMediaStreamSource(stream)
      const processor = context.createScriptProcessor(FRAME, 1, 1)
      const mute = context.createGain()
      mute.gain.value = 0 // the processor only runs when connected; nothing reaches the speakers
      source.connect(processor)
      processor.connect(mute)
      mute.connect(context.destination)

      const segmenter = new Segmenter(context.sampleRate)
      const sentences = new SentenceAssembler()
      const routing = new MicSessionRouter()
      setMode('undecided')
      // Transcriptions run one at a time, in order; a pause throws away any still to come.
      let queue = Promise.resolve()
      let generation = 0
      processor.onaudioprocess = (event) => {
        if (latest.current.paused) {
          level.current = 0
          segmenter.drop()
          sentences.reset()
          generation += 1
          return
        }
        const frame = new Float32Array(event.inputBuffer.getChannelData(0))
        let sum = 0
        for (const sample of frame) sum += sample * sample
        level.current = Math.min(1, Math.sqrt(sum / frame.length) * 8)
        const heard = segmenter.feed(frame)
        if (heard?.kind === 'start') {
          sentences.started()
          show('hearing')
        } else if (heard?.kind === 'dropped') {
          sentences.dropped()
        } else if (heard?.kind === 'utterance') {
          sentences.ended(heard.endedAt)
          const mine = generation
          queue = queue.then(() =>
            window.threadlight
              .transcribe(heard.audio)
              .catch(() => '')
              .then((text) => {
                if (mine === generation) sentences.heard(text)
              }),
          )
        }
        const sentence = sentences.take(segmenter.now)
        if (sentence !== null && !stopped) {
          const route = routing.route(sentence, latest.current.threads)
          setMode(routing.mode)
          latest.current.onSentence(route)
        }
        if (heard?.kind === 'dropped' || sentence !== null) show('listening')
      }
      release = () => {
        level.current = 0
        processor.onaudioprocess = null
        stream.getTracks().forEach((track) => track.stop()) // the mic light goes off here
        void context.close()
        show('off')
      }
      show('listening')
    })()
    return () => {
      stopped = true
      level.current = 0
      release()
    }
  }, [enabled])

  return { state: enabled ? state : 'off', mode: enabled ? mode : 'undecided', level }
}
