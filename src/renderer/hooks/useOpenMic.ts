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

const FRAME = 512
export type OpenMicState = 'off' | 'listening' | 'hearing' | 'blocked'
interface OpenMicOptions {
  enabled: boolean
  paused: boolean
  /** The explicit GPT Live choice; never inferred from the selected Agent provider. */
  nativeLive: boolean
  threads: Candidate[]
  onSentence: (route: MicRoute) => void
  onConversation?: () => void
  onStop?: () => void
}

/** One microphone owner, with mutually exclusive local transcription and native audio paths. */
export function useOpenMic({
  enabled,
  paused,
  nativeLive,
  threads,
  onSentence,
  onConversation,
  onStop,
}: OpenMicOptions) {
  const [state, setState] = useState<OpenMicState>('off')
  const [mode, setMode] = useState<MicSessionMode>('undecided')
  const [livePhase, setLivePhase] = useState<LiveVoicePhase>('off')
  const [liveError, setLiveError] = useState<string | null>(null)
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
    let release = () => {}
    const show = (next: OpenMicState) => {
      document.documentElement.dataset.openMic = next
      if (!stopped || next === 'off') setState(next)
    }
    void (async () => {
      setMode(nativeLive ? 'agent' : 'undecided')
      setLivePhase(nativeLive ? 'connecting' : 'off')
      setLiveError(null)
      if (nativeLive) latest.current.onConversation?.()
      const context = new AudioContext({ sampleRate: STT_SAMPLE_RATE })
      let stream: MediaStream | undefined
      let live: LiveVoiceConnection | null = null
      let outgoing: MediaStreamAudioDestinationNode | undefined
      const resources: { meter?: AudioEnergyMeter; processor?: ScriptProcessorNode } = {}
      let generation = 0
      let released = false
      release = () => {
        if (released) return
        released = true
        generation++
        live?.stop()
        outgoing?.stream.getTracks().forEach((track) => track.stop())
        if (resources.processor) resources.processor.onaudioprocess = null
        resources.meter?.dispose()
        level.current = 0
        energy.current = SILENT_AUDIO
        outputEnergy.current = SILENT_AUDIO
        stream?.getTracks().forEach((track) => track.stop())
        void context.close()
        show('off')
      }
      // Negotiate with a silent outgoing track while the OS opens the microphone.
      // No connection exists until this hotkey-owned effect is enabled.
      let connecting: Promise<void> | undefined
      if (nativeLive) {
        outgoing = context.createMediaStreamDestination()
        live = new LiveVoiceConnection(
          outgoing.stream,
          context.sampleRate,
          (phase, error) => {
            if (stopped) return
            setLivePhase(phase)
            if (error) setLiveError(error)
            if (phase === 'off' || error) latest.current.onStop?.()
          },
          context,
        )
        connecting = live.start({ bufferAudio: true })
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: false,
          },
        })
      } catch {
        release()
        if (!stopped) show('blocked')
        return
      }
      if (stopped || released) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      const source = context.createMediaStreamSource(stream)
      const meter = (resources.meter = new AudioEnergyMeter(source, context))
      const processor = (resources.processor = context.createScriptProcessor(FRAME, 1, 1))
      const mute = context.createGain()
      mute.gain.value = 0
      source.connect(processor)
      processor.connect(mute)
      mute.connect(context.destination)
      if (outgoing) processor.connect(outgoing)
      // GPT Live never enters this local transcription pipeline, even for its first sentence.
      const segmenter = nativeLive ? null : new Segmenter(context.sampleRate)
      const sentences = new SentenceAssembler()
      const routing = new MicSessionRouter()
      let queue = Promise.resolve()
      processor.onaudioprocess = (event) => {
        const output = event.outputBuffer.getChannelData(0)
        output.fill(0)
        live?.setPaused(latest.current.paused)
        if (latest.current.paused) {
          level.current = 0
          energy.current = SILENT_AUDIO
          outputEnergy.current = SILENT_AUDIO
          segmenter?.drop()
          sentences.reset()
          generation++
          return
        }
        const frame = new Float32Array(event.inputBuffer.getChannelData(0))
        let sum = 0
        for (const sample of frame) sum += sample * sample
        level.current = Math.min(1, Math.sqrt(sum / frame.length) * 8)
        energy.current = meter.read()
        outputEnergy.current = live?.outputEnergy ?? SILENT_AUDIO
        if (live) {
          live.process(frame, output)
          show(level.current > 0.1 ? 'hearing' : 'listening')
          return
        }
        if (!segmenter) return
        const heard = segmenter.feed(frame)
        if (heard?.kind === 'start') {
          sentences.started()
          show('hearing')
        } else if (heard?.kind === 'dropped') {
          sentences.dropped()
          show('listening')
        } else if (heard?.kind === 'utterance') {
          sentences.ended(heard.endedAt)
          const mine = generation
          queue = queue.then(async () => {
            if (stopped || mine !== generation) return
            try {
              const text = await window.threadlight.transcribe(heard.audio)
              if (!stopped && mine === generation) sentences.heard(text)
            } catch {
              if (!stopped && mine === generation) {
                setLiveError('Speech could not be transcribed. Reopen the mic to try again.')
                latest.current.onConversation?.()
                latest.current.onStop?.()
              }
            }
          })
        }
        const sentence = sentences.take(segmenter.now)
        if (sentence !== null && !stopped) {
          const route = routing.route(sentence, latest.current.threads)
          setMode(routing.mode)
          if (route.kind === 'agent') latest.current.onConversation?.()
          latest.current.onSentence(route)
          show('listening')
        }
      }
      await context.resume()
      if (stopped) {
        release()
        return
      }
      if (live) {
        show('listening')
        await connecting
        if (stopped) return
        if (live.active) show('listening')
      } else show('listening')
    })().catch(() => {
      release()
      if (!stopped) {
        show('blocked')
        setLiveError('The microphone audio could not start. Reopen the mic to try again.')
      }
    })
    return () => {
      stopped = true
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
    openingDraft: '',
  }
}
