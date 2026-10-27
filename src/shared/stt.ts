// Messages between the main process and the speech-to-text worker, plus the status the UI shows.

export const STT_MODEL = 'onnx-community/whisper-base.en'
/** 8-bit weights: about 76 MB, and fast enough on a typical CPU (≈1.7 s for a 5 s clip). */
export const STT_DTYPE = 'q8'
export const STT_DOWNLOAD_MB = 76
export const STT_SAMPLE_RATE = 16_000

/**
 * missing:     the model has not been downloaded (nothing is fetched without the user's go-ahead)
 * downloading: fetching it, with progress 0..1
 * loading:     reading it into memory (a few seconds, once per launch)
 */
export type SttStatus =
  | { state: 'missing' }
  | { state: 'downloading'; progress: number }
  | { state: 'loading' }
  | { state: 'ready' }
  | { state: 'error'; message: string }

export type ToWorker =
  | { type: 'load'; cacheDir: string; allowDownload: boolean }
  | { type: 'transcribe'; id: number; audio: Float32Array }

export type FromWorker =
  | { type: 'progress'; progress: number }
  | { type: 'ready' }
  | { type: 'missing' }
  | { type: 'load-error'; message: string }
  | { type: 'result'; id: number; text: string }
  | { type: 'failed'; id: number; message: string }
