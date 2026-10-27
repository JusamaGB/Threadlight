import { execFile } from 'node:child_process'

/** Shared by background metadata and attributed diffs: never flood Windows with Git children. */
export class WorkQueue {
  private running = 0
  private waiting: (() => void)[] = []
  constructor(private readonly limit: number) {}
  async run<T>(work: () => Promise<T>): Promise<T> {
    await new Promise<void>((resolve) => {
      const start = () => {
        this.running++
        resolve()
      }
      if (this.running < this.limit) start()
      else this.waiting.push(start)
    })
    try {
      return await work()
    } finally {
      this.running--
      this.waiting.shift()?.()
    }
  }
}

const commands = new WorkQueue(4)
export function runGit(folder: string, args: string[]): Promise<string> {
  return commands.run(
    () =>
      new Promise((resolve, reject) => {
        execFile(
          'git',
          ['-C', folder, '-c', 'core.quotepath=false', ...args],
          {
            windowsHide: true,
            timeout: 10_000,
            maxBuffer: 16 * 1024 * 1024,
            env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
          },
          (error, stdout) => (error ? reject(error) : resolve(stdout)),
        )
      }),
  )
}
