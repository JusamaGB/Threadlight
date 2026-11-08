import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createInterface } from 'node:readline'
import { foregroundApp, foregroundWindowId, type ForegroundApp } from './keyState'
import { windowsPowerShell } from './sessions/paths'

export interface ScreenImage {
  jpeg: string
  thumbnail: string
  application?: string
}
export interface RegionRequest {
  id: string
  image: ScreenImage
}
export interface WindowObservation {
  application: string
  title: string
  observedAt: number
  jpeg?: string
}

/** One helper and one local focus observation per Live conversation. */
export class LiveScreen {
  private id: string | null = null
  private closed = false
  private capture = false
  private child?: ChildProcessWithoutNullStreams
  private spoken?: { window: ForegroundApp | null; at: number }
  private lastVoice = 0
  private inspections = new Map<string, (image?: string) => void>()
  constructor(
    private script: string,
    private onCrop: (id: string | null, image: ScreenImage) => void,
    private onError: (id: string | null, reason: string) => void,
    private readWindow = foregroundApp,
    private currentHandle = foregroundWindowId,
  ) {}
  sync(id: string | null, modes: readonly ('live' | 'outside')[] = ['live']) {
    if (this.closed) return
    const capture = modes.includes(id ? 'live' : 'outside')
    if (id === this.id && capture === this.capture) return
    this.capture = capture
    const previous = this.child
    this.child = undefined
    this.id = id
    this.spoken = undefined
    this.lastVoice = 0
    for (const finish of this.inspections.values()) finish()
    previous?.kill()
    if (!id && !capture) return
    const child = spawn(
      windowsPowerShell(),
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        this.script,
        ...(capture ? [] : ['-InspectOnly']),
      ],
      { windowsHide: true, stdio: 'pipe' },
    )
    this.child = child
    child.stderr.resume()
    child.stdin.on('error', () => {})
    let reported = false
    const failed = () => {
      if (this.child !== child || reported) return
      reported = true
      this.onError(
        id,
        'Screen selection is unavailable. Toggle Screen regions in Settings to reconnect.',
      )
    }
    child.once('error', failed)
    child.once('exit', failed)
    createInterface({ input: child.stdout }).on('line', (line) => {
      if (this.child !== child || this.id !== id) return
      if (line.startsWith('error ')) {
        this.onError(id, line.slice(6))
        return
      }
      const [type, jpeg, thumbnail, encodedApp] = line.split(' ')
      if (!type || type === 'ready') return
      const valid = typeof jpeg === 'string' && jpeg.startsWith('/9j/') && jpeg.length <= 4_000_000
      if (type === 'crop' && capture) {
        if (valid && thumbnail?.startsWith('/9j/') && thumbnail.length <= 100_000)
          this.onCrop(id, {
            jpeg,
            thumbnail,
            ...(encodedApp && encodedApp.length < 1024
              ? { application: Buffer.from(encodedApp, 'base64').toString('utf8') }
              : {}),
          })
        else this.onError(id, 'The region could not be captured. Try a smaller selection.')
      } else this.inspections.get(type)?.(valid ? jpeg : undefined)
    })
  }
  close() {
    this.sync(null)
    this.closed = true
  }
  voice(level: number) {
    if (!this.id || level < 0.012) return
    const now = Date.now()
    if (
      now - this.lastVoice > 700 ||
      this.currentHandle()?.toString() !== this.spoken?.window?.handle
    )
      this.spoken = { window: this.readWindow(), at: now }
    this.lastVoice = now
  }
  async observe(id: string, inspect: boolean): Promise<WindowObservation | null> {
    if (this.id !== id) return null
    const observation = this.spoken ?? { window: this.readWindow(), at: Date.now() }
    const target = observation.window
    if (!target) return null
    const result = {
      application: target.executable || '(unknown application)',
      title: target.title,
      observedAt: observation.at,
    }
    if (!inspect) return result
    const child = this.child
    if (!child || child.exitCode !== null || !child.stdin.writable) return null
    const key = randomUUID()
    const jpeg = await new Promise<string | undefined>((resolve) => {
      const finish = (value?: string) => {
        clearTimeout(timer)
        this.inspections.delete(key)
        resolve(value)
      }
      const timer = setTimeout(finish, 4500)
      this.inspections.set(key, finish)
      child.stdin.write(`inspect ${key} ${target.handle} ${target.pid}\n`)
    })
    return this.id === id && jpeg ? { ...result, jpeg } : null
  }
}
