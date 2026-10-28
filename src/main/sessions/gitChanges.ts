// The Changes view's data: which files differ from the last commit, and one file's diff at a
// time, fetched only when it is opened. Read-only: nothing here changes a repository.

import { execFile } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'

import type { ChangedFile, FileDiff } from '../../shared/types'
import { parseUnifiedDiff } from '../../shared/unifiedDiff'
export { parseUnifiedDiff } from '../../shared/unifiedDiff'

/** Past this, a diff is not drawn in the panel; the file opens in its own app instead. */
const MAX_DIFF_LINES = 1500
const MAX_NEW_FILE_BYTES = 512 * 1024
const GIT_TIMEOUT_MS = 10_000

/** Every file that differs from HEAD in the repository at `root`, new files included. */
export async function listChanges(root: string): Promise<ChangedFile[]> {
  const files = new Map<string, ChangedFile>()
  const numstat = (await git(root, ['diff', 'HEAD', '--numstat', '--no-renames', '-z'])) ?? ''
  for (const record of numstat.split('\0')) {
    const [added, removed, path] = record.split('\t')
    if (!path) continue
    const binary = added === '-' || removed === '-'
    files.set(path, {
      path,
      status: 'modified',
      added: binary ? 0 : Number.parseInt(added ?? '0', 10) || 0,
      removed: binary ? 0 : Number.parseInt(removed ?? '0', 10) || 0,
      binary,
    })
  }
  // "A" new (and staged), "D" deleted; everything else stays "modified".
  const names = (await git(root, ['diff', 'HEAD', '--name-status', '--no-renames', '-z'])) ?? ''
  const parts = names.split('\0')
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const file = files.get(parts[i + 1]!)
    if (file && parts[i] === 'A') file.status = 'added'
    if (file && parts[i] === 'D') file.status = 'deleted'
  }
  const untracked = (await git(root, ['ls-files', '--others', '--exclude-standard', '-z'])) ?? ''
  for (const path of untracked.split('\0').filter(Boolean)) {
    const text = await readText(join(root, path))
    files.set(path, {
      path,
      status: 'added',
      added: text === null ? 0 : lines(text).length,
      removed: 0,
      binary: text === null,
    })
  }
  return [...files.values()].sort((a, b) => a.path.localeCompare(b.path))
}

/** One file's diff against HEAD, as lines ready to draw. `path` must be inside `root`. */
export async function readFileDiff(root: string, path: string): Promise<FileDiff> {
  if (!inside(root, path)) return { kind: 'unavailable' }
  const tracked = (await git(root, ['ls-files', '--error-unmatch', '--', path])) !== null
  if (!tracked) {
    // A new file: all of it is added.
    const text = await readText(join(root, path))
    if (text === null) return { kind: 'binary' }
    const all = lines(text)
    if (all.length > MAX_DIFF_LINES) return { kind: 'too-big', lines: all.length }
    return { kind: 'text', lines: all.map((t, i) => ({ type: 'add', text: t, newLine: i + 1 })) }
  }
  const out = await git(root, ['diff', 'HEAD', '--no-color', '--no-ext-diff', '-U3', '--', path])
  if (out === null) return { kind: 'unavailable' }
  if (/^Binary files /m.test(out)) return { kind: 'binary' }
  const parsed = parseUnifiedDiff(out)
  if (parsed.length > MAX_DIFF_LINES) return { kind: 'too-big', lines: parsed.length }
  return { kind: 'text', lines: parsed }
}

/** Whether a repository-relative path stays inside the repository. */
export function inside(root: string, path: string): boolean {
  if (!path || isAbsolute(path)) return false
  const rel = relative(root, join(root, path))
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

function lines(text: string): string[] {
  if (!text) return []
  const all = text.replace(/\r\n/g, '\n').split('\n')
  if (all.at(-1) === '') all.pop()
  return all
}

/** A text file's contents; null if it is binary, too big to show, or unreadable. */
async function readText(path: string): Promise<string | null> {
  try {
    if ((await stat(path)).size > MAX_NEW_FILE_BYTES) return null
    const text = await readFile(path, 'utf8')
    return text.includes('\0') ? null : text
  } catch {
    return null
  }
}

function git(folder: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['-C', folder, ...args],
      { windowsHide: true, timeout: GIT_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 },
      (error, stdout) => resolve(error ? null : stdout),
    )
  })
}
