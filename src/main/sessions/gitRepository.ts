import { readFile, realpath, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

export interface GitRepository {
  root: string
  gitDir: string
  commonDir: string
}
export const gitPathKey = (path: string) => {
  const normalized = resolve(path).replace(/\\/g, '/')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

/** Walk each actual folder: prefix matching would incorrectly adopt a nested repository. */
export async function findGitRepository(folder: string): Promise<GitRepository | null> {
  try {
    let root = await realpath(folder)
    if (!(await stat(root)).isDirectory()) return null
    for (;;) {
      const marker = join(root, '.git')
      const info = await stat(marker).catch(() => null)
      if (info) {
        let gitDir = marker
        if (info.isFile()) {
          const match = /^gitdir: (.+)\r?$/m.exec(await readFile(marker, 'utf8'))
          if (!match) return null
          gitDir = resolve(root, match[1]!.trim())
        }
        gitDir = await realpath(gitDir)
        const common = await readFile(join(gitDir, 'commondir'), 'utf8').catch(() => '')
        return {
          root,
          gitDir,
          commonDir: common ? await realpath(resolve(gitDir, common.trim())) : gitDir,
        }
      }
      const parent = dirname(root)
      if (parent === root) return null
      root = parent
    }
  } catch {
    return null
  }
}
