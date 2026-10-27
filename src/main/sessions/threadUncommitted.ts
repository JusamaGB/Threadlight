import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import type { DiffLine } from '../../shared/types'
import { inside, parseUnifiedDiff } from './gitChanges'
import type { ThreadDiffData, ThreadDiffLedger } from './threadDiff'
import { runGit as git } from './gitProcess'
import { gitPathKey } from './gitRepository'

type Patch = { lines: DiffLine[]; status: 'added' | 'deleted' | 'modified' }
type Snapshot = Map<string, Patch[]>

function pathHeader(header: string): string {
  const value = header.slice(4).split('\t')[0]!
  const path: string = value.startsWith('"') ? JSON.parse(value) : value
  return path === '/dev/null' ? path : path.slice(2)
}

function patches(text: string, snapshot: Snapshot): void {
  for (const section of text.split(/^diff --git /m).slice(1)) {
    // Headers end at the first hunk: added content can itself contain +++/---.
    const headers = section.split(/^@@/m)[0]!
    const before = headers.match(/^--- .*$/m)?.[0]
    const after = headers.match(/^\+\+\+ .*$/m)?.[0]
    if (!before || !after) continue
    const oldPath = pathHeader(before),
      newPath = pathHeader(after)
    const path = newPath === '/dev/null' ? oldPath : newPath
    const variants = snapshot.get(path) ?? []
    variants.push({
      lines: parseUnifiedDiff(section),
      status: oldPath === '/dev/null' ? 'added' : newPath === '/dev/null' ? 'deleted' : 'modified',
    })
    snapshot.set(path, variants)
  }
}

/** Shared across chats in the same worktree, but never across different worktrees. */
export class UncommittedThreads {
  private cache = new Map<
    string,
    { at: number; pending: boolean; value: Promise<Snapshot>; dirty: boolean }
  >()

  invalidate(root?: string) {
    for (const [key, entry] of this.cache)
      if (!root || key === gitPathKey(root)) {
        entry.dirty = true
        if (!entry.pending) this.cache.delete(key)
      }
  }

  private snapshot(root: string, now: number): Promise<Snapshot> {
    const key = gitPathKey(root)
    const cached = this.cache.get(key)
    if (cached?.pending && cached.dirty)
      return cached.value.catch(() => new Map() as Snapshot).then(() => this.snapshot(root, now))
    if (cached && (cached.pending || (!cached.dirty && now - cached.at < 1000))) return cached.value
    const entry = {
      at: now,
      pending: true,
      dirty: false,
      value: Promise.resolve(new Map() as Snapshot),
    }
    entry.value = this.load(root).finally(() => {
      entry.pending = false
      if (entry.dirty && this.cache.get(key) === entry) this.cache.delete(key)
    })
    this.cache.set(key, entry)
    if (this.cache.size > 128) {
      const old = [...this.cache].find(([other, value]) => other !== key && !value.pending)
      if (old) this.cache.delete(old[0])
    }
    return entry.value
  }

  private async load(root: string): Promise<Snapshot> {
    const results = await Promise.allSettled([
      git(root, ['diff', 'HEAD', '--no-color', '--no-ext-diff', '--no-renames', '-U0']),
      git(root, ['diff', '--cached', 'HEAD', '--no-color', '--no-ext-diff', '--no-renames', '-U0']),
      git(root, ['ls-files', '--others', '--exclude-standard', '-z']),
    ])
    // A failed command must still drain its siblings before releasing the repository.
    // Otherwise Windows can keep the worktree busy after this read has already returned.
    const output = results.map((result) => {
      if (result.status === 'rejected') throw result.reason
      return result.value
    })
    const [working, staged, untracked] = output as [string, string, string]
    const snapshot: Snapshot = new Map()
    patches(working, snapshot)
    patches(staged, snapshot)
    for (const path of untracked.split('\0').filter(Boolean)) {
      if (!inside(root, path)) continue
      snapshot.set(path, [])
    }
    return snapshot
  }

  async project(
    ledger: ThreadDiffLedger,
    root: string | null,
    now: number,
  ): Promise<ThreadDiffData | null> {
    if (!root) return null
    let snapshot: Snapshot
    try {
      snapshot = await this.snapshot(root, now)
    } catch {
      return null
    }
    const files: ThreadDiffData['files'] = []
    let complete = ledger.complete
    for (const evidence of ledger.evidence()) {
      for (const absolute of new Set(evidence.paths)) {
        const path = relative(root, absolute).replace(/\\/g, '/')
        if (!inside(root, path)) {
          complete = false
          continue
        }
        let variants = snapshot.get(path)
        if (!variants) continue
        if (!variants.length) {
          try {
            if ((await stat(join(root, path))).size > 512 * 1024)
              throw Error('Untracked file limit')
            const text = await readFile(join(root, path), 'utf8')
            if (text.includes('\0')) throw Error('Binary file')
            const added = text.replace(/\r\n/g, '\n').split('\n')
            if (added.at(-1) === '') added.pop()
            variants = [
              {
                status: 'added',
                lines: added.map((text, i) => ({ type: 'add', text, newLine: i + 1 })),
              },
            ]
          } catch {
            complete = false
            continue
          }
        }
        const lines: DiffLine[] = []
        // The same edit in the index and working tree counts once. Staged-only
        // edits still count if the working file has subsequently been reverted.
        const seen = new Map<string, number>()
        for (const variant of variants) {
          const selected = select(variant.lines, evidence.events)
          const occurrences = new Map<string, number>()
          const unique = selected.filter((line) => {
            const key = `${line.type}\0${line.text}`
            const count = (occurrences.get(key) ?? 0) + 1
            occurrences.set(key, count)
            return count > (seen.get(key) ?? 0)
          })
          for (const [key, count] of occurrences) seen.set(key, Math.max(count, seen.get(key) ?? 0))
          if (unique.length)
            lines.push(
              { type: 'hunk', text: lines.length ? 'Staged changes' : 'Uncommitted changes' },
              ...unique,
            )
        }
        if (!lines.length) continue
        complete &&= evidence.complete
        files.push({
          absolute,
          file: {
            path,
            status: variants[0]!.status,
            added: lines.filter((l) => l.type === 'add').length,
            removed: lines.filter((l) => l.type === 'remove').length,
            binary: false,
          },
          diff:
            lines.length > 1500
              ? { kind: 'too-big', lines: lines.length }
              : { kind: 'text', lines },
        })
      }
    }
    files.sort((a, b) => a.file.path.localeCompare(b.file.path))
    // A clean worktree is authoritative even when the recorded history has gaps.
    if (!snapshot.size) complete = true
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

/** Match actual Git lines to positioned recorded edits; never adopt a whole file's totals. */
function select(current: DiffLine[], events: DiffLine[][]): DiffLine[] {
  const key = (line: DiffLine) =>
    `${line.type}\0${line.type === 'add' ? line.newLine : line.oldLine}\0${line.text}`
  const available = new Set(
    current.filter((line) => line.type === 'add' || line.type === 'remove').map(key),
  )
  const owned = new Set<string>()
  for (const event of events) {
    let block: DiffLine[] = []
    const flush = () => {
      const adds = block.filter((line) => line.type === 'add')
      const removes = block.filter((line) => line.type === 'remove')
      // If another writer replaced this thread's replacement, the shared removal
      // of the original line is no longer evidence of this thread's pending edit.
      const allAddsRemain = adds.every((line) => available.has(key(line)))
      for (const line of block) {
        if (!available.has(key(line))) continue
        if (
          line.type === 'add' ||
          allAddsRemain ||
          (adds.length === removes.length && available.has(key(adds[removes.indexOf(line)]!)))
        )
          owned.add(key(line))
      }
      block = []
    }
    for (const line of event) {
      if (line.type === 'add' || line.type === 'remove') block.push(line)
      else flush()
    }
    flush()
  }
  return current.filter((line) => owned.has(key(line)))
}
