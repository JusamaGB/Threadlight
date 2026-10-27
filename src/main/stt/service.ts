// Owns the speech worker: starts it, tracks the model's status, and turns transcribe calls
// into request/response pairs.

import { join } from 'node:path'

import { utilityProcess, type UtilityProcess } from 'electron'

import { STT_SAMPLE_RATE, type FromWorker, type SttStatus, type ToWorker } from '../../shared/stt'

/** Longest clip accepted: matches the 90 s recording limit, with a little slack. */
const MAX_SAMPLES = STT_SAMPLE_RATE * 95

export class SttService {
  private worker: UtilityProcess | null = null
  private current: SttStatus = { state: 'loading' }
  private nextId = 1
  private pending = new Map<
    number,
    { resolve: (text: string) => void; reject: (e: Error) => void }
  >()

  constructor(
    private readonly cacheDir: string,
    private readonly onStatus: (status: SttStatus) => void,
  ) {}

  get status(): SttStatus {
    return this.current
  }

  /** Loads the model if it is already on disk; never downloads. */
  start(): void {
    this.load(false)
  }

  /** The user agreed to download the model. */
  download(): void {
    if (this.current.state === 'missing' || this.current.state === 'error') this.load(true)
  }

  transcribe(audio: Float32Array): Promise<string> {
    if (this.current.state !== 'ready' || !this.worker) {
      return Promise.reject(new Error('Voice is not ready yet.'))
    }
    if (audio.length === 0) return Promise.resolve('')
    if (audio.length > MAX_SAMPLES) return Promise.reject(new Error('That recording is too long.'))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.send({ type: 'transcribe', id, audio })
    })
  }

  stop(): void {
    this.worker?.kill()
    this.worker = null
  }

  private load(allowDownload: boolean): void {
    this.setStatus(allowDownload ? { state: 'downloading', progress: 0 } : { state: 'loading' })
    this.ensureWorker()
    this.send({ type: 'load', cacheDir: this.cacheDir, allowDownload })
  }

  private ensureWorker(): void {
    if (this.worker) return
    const worker = utilityProcess.fork(join(__dirname, 'stt-worker.js'), [], {
      serviceName: 'Threadlight speech',
    })
    worker.on('message', (message: FromWorker) => this.receive(message))
    worker.on('exit', () => {
      if (this.worker !== worker) return
      this.worker = null
      for (const { reject } of this.pending.values())
        reject(new Error('The speech worker stopped.'))
      this.pending.clear()
      this.setStatus({ state: 'error', message: 'The speech worker stopped.' })
    })
    this.worker = worker
  }

  private receive(message: FromWorker): void {
    switch (message.type) {
      case 'progress':
        if (this.current.state === 'downloading') {
          this.setStatus({ state: 'downloading', progress: message.progress })
        }
        break
      case 'ready':
        this.setStatus({ state: 'ready' })
        break
      case 'missing':
        this.setStatus({ state: 'missing' })
        break
      case 'load-error':
        this.setStatus({ state: 'error', message: message.message })
        break
      case 'result':
      case 'failed': {
        const request = this.pending.get(message.id)
        this.pending.delete(message.id)
        if (message.type === 'result') request?.resolve(message.text)
        else request?.reject(new Error(message.message))
        break
      }
    }
  }

  private send(message: ToWorker): void {
    this.worker?.postMessage(message)
  }

  private setStatus(status: SttStatus): void {
    this.current = status
    this.onStatus(status)
  }
}
