import { useCallback, useEffect, useRef, useState } from 'react'

import { STT_SAMPLE_RATE } from '../../shared/stt'

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
  const recording = useRef<Recording | null>(null)
  const limit = useRef(onLimit)
  useEffect(() => {
    limit.current = onLimit
  }, [onLimit])

  const release = useCallback(() => {
    const current = recording.current
    recording.current = null
    if (!current) return
    window.clearInterval(current.levelTimer)
    window.clearTimeout(current.limitTimer)
    current.stream.getTracks().forEach((track) => track.stop()) // the mic light goes off here
    void current.context.close()
    setLevel(0)
  }, [])

  const start = useCallback(async () => {
    if (recording.current) return
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    })
    const context = new AudioContext()
    const analyser = context.createAnalyser()
    analyser.fftSize = 512
    context.createMediaStreamSource(stream).connect(analyser)
    const samples = new Float32Array(analyser.fftSize)
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
        analyser.getFloatTimeDomainData(samples)
        let sum = 0
        for (const s of samples) sum += s * s
        setLevel(Math.min(1, Math.sqrt(sum / samples.length) * 8))
      }, LEVEL_INTERVAL_MS),
      limitTimer: window.setTimeout(() => limit.current(), MAX_RECORD_MS),
    }
    setState('listening')
  }, [])

  /** Stops recording and transcribes it. Resolves to '' when nothing was said. */
  const stop = useCallback(async (): Promise<string> => {
    const current = recording.current
    if (!current) return ''
    const stopped = new Promise<void>((resolve) => (current.recorder.onstop = () => resolve()))
    current.recorder.stop()
    await stopped
    release()
    setState('transcribing')
    try {
      const audio = await decodeTo16k(new Blob(current.chunks, { type: current.recorder.mimeType }))
      return await window.threadlight.transcribe(audio)
    } finally {
      setState('idle')
    }
  }, [release])

  const cancel = useCallback(() => {
    recording.current?.recorder.stop()
    release()
    setState('idle')
  }, [release])

  useEffect(() => release, [release])

  return { state, level, start, stop, cancel }
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
