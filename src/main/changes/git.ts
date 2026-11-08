import { createHash } from 'node:crypto'
import { lstat, readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import type {
  ChangeCoverage,
  ChangeLens,
  CoverageReason,
  MetricCoverage,
} from '../../shared/changes'
import type { ChangedFile, Changes, DiffLine, FileDiff } from '../../shared/types'
import { parseUnifiedDiff } from '../../shared/unifiedDiff'
import { runGit } from '../sessions/gitProcess'
import { findGitRepository, gitPathKey } from '../sessions/gitRepository'
import { CaptureCache } from './cache'

export interface LocalComparison extends Changes {
  revision: string
  root: string
  rootId: string
  patches: Map<string, FileDiff>
  evidence: Map<string, { lines: DiffLine[]; before?: string; after?: string }>
}
export const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
export const coverage = (reasons: CoverageReason[] = [], stale = false): ChangeCoverage => ({
  state: reasons.length ? 'partial' : 'complete',
  reasons: [...new Set(reasons)],
  stale,
})
export function metrics(
  files: CoverageReason[] = [],
  text: CoverageReason[] = [],
  stale = false,
): MetricCoverage {
  return {
    files: coverage(files, stale),
    added: coverage([...files, ...text], stale),
    removed: coverage([...files, ...text], stale),
  }
}
export function within(root: string, path: string): boolean {
  const rel = relative(root, path)
  return (
    rel !== '..' &&
    !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) &&
    !isAbsolute(rel)
  )
}

/** Never follow a final symlink or an ancestor junction outside the authorised root. */
export async function captureText(
  root: string,
  path: string,
  limit = 2 * 1024 * 1024,
): Promise<{ text?: string; hash?: string; reason?: CoverageReason; binary?: boolean }> {
  const absolute = join(root, path)
  if (!within(root, absolute)) return { reason: 'unreadable' }
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const before = await lstat(absolute)
      if (!before.isFile() || !within(root, await realpath(absolute)))
        return { reason: 'unreadable' }
      if (before.size > limit) return { reason: 'content-limit' }
      const bytes = await readFile(absolute)
      const after = await lstat(absolute)
      if (
        !within(root, await realpath(absolute)) ||
        before.ino !== after.ino ||
        before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs ||
        bytes.length !== after.size
      )
        continue
      if (bytes.includes(0)) return { hash: digest(bytes), binary: true }
      try {
        return {
          text: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
          hash: digest(bytes),
        }
      } catch {
        return { hash: digest(bytes), reason: 'unsupported-encoding' }
      }
    } catch {
      return { reason: 'unreadable' }
    }
  }
  return { reason: 'concurrent-write' }
}

/** Decode Git's quoted paths including octal UTF-8 bytes. */
function decodePath(value: string): string {
  if (!value.startsWith('"')) return value
  const bytes: number[] = []
  for (let i = 1; i < value.length - 1; i++) {
    if (value[i] !== '\\') {
      bytes.push(...Buffer.from(value[i]!))
      continue
    }
    const octal = /^[0-7]{1,3}/.exec(value.slice(i + 1))?.[0]
    if (octal) {
      bytes.push(parseInt(octal, 8))
      i += octal.length
    } else {
      i++
      bytes.push(
        ...Buffer.from(
          (
            { t: '\t', n: '\n', r: '\r', b: '\b', f: '\f', v: '\v', a: '\x07' } as Record<
              string,
              string
            >
          )[value[i]!] ?? value[i]!,
        ),
      )
    }
  }
  return Buffer.from(bytes).toString('utf8')
}

export function parseGitComparison(output: string): {
  files: ChangedFile[]
  patches: Map<string, FileDiff>
  evidence: LocalComparison['evidence']
} {
  const split = output.indexOf('\0\0diff --git ')
  const stats = split >= 0 ? output.slice(0, split + 1) : output
  const sections =
    split >= 0
      ? output
          .slice(split + 2)
          .split(/^diff --git /m)
          .slice(1)
      : []
  const files: ChangedFile[] = []
  for (const record of stats.split('\0').filter(Boolean)) {
    const match = /^(\d+|-)\t(\d+|-)\t([\s\S]+)$/.exec(record)
    if (!match) throw Error('Malformed Git comparison')
    files.push({
      path: match[3]!,
      status: 'modified',
      added: match[1] === '-' ? 0 : Number(match[1]),
      removed: match[2] === '-' ? 0 : Number(match[2]),
      binary: match[1] === '-',
      countsComplete: match[1] !== '-',
    })
  }
  const patches = new Map<string, FileDiff>()
  const evidence: LocalComparison['evidence'] = new Map()
  for (const section of sections) {
    const headers = section.split(/^@@/m)[0]!
    const raw = /^\+\+\+ (.+)$/m.exec(headers)?.[1]
    const old = /^--- (.+)$/m.exec(headers)?.[1]
    const path =
      raw && raw !== '/dev/null'
        ? decodePath(raw.replace(/\t$/, '')).slice(2)
        : old && old !== '/dev/null'
          ? decodePath(old.replace(/\t$/, '')).slice(2)
          : null
    // Binary/mode-only sections have no ---/+++ header; Git emits patch and numstat
    // entries in the same diff order. Text entries additionally verify their path.
    const file = files[patches.size]
    if (!file || (path !== null && path !== file.path)) throw Error('Git patch/path mismatch')
    file.status = /^new file mode /m.test(headers)
      ? 'added'
      : /^deleted file mode /m.test(headers)
        ? 'deleted'
        : 'modified'
    const lines = parseUnifiedDiff(section)
    if (
      !file.binary &&
      (lines.filter((l) => l.type === 'add').length !== file.added ||
        lines.filter((l) => l.type === 'remove').length !== file.removed)
    )
      throw Error('Git patch/count mismatch')
    if (!file.binary)
      evidence.set(file.path, {
        lines,
        before:
          file.status === 'deleted'
            ? lines
                .filter((l) => l.type === 'remove')
                .map((l) => l.text)
                .join('\n') + '\n'
            : undefined,
        after: file.status === 'deleted' ? '' : undefined,
      })
    patches.set(
      file.path,
      file.binary
        ? { kind: 'binary' }
        : lines.length > 1500
          ? { kind: 'too-big', lines: lines.length }
          : { kind: 'text', lines },
    )
  }
  if (files.length !== patches.size) throw Error('Incomplete Git patch')
  return { files, patches, evidence }
}

const retained = new Map<string, { at: number; result: LocalComparison; bytes: number }>()
const snapshots = new CaptureCache<LocalComparison>()
const MAX_MEMORY = 64 * 1024 * 1024
export function retainComparison(result: LocalComparison): LocalComparison {
  const now = Date.now()
  retained.set(result.revision, {
    at: now,
    result,
    bytes: Buffer.byteLength(JSON.stringify([[...result.patches], [...result.evidence]])),
  })
  let bytes = [...retained.values()].reduce((sum, item) => sum + item.bytes, 0)
  for (const [key, item] of retained) {
    if (now - item.at > 15 * 60_000 || bytes > MAX_MEMORY || retained.size > 128) {
      retained.delete(key)
      snapshots.discard((result) => result.revision === key)
      bytes -= item.bytes
    }
  }
  return result
}
export function retainedPatch(root: string, revision: string, path: string): FileDiff {
  const found = retained.get(revision)
  if (
    !found ||
    Date.now() - found.at > 15 * 60_000 ||
    gitPathKey(found.result.root) !== gitPathKey(root)
  )
    return { kind: 'unavailable', reason: 'This revision is no longer available; refresh.' }
  found.at = Date.now()
  return found.result.patches.get(path) ?? { kind: 'unavailable' }
}
export function retainedPath(root: string, revision: string, path: string): string | null {
  const found = retained.get(revision)
  return found &&
    Date.now() - found.at <= 15 * 60_000 &&
    gitPathKey(found.result.root) === gitPathKey(root) &&
    found.result.patches.has(path) &&
    within(found.result.root, join(found.result.root, path))
    ? join(found.result.root, path)
    : null
}
export function forgetComparisons(root: string): void {
  invalidateGitComparison(root)
  for (const [key, item] of retained)
    if (gitPathKey(item.result.root) === gitPathKey(root)) retained.delete(key)
}
export function invalidateGitComparison(root?: string): void {
  snapshots.invalidate((key) => !root || key.startsWith(`${gitPathKey(root)}\0`))
}

export async function captureGit(
  root: string,
  lens: ChangeLens = 'git-current',
  now = Date.now(),
): Promise<LocalComparison> {
  const repository = await findGitRepository(root)
  if (!repository) throw Error('Git repository unavailable')
  root = repository.root
  const [rootInfo, gitInfo] = await Promise.all([stat(root), stat(repository.gitDir)])
  const rootId = digest(
    `${root}\0${rootInfo.dev}:${rootInfo.ino}\0${repository.gitDir}\0${gitInfo.dev}:${gitInfo.ino}`,
  )
  const key = `${gitPathKey(root)}\0${rootId}\0${lens}`
  return snapshots.get(
    key,
    () => capture(root, repository.gitDir, lens, rootId).then(retainComparison),
    now,
  )
}

async function capture(
  root: string,
  gitDir: string,
  lens: ChangeLens,
  rootId: string,
): Promise<LocalComparison> {
  if (lens === 'folder-baseline') throw Error('Not a Git comparison lens')
  // check-attr reads metadata, not working-file content or configured filters.
  const inventory = await runGit(root, [
    'ls-files',
    '--cached',
    '--others',
    '--exclude-standard',
    '-z',
  ])
  const attributes = await runGit(
    root,
    ['check-attr', '-z', '--stdin', 'filter', 'working-tree-encoding'],
    inventory,
  )
  const attrs = attributes.split('\0')
  for (let i = 0; i + 2 < attrs.length; i += 3) {
    if (!['unspecified', 'unset'].includes(attrs[i + 2]!))
      throw Error('Unsupported Git filter or working-tree encoding')
  }
  const head = async () => {
    try {
      return (await runGit(root, ['rev-parse', '--verify', 'HEAD'])).trim()
    } catch {
      // An unborn symbolic branch is distinct from corrupt or missing objects.
      const ref = (await runGit(root, ['symbolic-ref', 'HEAD'])).trim()
      try {
        await runGit(root, ['show-ref', '--verify', '--quiet', ref])
        throw Error('HEAD unavailable')
      } catch (error) {
        if ((error as { code?: number }).code !== 1) throw error
      }
      return (await runGit(root, ['hash-object', '-t', 'tree', '--stdin'], '')).trim()
    }
  }
  const common = await readFile(join(gitDir, 'commondir'), 'utf8').catch(() => '')
  const commonDir = common ? resolve(gitDir, common.trim()) : gitDir
  const marker = async () => {
    const headText = await readFile(join(gitDir, 'HEAD'), 'utf8')
    const ref = /^ref: (refs\/[^\r\n]+)$/.exec(headText.trim())?.[1]
    const parts = await Promise.all([
      readFile(join(gitDir, 'index')).catch(() => Buffer.alloc(0)),
      readFile(join(commonDir, 'packed-refs')).catch(() => Buffer.alloc(0)),
      ref ? readFile(join(commonDir, ref)).catch(() => Buffer.alloc(0)) : Buffer.alloc(0),
    ])
    return digest(Buffer.concat([Buffer.from(headText), ...parts]))
  }
  const diffArgs = (base: string) => [
    '-c',
    'core.quotepath=true',
    'diff',
    ...(lens === 'git-staged' ? ['--cached', base] : lens === 'git-current' ? [base] : []),
    '--patch',
    '--numstat',
    '-z',
    '--no-color',
    '--no-ext-diff',
    '--no-textconv',
    '--no-renames',
    '--diff-algorithm=myers',
    '--no-indent-heuristic',
    '--src-prefix=a/',
    '--dst-prefix=b/',
    '-U3',
    '--',
  ]
  let result: ReturnType<typeof parseGitComparison> = {
    files: [],
    patches: new Map(),
    evidence: new Map(),
  }
  let identity = '',
    stale = false
  let textReasons: CoverageReason[] = []
  let fileReasons: CoverageReason[] = []
  for (let attempt = 0; attempt < 3; attempt++) {
    textReasons = []
    fileReasons = []
    const before = await marker(),
      base = await head()
    const output = await runGit(root, diffArgs(base))
    result = parseGitComparison(output)
    if (lens !== 'git-staged')
      for (const file of result.files) {
        const evidence = result.evidence.get(file.path)
        if (!evidence || file.status === 'deleted') continue
        const content = await captureText(root, file.path)
        if (content.text !== undefined) {
          const lines = content.text.replace(/\r\n/g, '\n').split('\n')
          const matches = evidence.lines.every(
            (line) => !line.newLine || lines[line.newLine - 1] === line.text,
          )
          if (matches) evidence.after = content.text
          else fileReasons.push('concurrent-write')
        }
      }
    if (result.files.some((file) => file.binary)) textReasons.push('unsupported-encoding')
    const untracked =
      lens === 'git-staged'
        ? []
        : (await runGit(root, ['ls-files', '--others', '--exclude-standard', '-z']))
            .split('\0')
            .filter(Boolean)
    for (const path of untracked.slice(0, 20000)) {
      const content = await captureText(root, path)
      const lines =
        content.text === undefined ? [] : content.text.replace(/\r\n/g, '\n').split('\n')
      if (lines.at(-1) === '') lines.pop()
      if (content.reason || content.binary)
        textReasons.push(content.reason ?? 'unsupported-encoding')
      result.files.push({
        path,
        status: 'added',
        added: lines.length,
        removed: 0,
        binary: !!content.binary,
        countsComplete: content.text !== undefined,
        reason: content.reason,
      })
      if (content.text !== undefined)
        result.evidence.set(path, {
          before: '',
          after: content.text,
          lines: lines.map((text, i) => ({ type: 'add', text, newLine: i + 1 })),
        })
      result.patches.set(
        path,
        content.text === undefined
          ? content.binary
            ? { kind: 'binary' }
            : { kind: 'unavailable', reason: content.reason }
          : lines.length > 1500
            ? { kind: 'too-big', lines: lines.length }
            : {
                kind: 'text',
                lines: lines.map((text, i) => ({ type: 'add', text, newLine: i + 1 })),
              },
      )
    }
    if (untracked.length > 20000) fileReasons.push('inventory-limit')
    const verify = await runGit(root, diffArgs(base))
    const after = await marker()
    const verifyUntracked =
      lens === 'git-staged'
        ? []
        : (await runGit(root, ['ls-files', '--others', '--exclude-standard', '-z']))
            .split('\0')
            .filter(Boolean)
    stale =
      before !== after ||
      output !== verify ||
      JSON.stringify(untracked) !== JSON.stringify(verifyUntracked) ||
      fileReasons.includes('concurrent-write')
    identity = `${base}\0${before}\0${output}`
    if (!stale) break
  }
  if (stale) fileReasons.push('concurrent-write')
  let hasOtherLensChanges: boolean | null = null
  try {
    const other = await runGit(root, [
      'diff',
      '--cached',
      identity.split('\0')[0]!,
      '--name-only',
      '-z',
      '--no-ext-diff',
      '--no-textconv',
      '--',
    ])
    hasOtherLensChanges = !!other
  } catch {
    /* Unknown is distinct from no staged changes. */
  }
  result.files.sort((a, b) => a.path.localeCompare(b.path))
  const branch = await runGit(root, ['symbolic-ref', '--short', 'HEAD'])
    .then((s) => s.trim())
    .catch(() => null)
  const metric = metrics(fileReasons, textReasons, stale)
  const revision = digest(
    JSON.stringify([
      rootId,
      lens,
      'git-myers-v1',
      identity,
      result.files,
      [...result.patches],
      [...result.evidence].map(([path, value]) => [
        path,
        value.before === undefined ? null : digest(value.before),
        value.after === undefined ? null : digest(value.after),
      ]),
      metric,
      hasOtherLensChanges,
    ]),
  )
  return {
    ...result,
    root,
    rootId,
    branch,
    lens,
    revision,
    coverage: metric,
    complete: !fileReasons.length && !textReasons.length,
    hasOtherLensChanges,
    stale,
  }
}
