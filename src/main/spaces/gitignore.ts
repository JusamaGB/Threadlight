import {
  appendFileSync,
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
} from 'node:fs'
import { join } from 'node:path'

/** Append one anchored, directory-only rule. Preserve existing bytes and reject redirects. */
export function ignoreSpaceFolder(root: string, directory: string) {
  if (!/^[a-z0-9][a-z0-9-]{0,95}$/.test(directory)) throw Error('Invalid shared space folder.')
  const file = join(root, '.gitignore')
  const existing = lstatSync(file, { throwIfNoEntry: false })
  if (existing && (!existing.isFile() || existing.isSymbolicLink() || existing.nlink !== 1))
    throw Error('.gitignore must be a regular, unlinked file.')
  const fd = openSync(
    file,
    existing
      ? constants.O_RDWR | constants.O_APPEND
      : constants.O_RDWR | constants.O_CREAT | constants.O_EXCL,
    0o666,
  )
  try {
    const opened = fstatSync(fd),
      current = lstatSync(file)
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      current.isSymbolicLink() ||
      current.ino !== opened.ino ||
      current.dev !== opened.dev ||
      (existing && (existing.ino !== opened.ino || existing.dev !== opened.dev))
    )
      throw Error('.gitignore changed while opening it. Retry after checking the file.')
    if (opened.size > 1024 * 1024) throw Error('.gitignore is too large to update automatically.')
    const bytes = readFileSync(fd)
    if (bytes.includes(0)) throw Error('.gitignore must use UTF-8 text.')
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    const rule = `/shared-spaces/${directory}/`
    // Only the final effective rule can safely be treated as an identical retry:
    // a later negation may override an earlier copy of this rule.
    const lastRule = text
      .split(/\r?\n/)
      .filter((line) => line.trim() && !line.startsWith('#'))
      .at(-1)
    if (lastRule === rule) return
    const newline = text.includes('\r\n') ? '\r\n' : '\n'
    const suffix = `${bytes.length && !text.endsWith('\n') ? newline : ''}${rule}${newline}`
    appendFileSync(fd, suffix, 'utf8')
  } finally {
    closeSync(fd)
  }
}
