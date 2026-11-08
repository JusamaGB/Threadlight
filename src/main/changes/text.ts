import { Worker } from 'node:worker_threads'
import { WorkQueue } from '../sessions/gitProcess'
import type { DiffLine } from '../../shared/types'
const workers = new WorkQueue(2)

/** Bounded deterministic LCS, with a content-exact coarse replacement above its budget. */
function compare(before: string, after: string): DiffLine[] {
  const split = (text: string) => {
    if (!text) return []
    const lines = text.replace(/\r\n/g, '\n').split('\n')
    if (lines.at(-1) === '') lines.pop()
    return lines
  }
  const a = split(before),
    b = split(after)
  let prefix = 0,
    suffix = 0
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - suffix - 1] === b[b.length - suffix - 1]
  )
    suffix++
  const old = a.slice(prefix, a.length - suffix),
    next = b.slice(prefix, b.length - suffix)
  const lines: DiffLine[] = []
  let i = 0,
    j = 0
  const add = () => lines.push({ type: 'add', text: next[j]!, newLine: prefix + ++j })
  const remove = () => lines.push({ type: 'remove', text: old[i]!, oldLine: prefix + ++i })
  if (old.length * next.length > 1_000_000) {
    while (i < old.length) remove()
    while (j < next.length) add()
  } else {
    const width = next.length + 1,
      table = new Uint32Array((old.length + 1) * width)
    for (let x = old.length - 1; x >= 0; x--)
      for (let y = next.length - 1; y >= 0; y--)
        table[x * width + y] =
          old[x] === next[y]
            ? 1 + table[(x + 1) * width + y + 1]!
            : Math.max(table[(x + 1) * width + y]!, table[x * width + y + 1]!)
    while (i < old.length || j < next.length) {
      if (i < old.length && j < next.length && old[i] === next[j]) {
        lines.push({ type: 'context', text: old[i]!, oldLine: prefix + ++i, newLine: prefix + ++j })
      } else if (
        i < old.length &&
        (j === next.length || table[(i + 1) * width + j]! >= table[i * width + j + 1]!)
      )
        remove()
      else add()
    }
  }
  if (!lines.length && before !== after)
    lines.push({ type: 'hunk', text: 'Line endings or final newline changed' })
  return lines
}

/** User source is data; only this application-owned function executes in the worker. */
export function compareText(before: string, after: string): Promise<DiffLine[]> {
  return workers.run(
    () =>
      new Promise((resolve, reject) => {
        const worker = new Worker(
          `const { parentPort, workerData } = require('node:worker_threads'); parentPort.postMessage((${compare.toString()})(...workerData));`,
          { eval: true, workerData: [before, after] },
        )
        const timeout = setTimeout(() => {
          void worker.terminate()
          reject(Error('Text comparison timed out'))
        }, 10_000)
        worker.once('message', (lines: DiffLine[]) => {
          clearTimeout(timeout)
          resolve(lines)
        })
        worker.once('error', (error) => {
          clearTimeout(timeout)
          reject(error)
        })
        worker.once('exit', (code) => {
          clearTimeout(timeout)
          if (code) reject(Error('Text comparison unavailable'))
        })
      }),
  )
}
