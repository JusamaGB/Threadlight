// Runs in its own Electron utility process: loads Whisper once, then transcribes audio clips.
// Kept apart from the main process so a slow load or transcription never freezes the app.

import { collapseRepeats } from '../../shared/speechText'
import {
  STT_DTYPE,
  STT_MODEL,
  STT_SAMPLE_RATE,
  type FromWorker,
  type ToWorker,
} from '../../shared/stt'

type Transcriber = (
  audio: Float32Array,
  options?: { chunk_length_s?: number; stride_length_s?: number },
) => Promise<{ text: string } | Array<{ text: string }>>

/** Whisper hears 30 s at a time; anything longer goes in overlapping 30 s chunks. */
const CHUNK_S = 30

let transcriber: Transcriber | null = null

const post = (message: FromWorker) => process.parentPort.postMessage(message)

process.parentPort.on('message', (event) => {
  const message = event.data as ToWorker
  if (message.type === 'load') void load(message.cacheDir, message.allowDownload)
  else if (message.type === 'transcribe') void transcribe(message.id, message.audio)
})

async function load(cacheDir: string, allowDownload: boolean): Promise<void> {
  try {
    const { pipeline, env } = await import('@huggingface/transformers')
    env.cacheDir = cacheDir
    // Without the user's go-ahead, only a model that is already on disk may be used.
    env.allowRemoteModels = allowDownload
    const files = new Map<string, { loaded: number; total: number }>()
    const pipe = await pipeline('automatic-speech-recognition', STT_MODEL, {
      dtype: STT_DTYPE,
      device: 'cpu',
      progress_callback: (info: {
        status: string
        file?: string
        loaded?: number
        total?: number
      }) => {
        if (info.status !== 'progress' || !info.file) return
        files.set(info.file, { loaded: info.loaded ?? 0, total: info.total ?? 0 })
        const totals = [...files.values()].reduce(
          (sum, f) => ({ loaded: sum.loaded + f.loaded, total: sum.total + f.total }),
          { loaded: 0, total: 0 },
        )
        if (totals.total > 0) post({ type: 'progress', progress: totals.loaded / totals.total })
      },
    })
    transcriber = pipe as unknown as Transcriber
    post({ type: 'ready' })
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error)
    // transformers.js reports a missing local model as a failed (disallowed) fetch.
    if (!allowDownload) post({ type: 'missing' })
    else post({ type: 'load-error', message: text })
  }
}

async function transcribe(id: number, audio: Float32Array): Promise<void> {
  if (!transcriber) return post({ type: 'failed', id, message: 'The speech model is not loaded.' })
  try {
    const long = audio.length > CHUNK_S * STT_SAMPLE_RATE
    const output = await transcriber(
      audio,
      long ? { chunk_length_s: CHUNK_S, stride_length_s: 5 } : undefined,
    )
    const text = (Array.isArray(output) ? output.map((o) => o.text).join(' ') : output.text).trim()
    post({ type: 'result', id, text: collapseRepeats(text) })
  } catch (error) {
    post({ type: 'failed', id, message: error instanceof Error ? error.message : String(error) })
  }
}
