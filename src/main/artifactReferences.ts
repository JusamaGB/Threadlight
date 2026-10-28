import { createHash } from 'node:crypto'
import { open, realpath } from 'node:fs/promises'
import { basename, extname, isAbsolute, relative, resolve, win32 } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ThreadArtifact } from '../shared/artifacts'
import { isObject } from './sessions/json'
import { contained } from './threadRead/files'

export interface ArtifactSource {
  provider: 'claude' | 'codex'
  transcript: string
  transcriptRoots: string[]
  cwd: string
  roots: string[]
}
export function referenceKind(path: string): ThreadArtifact['kind'] | null {
  const ext = extname(path).toLowerCase()
  if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) return 'image'
  if (['.html', '.htm'].includes(ext)) return 'html'
  if (
    [
      '.txt',
      '.md',
      '.json',
      '.csv',
      '.tsv',
      '.js',
      '.ts',
      '.tsx',
      '.jsx',
      '.css',
      '.py',
      '.yaml',
      '.yml',
      '.toml',
      '.xml',
      '.svg',
      '.log',
    ].includes(ext)
  )
    return 'text'
  if (['.pdf', '.docx', '.xlsx', '.pptx', '.mp4', '.webm', '.mp3', '.wav', '.zip'].includes(ext))
    return 'unsupported'
  return null
}

// Codex stores local workspaces as \\?\C:\… on Windows. Compare the ordinary
// drive spelling, without accepting device/UNC paths from transcript links.
function localDrivePath(path: string): string {
  return process.platform === 'win32' && /^\\\\\?\\[a-z]:\\/i.test(path) ? path.slice(4) : path
}

export function localArtifactPath(value: string, cwd: string): string | null {
  let path = value.trim().replace(/^<|>$/g, '')
  try {
    if (/^file:/i.test(path)) {
      const url = new URL(path)
      if (url.hostname) return null
      path = fileURLToPath(url)
    } else path = decodeURIComponent(path)
  } catch {
    return null
  }
  path = path.replace(/^\/([a-z]:[\\/])/i, '$1').replace(/:\d+(?::\d+)?$/, '')
  if (/^[a-z][\w+.-]*:/i.test(path) && !/^[a-z]:[\\/]/i.test(path)) return null
  if (
    /^[\\/]{2}/.test(path) ||
    [...path].some((char) => char.charCodeAt(0) < 32) ||
    path.slice(2).includes(':')
  )
    return null
  const result = /^[a-z]:[\\/]/i.test(path)
    ? win32.normalize(path)
    : resolve(localDrivePath(cwd), path)
  return referenceKind(result) ? result : null
}

/** Only visible user/assistant message bodies, never tool results or reasoning. */
export function presentedPaths(record: unknown, provider: ArtifactSource['provider']): string[] {
  if (!isObject(record)) return []
  let message = record
  if (provider === 'claude') {
    if (!['user', 'assistant'].includes(String(record.type)) || !isObject(record.message)) return []
    message = record.message
  } else {
    if (isObject(record.payload)) message = record.payload
    const type = String(message.type)
    if (!['userMessage', 'agentMessage', 'user_message', 'agent_message', 'message'].includes(type))
      return []
    if (type === 'message' && !['user', 'assistant'].includes(String(message.role))) return []
    if (typeof message.channel === 'string' && !['final', 'commentary'].includes(message.channel))
      return []
  }
  const user =
    message.role === 'user' ||
    ['userMessage', 'user_message'].includes(String(message.type)) ||
    record.type === 'user'
  const paths: string[] = []
  const text = (body: string) => {
    const visible = body.replace(/```[^\n]*\n[\s\S]*?```/g, '')
    const references: { index: number; path: string }[] = []
    for (const match of visible.matchAll(
      /!?\[[^\]\n]*\]\((<[^>\n]+>|[^()\n]*(?:\([^()\n]*\)[^()\n]*)*)\)/g,
    ))
      references.push({ index: match.index, path: match[1]!.replace(/\s+"[^"\n]*"$/, '') })
    // Codex presents inline HTML with a native marker rather than a Markdown link.
    // Extract only its explicit path; discovery still applies the usual local-file checks.
    if (provider === 'codex' && !user)
      for (const match of visible.matchAll(/\uE200visualize\uE202([^\uE200\uE201]*)\uE201/g)) {
        try {
          const value: unknown = JSON.parse(match[1]!)
          if (isObject(value) && typeof value.path === 'string')
            references.push({ index: match.index, path: value.path })
        } catch {
          // An incomplete or malformed marker must not hide other presented files.
        }
      }
    paths.push(...references.sort((a, b) => a.index - b.index).map((item) => item.path))
    if (user && body.includes('# Files mentioned by the user:')) {
      const envelope = body.split('## My request:')[0]!
      for (const match of envelope.matchAll(/^## [^\n]+?: ([^\r\n]+)$/gm)) paths.push(match[1]!)
    }
    if (user)
      for (const match of body.matchAll(/<image\b[^>]*\bpath="([^"]+)"/g)) paths.push(match[1]!)
  }
  for (const field of ['text', 'message', 'content']) {
    const value = message[field]
    if (typeof value === 'string') text(value)
    if (!Array.isArray(value)) continue
    for (const block of value) {
      if (!isObject(block)) continue
      if (
        ['text', 'input_text', 'output_text'].includes(String(block.type)) &&
        typeof block.text === 'string'
      )
        text(block.text)
      if (
        ['image', 'input_image', 'local_image', 'file', 'input_file', 'attachment'].includes(
          String(block.type),
        )
      ) {
        for (const key of ['path', 'file_path', 'image_url'])
          if (typeof block[key] === 'string') paths.push(block[key] as string)
        if (isObject(block.source) && typeof block.source.path === 'string')
          paths.push(block.source.path)
      }
    }
  }
  return paths
}

export function reference(threadId: string, path: string, createdAt = Date.now()): ThreadArtifact {
  const identity = process.platform === 'win32' ? path.toLowerCase() : path
  return {
    id: `ref-${createHash('sha256').update(`${threadId}\0${identity}`).digest('hex')}`,
    title: basename(path),
    kind: referenceKind(path) ?? 'unsupported',
    mime: '',
    createdAt,
    source: 'reference',
    path,
  }
}

function within(path: string, root: string) {
  const rel = relative(resolve(localDrivePath(root)), resolve(localDrivePath(path)))
  return (
    rel !== '' &&
    !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) &&
    rel !== '..' &&
    !isAbsolute(rel)
  )
}
export async function referenceAllowed(path: string, roots: string[]): Promise<boolean> {
  // Lexical check also preserves a missing-file entry so the viewer can explain it.
  if (!roots.some((root) => within(path, root))) return false
  try {
    const actual = await realpath(path)
    for (const root of roots) {
      const base = await realpath(root).catch(() => null)
      if (base && within(actual, base)) return true
    }
    return false
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT'
  }
}

interface ScanState {
  touched: number
  file: string
  identity: string
  offset: number
  size: number
  stamp: number
  pending: Buffer
  skipping: boolean
  items: Map<string, ThreadArtifact>
  warnings: boolean
  capped: boolean
}
const SCAN_BYTES = 2 * 1024 * 1024
const LINE_BYTES = 2 * 1024 * 1024
const MAX_REFERENCES = 200

export class ArtifactDiscovery {
  private states = new Map<string, ScanState>()
  private pending = new Map<string, Promise<{ items: ThreadArtifact[]; notice?: string }>>()
  private tail: Promise<unknown> = Promise.resolve()
  constructor(private readonly now = Date.now) {}
  lastKnown(id: string): ThreadArtifact[] {
    return [...(this.states.get(id)?.items.values() ?? [])].reverse()
  }
  scan(id: string, source: ArtifactSource) {
    const running = this.pending.get(id)
    if (running) return running
    const result = this.tail.then(() => this.update(id, source))
    this.tail = result.catch(() => {})
    this.pending.set(id, result)
    void result.finally(() => this.pending.delete(id)).catch(() => {})
    return result
  }
  private async update(id: string, source: ArtifactSource) {
    const path = await contained(source.transcript, source.transcriptRoots)
    const file = await open(path, 'r')
    try {
      const info = await file.stat()
      const identity = `${info.dev}:${info.ino}:${info.birthtimeMs}`
      let state = this.states.get(id)
      if (
        !state ||
        state.file !== path ||
        state.identity !== identity ||
        info.size < state.offset ||
        (info.size === state.size && info.mtimeMs !== state.stamp)
      ) {
        state = {
          touched: this.now(),
          file: path,
          identity,
          offset: 0,
          size: 0,
          stamp: 0,
          pending: Buffer.alloc(0),
          skipping: false,
          items: new Map(),
          warnings: false,
          capped: false,
        }
        this.states.set(id, state)
      }
      state.touched = this.now()
      // The panel warms hundreds of chats. The idle budget must not evict cursors
      // still being polled, or a finished catalog repeatedly replays from byte zero.
      if (this.states.size > 100)
        for (const [key, cached] of this.states) {
          if (this.states.size <= 100) break
          // A 300-row warm sweep alone takes at least 75 seconds (12 per 3s).
          if (key !== id && this.now() - cached.touched >= 300000 && !this.pending.has(key))
            this.states.delete(key)
        }
      const buffer = Buffer.alloc(Math.min(SCAN_BYTES, info.size - state.offset))
      const { bytesRead } = buffer.length
        ? await file.read(buffer, 0, buffer.length, state.offset)
        : { bytesRead: 0 }
      state.offset += bytesRead
      state.size = info.size
      state.stamp = info.mtimeMs
      let data: Buffer = Buffer.concat([state.pending, buffer.subarray(0, bytesRead)])
      let start = 0
      for (let end = data.indexOf(10); end !== -1; end = data.indexOf(10, start)) {
        if (!state.skipping && end - start <= LINE_BYTES) {
          const line = data.subarray(start, end).toString('utf8')
          if (line.trim()) {
            let raw: unknown
            try {
              raw = JSON.parse(line)
            } catch {
              state.warnings = true
            }
            for (const candidate of presentedPaths(raw, source.provider)) {
              const target = localArtifactPath(candidate, source.cwd)
              if (!target || !(await referenceAllowed(target, source.roots))) continue
              const item = reference(
                id,
                target,
                typeof (raw as { timestamp?: unknown })?.timestamp === 'string'
                  ? Date.parse((raw as { timestamp: string }).timestamp) || 0
                  : 0,
              )
              state.items.delete(item.id)
              state.items.set(item.id, item)
              if (state.items.size > MAX_REFERENCES) {
                state.items.delete(state.items.keys().next().value!)
                state.capped = true
              }
            }
          }
        } else state.warnings = true
        state.skipping = false
        start = end + 1
      }
      data = data.subarray(start)
      if (data.length > LINE_BYTES || state.skipping) {
        state.skipping = true
        state.pending = Buffer.alloc(0)
        state.warnings = true
      } else state.pending = Buffer.from(data)
      return {
        items: [...state.items.values()].reverse(),
        notice:
          state.offset < info.size
            ? 'Discovering files from earlier messages…'
            : state.warnings
              ? 'Some transcript records were too large or unreadable; showing the available file references.'
              : state.pending.length || state.skipping
                ? 'Waiting for an incomplete transcript record to finish…'
                : state.capped
                  ? 'Showing the 200 most recently presented files from this thread.'
                  : undefined,
      }
    } finally {
      await file.close()
    }
  }
}
