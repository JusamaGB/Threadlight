import { useCallback, useEffect, useRef, useState } from 'react'

import { STT_SAMPLE_RATE } from '../../shared/stt'
import { SILENT_AUDIO, type AudioEnergy } from '../../shared/motion'
import { AudioEnergyMeter } from '../lib/audioEnergy'

export type VoiceState = 'idle' | 'listening' | 'transcribing'

/** Recording stops by itself after this long. */
export const MAX_RECORD_MS = 90_000
const LEVEL_INTERVAL_MS = 50

interface Recording {
  stream: MediaStream
  recorder: MediaRecorder
  chunks: Blob[]
  context: AudioContext
  levelTimer: number
  limitTimer: number
}

/**
 * Push-to-talk recording. The microphone is open only between start() and stop()/cancel().
 * stop() returns the transcript. Levels are sampled on a timer rather than per animation frame,
 * so recording also works while the panel window is hidden (for the talk hotkey).
 */
export function useVoice(onLimit: () => void) {
  const [state, setState] = useState<VoiceState>('idle')
  const [level, setLevel] = useState(0)
  const energy = useRef<AudioEnergy>(SILENT_AUDIO)
  const recording = useRef<Recording | null>(null)
  const generation = useRef(0)
  const acquiring = useRef<number | null>(null)
  const transcribing = useRef<number | null>(null)
  const limit = useRef(onLimit)
  useEffect(() => {
    limit.current = onLimit
  }, [onLimit])

  const release = useCallback((current = recording.current) => {
    if (recording.current === current) recording.current = null
    if (!current) return
    window.clearInterval(current.levelTimer)
    window.clearTimeout(current.limitTimer)
    current.stream.getTracks().forEach((track) => track.stop()) // the mic light goes off here
    void current.context.close()
    energy.current = SILENT_AUDIO
    setLevel(0)
  }, [])

  const start = useCallback(async () => {
    if (recording.current || acquiring.current || transcribing.current) return
    const mine = ++generation.current
    acquiring.current = mine
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
    } finally {
      acquiring.current = null
    }
    if (mine !== generation.current) {
      stream.getTracks().forEach((track) => track.stop())
      return
    }
    const context = new AudioContext()
    const meter = new AudioEnergyMeter(context.createMediaStreamSource(stream), context)
    const recorder = new MediaRecorder(stream)
    const chunks: Blob[] = []
    recorder.ondataavailable = (event) => event.data.size && chunks.push(event.data)
    recorder.start(250)
    recording.current = {
      stream,
      recorder,
      chunks,
      context,
      levelTimer: window.setInterval(() => {
        energy.current = meter.read()
        setLevel(energy.current.level)
      }, LEVEL_INTERVAL_MS),
      limitTimer: window.setTimeout(() => limit.current(), MAX_RECORD_MS),
    }
    setState('listening')
  }, [])

  /** Stops recording and transcribes it. Resolves to '' when nothing was said. */
  const stop = useCallback(async (): Promise<string> => {
    const current = recording.current
    if (!current || transcribing.current) return ''
    const mine = generation.current
    transcribing.current = mine
    const stopped = new Promise<void>((resolve) => (current.recorder.onstop = () => resolve()))
    current.recorder.stop()
    await stopped
    release(current)
    if (mine !== generation.current) {
      transcribing.current = null
      return ''
    }
    setState('transcribing')
    try {
      const audio = await decodeTo16k(new Blob(current.chunks, { type: current.recorder.mimeType }))
      if (mine !== generation.current) return ''
      const text = await window.threadlight.transcribe(audio)
      return mine === generation.current ? text : ''
    } finally {
      transcribing.current = null
      if (mine === generation.current) setState('idle')
    }
  }, [release])

  const cancel = useCallback(() => {
    generation.current++
    if (recording.current?.recorder.state !== 'inactive') recording.current?.recorder.stop()
    release()
    setState('idle')
  }, [release])

  useEffect(
    () => () => {
      generation.current++
      release()
    },
    [release],
  )

  const isCapturing = useCallback(
    () =>
      acquiring.current === generation.current ||
      !!recording.current ||
      transcribing.current === generation.current,
    [],
  )
  return { state, level, energy, start, stop, cancel, isCapturing }
}

/** Decodes the recording and resamples it to the 16 kHz mono Whisper expects. */
async function decodeTo16k(blob: Blob): Promise<Float32Array> {
  if (blob.size === 0) return new Float32Array(0)
  const context = new AudioContext({ sampleRate: STT_SAMPLE_RATE })
  try {
    const buffer = await context.decodeAudioData(await blob.arrayBuffer())
    return new Float32Array(buffer.getChannelData(0))
  } finally {
    void context.close()
  }
}
