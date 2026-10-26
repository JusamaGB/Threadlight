import { createHash } from 'node:crypto'
import { isAbsolute, resolve, win32 } from 'node:path'
import type { ChangedFile, DiffLine, FileDiff, ThreadDiffSummary } from '../../shared/types'

const MAX_LINES = 50_000
type Token = { origin: number | null; text?: string }
type Operation = { type: 'context' | 'add' | 'remove'; text: string }
type Hunk = {
  start: number
  nextStart: number
  oldCount: number
  nextCount: number
  operations: Operation[]
}
export type RecordedChange = {
  path: string
  kind: 'add' | 'update' | 'delete' | 'unknown'
  diff?: string
  before?: string
  after?: string
  move?: string
}
type FileState = {
  path: string
  renamed: boolean
  initialized: boolean
  baselineExists: boolean
  exists: boolean
  sealed: boolean
  tail: number
  original: Map<number, string>
  current: Token[]
  events: DiffLine[][]
  partial: boolean
  eofChanged: boolean
  baselineNewline?: boolean
}
export interface RecordedFile {
  absolute: string
  file: ChangedFile
  diff: FileDiff
}
export interface ThreadDiffData {
  summary: ThreadDiffSummary
  files: RecordedFile[]
}
export const textLines = (text: string): string[] => {
  if (!text) return []
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  if (lines.at(-1) === '') lines.pop()
  if (lines.length > MAX_LINES) throw Error('Recorded line limit')
  return lines
}
export function recordedPath(path: string, cwd: string): string | null {
  if (
    !path ||
    path.length > 4096 ||
    path.includes('\0') ||
    (/^[a-z][a-z\d+.-]*:/i.test(path) && !/^[a-z]:[\\/]/i.test(path))
  )
    return null
  const absolute =
    win32.isAbsolute(path) || isAbsolute(path)
      ? path
      : cwd && win32.isAbsolute(cwd)
        ? win32.resolve(cwd, path)
        : cwd && isAbsolute(cwd)
          ? resolve(cwd, path)
          : null
  return (
    (absolute && win32.isAbsolute(absolute) ? win32.normalize(absolute) : absolute)
      ?.replace(/\\/g, '/')
      .replace(/^\/\/\?\/UNC\//i, '//')
      .replace(/^\/\/\?\/(?=[a-z]:\/)/i, '') ?? null
  )
}
const pathKey = (path: string) => path.replace(/\\/g, '/').toLowerCase()

/** A bounded LCS, preserving unchanged lines. Large replacements use a coarse, content-exact diff. */
function sequenceDiff(old: string[], next: string[]): Operation[] {
  let prefix = 0,
    suffix = 0
  while (prefix < old.length && prefix < next.length && old[prefix] === next[prefix]) prefix++
  while (
    suffix < old.length - prefix &&
    suffix < next.length - prefix &&
    old.at(-1 - suffix) === next.at(-1 - suffix)
  )
    suffix++
  const a = old.slice(prefix, old.length - suffix),
    b = next.slice(prefix, next.length - suffix)
  const result: Operation[] = old.slice(0, prefix).map((text) => ({ type: 'context', text }))
  if (a.length * b.length > 1_000_000) {
    result.push(
      ...a.map((text) => ({ type: 'remove' as const, text })),
      ...b.map((text) => ({ type: 'add' as const, text })),
    )
  } else {
    const columns = b.length + 1
    const table = new Uint32Array((a.length + 1) * columns)
    for (let i = a.length - 1; i >= 0; i--)
      for (let j = b.length - 1; j >= 0; j--)
        table[i * columns + j] =
          a[i] === b[j]
            ? table[(i + 1) * columns + j + 1]! + 1
            : Math.max(table[(i + 1) * columns + j]!, table[i * columns + j + 1]!)
    let i = 0,
      j = 0
    while (i < a.length || j < b.length) {
      if (i < a.length && j < b.length && a[i] === b[j]) {
        result.push({ type: 'context', text: a[i++]! })
        j++
      } else if (
        i < a.length &&
        (j === b.length || table[(i + 1) * columns + j]! >= table[i * columns + j + 1]!)
      )
        result.push({ type: 'remove', text: a[i++]! })
      else result.push({ type: 'add', text: b[j++]! })
    }
  }
  result.push(...old.slice(old.length - suffix).map((text) => ({ type: 'context' as const, text })))
  return result
}
function hunks(diff: string): Hunk[] {
  const result: Hunk[] = []
  let hunk: Hunk | null = null
  let count = 0
  for (const line of diff.replace(/\r\n/g, '\n').split('\n')) {
    const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line)
    if (match) {
      hunk = {
        start: Number(match[1]),
        nextStart: Number(match[3]),
        oldCount: Number(match[2] ?? 1),
        nextCount: Number(match[4] ?? 1),
        operations: [],
      }
      result.push(hunk)
    } else if (hunk && [' ', '+', '-'].includes(line[0] ?? '')) {
      if (++count > MAX_LINES) throw Error('Recorded line limit')
      hunk.operations.push({
        type: line[0] === '+' ? 'add' : line[0] === '-' ? 'remove' : 'context',
        text: line.slice(1),
      })
    }
  }
  if (
    !result.length ||
    result.some(
      (h) =>
        h.operations.filter((o) => o.type !== 'add').length !== h.oldCount ||
        h.operations.filter((o) => o.type !== 'remove').length !== h.nextCount,
    )
  )
    throw Error('Incomplete patch')
  return result
}
function numbered(operations: Operation[], oldStart = 1, newStart = 1): DiffLine[] {
  let old = oldStart,
    next = newStart
  return operations.map((operation) => ({
    ...operation,
    oldLine: operation.type === 'add' ? undefined : old++,
    newLine: operation.type === 'remove' ? undefined : next++,
  }))
}
function contextWindows(lines: (DiffLine | null)[]): DiffLine[] {
  const keep = new Set<number>()
  for (let i = 0; i < lines.length; i++)
    if (lines[i] && lines[i]!.type !== 'context')
      for (let j = Math.max(0, i - 3); j <= Math.min(lines.length - 1, i + 3); j++)
        if (lines[j]) keep.add(j)
  const result: DiffLine[] = []
  let previous = -2
  for (const index of [...keep].sort((a, b) => a - b)) {
    if (index !== previous + 1) result.push({ type: 'hunk', text: 'Recorded thread changes' })
    result.push(lines[index]!)
    previous = index
  }
  return result
}

/** Keeps only provider-recorded mutations. It never reads the edited file or consults Git. */
export class ThreadDiffLedger {
  private entries = new Map<string, FileState>()
  private bytes = 0
  complete = true

  record(change: RecordedChange): void {
    const key = pathKey(change.path)
    let file = this.entries.get(key)
    if (!file) {
      file = {
        path: change.path,
        renamed: false,
        initialized: false,
        baselineExists: change.kind !== 'add',
        exists: true,
        sealed: false,
        tail: 0,
        original: new Map(),
        current: [],
        events: [],
        partial: false,
        eofChanged: false,
      }
      this.entries.set(key, file)
    }
    let operations: Operation[] = []
    let patches: Hunk[] = []
    try {
      const size =
        (change.diff?.length ?? 0) + (change.before?.length ?? 0) + (change.after?.length ?? 0)
      if (
        size > 2 * 1024 * 1024 ||
        this.bytes + size > 8 * 1024 * 1024 ||
        this.entries.size > 2000
      ) {
        this.complete = false
        throw Error('Recorded edit limit')
      }
      this.bytes += size
      if (change.before !== undefined && change.after !== undefined)
        operations = sequenceDiff(textLines(change.before), textLines(change.after))
      else if (change.kind === 'update') {
        patches = change.move && !change.diff?.trim() ? [] : hunks(change.diff ?? '')
        operations = patches.flatMap((h) => h.operations)
      } else if (change.kind === 'add' || change.kind === 'delete')
        operations = textLines(change.diff ?? change.after ?? change.before ?? '').map((text) => ({
          type: change.kind === 'add' ? 'add' : 'remove',
          text,
        }))
      if (operations.length > MAX_LINES) throw Error('Recorded line limit')
      const event = patches.length
        ? patches.flatMap((hunk) => [
            { type: 'hunk' as const, text: 'Recorded patch' },
            ...numbered(hunk.operations, hunk.start || 1, hunk.nextStart || 1),
          ])
        : contextWindows(numbered(operations))
      file.events.push(
        change.kind === 'unknown' ? event.map(({ type, text }) => ({ type, text })) : event,
      )
      if (file.partial) return
      if (change.kind === 'unknown') throw Error('Unavailable edit')
      if (change.before !== undefined && change.after !== undefined) {
        const before = textLines(change.before)
        if (!file.initialized) this.initialize(file, before)
        if (
          file.current.length !== before.length ||
          file.current.some((token, index) => token.text !== before[index])
        )
          throw Error('Unrecorded intervening edit')
        const current: Token[] = []
        let index = 0
        for (const operation of operations) {
          if (operation.type === 'add') current.push({ origin: null, text: operation.text })
          else if (operation.type === 'remove') index++
          else current.push(file.current[index++]!)
        }
        file.current = current
        file.baselineNewline ??= change.before.endsWith('\n')
        file.eofChanged =
          file.baselineExists && file.baselineNewline !== change.after.endsWith('\n')
      } else if (change.kind === 'add') {
        if (file.initialized && file.exists) throw Error('Unrecorded overwrite')
        file.current = operations.map((o) => ({ origin: null, text: o.text }))
        file.sealed = true
      } else if (change.kind === 'delete') {
        const before = operations.map((o) => o.text)
        if (!file.initialized) this.initialize(file, before)
        if (
          file.current.length !== before.length ||
          file.current.some((token, index) => token.text !== before[index])
        )
          throw Error('Unrecorded intervening edit')
        file.current = []
        file.sealed = true
      } else {
        let shift = 0
        // Clone before applying: a malformed later hunk must not leave half an edit.
        file.current = file.current.map((token) => ({ ...token }))
        file.original = new Map(file.original)
        for (const patch of patches) {
          const start = patch.start - (patch.oldCount ? 1 : 0) + shift
          if (start < 0 || start + patch.oldCount > MAX_LINES) throw Error('Oversized patch')
          while (file.current.length < start + patch.oldCount) {
            if (file.sealed) throw Error('Missing preimage')
            file.current.push({ origin: ++file.tail })
          }
          let index = start
          const replacement: Token[] = []
          for (const operation of patch.operations) {
            if (operation.type === 'add') replacement.push({ origin: null, text: operation.text })
            else {
              const token = file.current[index++]!
              if (token.text !== undefined && token.text !== operation.text)
                throw Error('Unrecorded intervening edit')
              token.text = operation.text
              if (token.origin !== null) file.original.set(token.origin, operation.text)
              if (operation.type === 'context') replacement.push(token)
            }
          }
          file.current.splice(start, patch.oldCount, ...replacement)
          shift += patch.nextCount - patch.oldCount
        }
      }
      file.initialized = true
      file.exists = change.kind !== 'delete'
      if (change.kind === 'update' && change.diff?.includes('\\ No newline at end of file')) {
        const source = change.diff.replace(/\r\n/g, '\n').split('\n')
        let oldMissing = false,
          nextMissing = false
        for (let i = 1; i < source.length; i++)
          if (source[i] === '\\ No newline at end of file') {
            if (source[i - 1]?.startsWith('-')) oldMissing = true
            else if (source[i - 1]?.startsWith('+')) nextMissing = true
            else oldMissing = nextMissing = true
          }
        file.baselineNewline ??= !oldMissing
        file.eofChanged = file.baselineExists && file.baselineNewline !== !nextMissing
      }
    } catch {
      file.partial = true
    } finally {
      if (change.move && change.move !== file.path) {
        const destination = this.entries.get(pathKey(change.move))
        if (destination && destination !== file) {
          file.events.unshift(...destination.events)
          file.partial = true
          this.complete = false
        }
        this.entries.delete(key)
        file.path = change.move
        file.renamed = true
        this.entries.set(pathKey(change.move), file)
      }
    }
  }

  private initialize(file: FileState, before: string[]) {
    if (before.length > MAX_LINES) throw Error('Oversized preimage')
    file.current = before.map((text, index) => ({ origin: index + 1, text }))
    file.original = new Map(before.map((text, index) => [index + 1, text]))
    file.tail = before.length
    file.sealed = true
    file.initialized = true
  }

  data(root: string | null = null): ThreadDiffData {
    const files: RecordedFile[] = []
    let complete = this.complete
    for (const file of this.entries.values()) {
      let lines: DiffLine[]
      if (file.partial) {
        complete = false
        lines = file.events
          .filter((event) => event.some((line) => line.type === 'add' || line.type === 'remove'))
          .flatMap((event, index) => [
            {
              type: 'hunk' as const,
              text: `Recorded edit ${index + 1} · history could not be combined`,
            },
            ...event,
          ])
      } else {
        const aligned: (DiffLine | null)[] = []
        let original = 1,
          next = 1
        let adds: string[] = []
        const flush = (end: number) => {
          const old: string[] = []
          for (let i = original; i < end; i++) old.push(file.original.get(i) ?? '')
          const operations = sequenceDiff(old, adds)
          aligned.push(...numbered(operations, original, next))
          original = end
          next += adds.length
          adds = []
        }
        for (const token of file.current) {
          if (token.origin === null) adds.push(token.text ?? '')
          else {
            flush(token.origin)
            aligned.push(
              token.text === undefined
                ? null
                : { type: 'context', text: token.text, oldLine: token.origin, newLine: next },
            )
            original = token.origin + 1
            next++
          }
        }
        flush(file.tail + 1)
        lines = contextWindows(aligned)
        if (file.eofChanged && !lines.length)
          lines.push({ type: 'hunk', text: 'Final newline changed' })
      }
      const added = lines.filter((line) => line.type === 'add').length
      const removed = lines.filter((line) => line.type === 'remove').length
      if (
        !file.partial &&
        !added &&
        !removed &&
        file.exists === file.baselineExists &&
        !file.renamed &&
        !file.eofChanged
      )
        continue
      if (file.renamed) lines.unshift({ type: 'hunk', text: 'File renamed by this thread' })
      const prefix = root ? root.replace(/\\/g, '/').replace(/\/+$/, '') + '/' : ''
      const path =
        prefix && pathKey(file.path).startsWith(pathKey(prefix))
          ? file.path.slice(prefix.length)
          : file.path
      files.push({
        absolute: file.path,
        file: {
          path,
          added,
          removed,
          status: !file.baselineExists ? 'added' : !file.exists ? 'deleted' : 'modified',
          binary: false,
        },
        diff:
          !lines.length && file.partial
            ? { kind: 'unavailable' }
            : lines.length > 1500
              ? { kind: 'too-big', lines: lines.length }
              : { kind: 'text', lines },
      })
    }
    files.sort((a, b) => a.file.path.localeCompare(b.file.path))
    const revision = createHash('sha256')
      .update(JSON.stringify({ complete, files }))
      .digest('hex')
      .slice(0, 16)
    return {
      files,
      summary: {
        files: files.length,
        added: files.reduce((n, f) => n + f.file.added, 0),
        removed: files.reduce((n, f) => n + f.file.removed, 0),
        complete,
        revision,
      },
    }
  }
}
