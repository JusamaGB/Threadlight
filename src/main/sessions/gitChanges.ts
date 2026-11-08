import { isAbsolute, join, relative } from 'node:path'
import type { ChangedFile, FileDiff } from '../../shared/types'
import type { ChangeLens } from '../../shared/changes'
import { captureGit, retainedPatch } from '../changes/git'
export { parseUnifiedDiff } from '../../shared/unifiedDiff'

/** Compatibility callers receive the same materialised comparison as the viewer. */
export async function listChanges(
  root: string,
  lens: ChangeLens = 'git-current',
): Promise<ChangedFile[]> {
  return (await captureGit(root, lens)).files
}
export async function readFileDiff(
  root: string,
  path: string,
  revision?: string,
  lens: ChangeLens = 'git-current',
): Promise<FileDiff> {
  if (!inside(root, path)) return { kind: 'unavailable' }
  if (revision) return retainedPatch(root, revision, path)
  try {
    return (await captureGit(root, lens)).patches.get(path) ?? { kind: 'unavailable' }
  } catch {
    return { kind: 'unavailable' }
  }
}
export function inside(root: string, path: string): boolean {
  if (!path || isAbsolute(path)) return false
  const rel = relative(root, join(root, path))
  return (
    rel !== '' &&
    rel !== '..' &&
    !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) &&
    !isAbsolute(rel)
  )
}
