import { useEffect, useRef, useState } from 'react'

import { STT_SAMPLE_RATE } from '../../shared/stt'
import { Segmenter } from '../../shared/vad'
import { SentenceAssembler } from '../../shared/voiceTurns'
import { MicSessionRouter, type MicRoute, type MicSessionMode } from '../../shared/voiceCommands'
import type { Candidate } from '../../shared/match'
import { LiveVoiceConnection } from '../lib/liveVoice'
import type { LiveVoicePhase } from '../../shared/liveVoice'
import { SILENT_AUDIO, type AudioEnergy } from '../../shared/motion'
import { AudioEnergyMeter } from '../lib/audioEnergy'

/** 32 ms frames at 16 kHz: fine enough for the level rules, light on the main thread. */
const FRAME = 512

export type OpenMicState = 'off' | 'listening' | 'hearing' | 'blocked'

interface OpenMicOptions {
  /** On in Settings, and the speech model is ready. */
  enabled: boolean
  /** Push-to-talk is recording: the open mic ignores the room until it is done. */
  paused: boolean
  /** Claude uses local sentence transcription; native conversational audio is Codex-only. */
  nativeLive?: boolean
  /** Current list titles; refreshed without resetting the microphone session. */
  threads: Candidate[]
  /** Each finished sentence: words joined across short pauses, after a long enough one. */
  onSentence: (route: MicRoute) => void
  onConversation?: () => void
  onStop?: () => void
}

/**
 * The open mic: listens continuously while enabled, splits what it hears into utterances on
 * the device (shared/vad.ts), transcribes each with the local Whisper in order, and hands on
 * whole sentences once the speaker pauses (shared/voiceTurns.ts). Raw audio is not saved;
 * Live conversation text is retained in Agent history. Runs in the panel window.
 *
 * The page's root carries `data-open-mic` with the state, set when the microphone is actually
 * taken and released, so a check can see that switching off really lets the microphone go.
 */
export function useOpenMic({
  enabled,
  paused,
  nativeLive = true,
  threads,
  onSentence,
  onConversation,
  onStop,
}: OpenMicOptions) {
  const [state, setState] = useState<OpenMicState>('off')
  const [mode, setMode] = useState<MicSessionMode>('undecided')
  const [livePhase, setLivePhase] = useState<LiveVoicePhase>('off')
  const [liveError, setLiveError] = useState<string | null>(null)
  const [openingDraft, setOpeningDraft] = useState('')
  // A visual-only level shared with the divider; audio callbacks need not rerender the panel.
  const level = useRef(0)
  const energy = useRef<AudioEnergy>(SILENT_AUDIO)
  const outputEnergy = useRef<AudioEnergy>(SILENT_AUDIO)
  const latest = useRef({ paused, threads, onSentence, onConversation, onStop })
  useEffect(() => {
    latest.current = { paused, threads, onSentence, onConversation, onStop }
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
      const meter = new AudioEnergyMeter(source, context)
      const processor = context.createScriptProcessor(FRAME, 1, 1)
      const outgoing = context.createMediaStreamDestination()
      const mute = context.createGain()
      mute.gain.value = 0 // the processor only runs when connected; nothing reaches the speakers
      source.connect(processor)
      processor.connect(mute)
      processor.connect(outgoing)
      mute.connect(context.destination)

      const segmenter = new Segmenter(context.sampleRate)
      const sentences = new SentenceAssembler()
      const routing = new MicSessionRouter()
      let live: LiveVoiceConnection | null = null
      const opening: string[] = []
      let committed = false
      let failed = false
      let previewPending = false
      let lastPreview = 0
      let previewUtterance = 0
      let conversationalPreviews = 0
      setMode('undecided')
      setLivePhase('off')
      setLiveError(null)
      setOpeningDraft('')
      const prepare = () => {
        if (!nativeLive || live || failed || stopped) return
        // Preparation is provisional. Only the final opening sentence latches its mode.
        setMode('agent')
        latest.current.onConversation?.()
        try {
          live = new LiveVoiceConnection(
            outgoing.stream,
            context.sampleRate,
            (phase, error) => {
              if (stopped) return
              setLivePhase(phase)
              if (phase === 'off') latest.current.onStop?.()
              if (error) {
                failed = true
                setLiveError(error)
                if (committed) latest.current.onStop?.()
              }
            },
            context,
          )
          void live.start()
        } catch (error) {
          failed = true
          setLivePhase('error')
          setLiveError((error as Error).message)
        }
      }
      // Transcriptions run one at a time, in order; a pause throws away any still to come.
      let queue = Promise.resolve()
      let generation = 0
      processor.onaudioprocess = (event) => {
        const output = event.outputBuffer.getChannelData(0)
        output.fill(0)
        live?.setPaused(latest.current.paused)
        if (latest.current.paused) {
          level.current = 0
          energy.current = SILENT_AUDIO
          outputEnergy.current = SILENT_AUDIO
          segmenter.drop()
          sentences.reset()
          generation += 1
          previewUtterance += 1
          return
        }
        const frame = new Float32Array(event.inputBuffer.getChannelData(0))
        let sum = 0
        for (const sample of frame) sum += sample * sample
        level.current = Math.min(1, Math.sqrt(sum / frame.length) * 8)
        energy.current = meter.read()
        outputEnergy.current = live?.outputEnergy ?? SILENT_AUDIO
        live?.process(frame, output)
        if (committed) {
          if (!failed) show(level.current > 0.1 ? 'hearing' : 'listening')
          return
        }
        const heard = segmenter.feed(frame)
        if (heard?.kind === 'start') {
          previewUtterance += 1
          conversationalPreviews = 0
          sentences.started()
          show('hearing')
        } else if (heard?.kind === 'dropped') {
          sentences.dropped()
        } else if (heard?.kind === 'utterance') {
          previewUtterance += 1
          sentences.ended(heard.endedAt)
          const mine = generation
          queue = queue.then(() => {
            if (stopped || mine !== generation) return
            return window.threadlight
              .transcribe(heard.audio)
              .catch(() => {
                if (!stopped && mine === generation) {
                  failed = true
                  live?.stop()
                  setLivePhase('error')
                  setLiveError(
                    'Part of the opening speech could not be transcribed. No opening message was sent; reopen the mic to try again.',
                  )
                  latest.current.onConversation?.()
                  latest.current.onStop?.()
                }
                return ''
              })
              .then((text) => {
                if (!stopped && mine === generation) {
                  sentences.heard(text)
                  if (
                    routing.mode === 'undecided' &&
                    routing.preview(sentences.text, latest.current.threads)
                  )
                    prepare()
                }
              })
          })
        }
        // Previews can warm up Live but never enter the final transcript or execute commands.
        if (
          routing.mode === 'undecided' &&
          !live &&
          !previewPending &&
          segmenter.now - lastPreview >= 2000
        ) {
          const audio = segmenter.preview()
          if (audio) {
            lastPreview = segmenter.now
            previewPending = true
            const mine = previewUtterance
            queue = queue.then(() => {
              if (stopped || mine !== previewUtterance) {
                previewPending = false
                return
              }
              return window.threadlight
                .transcribe(audio)
                .then((text) => {
                  if (stopped || mine !== previewUtterance || routing.mode !== 'undecided') return
                  const conversational = routing.preview(
                    [sentences.text, text].filter(Boolean).join(' '),
                    latest.current.threads,
                  )
                  conversationalPreviews = conversational ? conversationalPreviews + 1 : 0
                  if (conversationalPreviews >= 2) prepare()
                })
                .catch(() => {})
                .finally(() => {
                  previewPending = false
                })
            })
          }
        }
        const sentence = sentences.take(segmenter.now)
        if (sentence !== null && !stopped) {
          const route = routing.route(sentence, latest.current.threads)
          setMode(routing.mode)
          if (route.kind === 'agent' && nativeLive) {
            opening.push(route.text)
            if (opening.join(' ').length > 32_000) {
              failed = true
              live?.stop()
              setLivePhase('error')
              setLiveError('The opening message is too long. Keep a copy and reopen the mic.')
              stream.getTracks().forEach((track) => track.stop())
            }
            setOpeningDraft(opening.join(' '))
            prepare()
          } else {
            if (route.kind === 'agent') latest.current.onConversation?.()
            if (live) {
              live.stop()
              live = null
              setLivePhase('off')
            }
            failed = false
            setLiveError(null)
            latest.current.onSentence(route)
          }
        }
        if (!failed && live?.connected && opening.length && sentences.quiet(segmenter.now)) {
          committed = true
          void live.open(opening.join(' '))
        }
        if (failed && opening.length && sentences.quiet(segmenter.now)) latest.current.onStop?.()
        if (heard?.kind === 'dropped' || sentence !== null) show('listening')
      }
      release = () => {
        generation += 1
        previewUtterance += 1
        live?.stop()
        outgoing.stream.getTracks().forEach((track) => track.stop())
        level.current = 0
        energy.current = SILENT_AUDIO
        outputEnergy.current = SILENT_AUDIO
        meter.dispose()
        processor.onaudioprocess = null
        stream.getTracks().forEach((track) => track.stop()) // the mic light goes off here
        void context.close()
        show('off')
      }
      await context.resume()
      if (stopped) {
        release()
        return
      }
      show('listening')
    })().catch(() => {
      release()
      if (!stopped) {
        show('blocked')
        setLiveError('The microphone audio could not start. Reopen the mic to try again.')
      }
    })
    return () => {
      stopped = true
      level.current = 0
      energy.current = SILENT_AUDIO
      outputEnergy.current = SILENT_AUDIO
      release()
    }
  }, [enabled, nativeLive])

  return {
    state: enabled ? state : 'off',
    mode: enabled ? mode : 'undecided',
    level,
    energy,
    outputEnergy,
    livePhase: enabled ? livePhase : 'off',
    liveError,
    openingDraft,
  }
}
