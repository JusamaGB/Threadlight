import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { resolve } from 'node:path'
import { afterAll, expect, it } from 'vitest'
import {
  spawnOwnedProcess,
  stopOwnedProcess,
  closeOwnedProcesses,
} from '../src/main/agent/ownedProcess'

const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
async function until(check: () => boolean, ms = 5000) {
  const deadline = Date.now() + ms
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Process condition timed out')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}
function observe(child: ChildProcessWithoutNullStreams) {
  const pids: number[] = []
  let pending = ''
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    pending += chunk
    let newline: number
    while ((newline = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, newline)
      pending = pending.slice(newline + 1)
      if (/^\d+$/.test(line)) pids.push(Number(line))
    }
  })
  child.stderr.resume()
  return pids
}
const leaf = 'console.log(process.pid); setInterval(() => {}, 1000)'
const branch = `const {spawn}=require('node:child_process'); console.log(process.pid); spawn(process.execPath,['-e',${JSON.stringify(leaf)}],{windowsHide:true,stdio:['ignore','inherit','inherit']}); setInterval(()=>{},1000)`
const tree = (graceful: boolean) =>
  `const {spawn}=require('node:child_process'); console.log(process.pid); spawn(process.execPath,['-e',${JSON.stringify(branch)}],{windowsHide:true,stdio:['ignore','inherit','inherit']}); process.stdin.resume(); ${graceful ? "process.stdin.on('end',()=>process.exit(0));" : ''} setInterval(()=>{},1000)`

afterAll(async () => {
  await closeOwnedProcesses()
})

it.each([true, false])(
  'reaps the entire real process tree (graceful=%s), leaving unrelated processes alive',
  async (graceful) => {
    const unrelated = spawn(process.execPath, ['-e', leaf], { windowsHide: true, stdio: 'ignore' })
    const child = spawnOwnedProcess(process.execPath, ['-e', tree(graceful)], process.cwd())
    const pids = observe(child)
    try {
      await until(() => pids.length === 3)
      expect(pids.every(alive)).toBe(true)
      const stopping = stopOwnedProcess(child)
      expect(stopOwnedProcess(child)).toBe(stopping)
      await stopping
      await until(() => pids.every((pid) => !alive(pid)))
      expect(alive(unrelated.pid!)).toBe(true)
    } finally {
      await stopOwnedProcess(child)
      unrelated.kill()
    }
  },
  15_000,
)

it('reaps descendants when the provider exits unexpectedly', async () => {
  const program = `const {spawn}=require('node:child_process'); const c=spawn(process.execPath,['-e',${JSON.stringify(leaf)}],{windowsHide:true,stdio:['ignore','inherit','inherit']}); setTimeout(()=>process.exit(2),500)`
  const child = spawnOwnedProcess(process.execPath, ['-e', program], process.cwd())
  const pids = observe(child)
  try {
    await until(() => pids.length === 1)
    await until(() => !alive(pids[0]!))
    await stopOwnedProcess(child)
  } finally {
    await stopOwnedProcess(child)
  }
}, 15_000)

it.skipIf(process.platform !== 'win32').each(['node', 'electron'])(
  'Windows reaps the job if its owning %s application is killed',
  async (runtime) => {
    const owner = spawn(
      runtime === 'electron'
        ? resolve('node_modules/electron/dist/electron.exe')
        : process.execPath,
      [resolve('test/fixtures/owned-process-host.cjs'), tree(false)],
      {
        windowsHide: true,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    )
    const pids = observe(owner)
    try {
      await until(() => pids.length === 3, 10000)
      owner.kill('SIGKILL')
      await until(() => pids.every((pid) => !alive(pid)))
    } finally {
      owner.kill('SIGKILL')
    }
  },
  20_000,
)

it('drains final stdout before releasing stream handles on natural exit', async () => {
  const child = spawnOwnedProcess(
    process.execPath,
    ['-e', "process.stdout.write('x'.repeat(200000),()=>process.exit(0))"],
    process.cwd(),
  )
  let output = ''
  child.stdout.on('data', (chunk) => {
    output += chunk.toString()
  })
  child.stderr.resume()
  await new Promise((resolve) => child.once('close', resolve))
  await stopOwnedProcess(child)
  expect(output.length).toBe(200000)
}, 15000)

it('drains every registered process on application shutdown and prevents late launches', async () => {
  const children = [
    spawnOwnedProcess(process.execPath, ['-e', leaf], process.cwd()),
    spawnOwnedProcess(process.execPath, ['-e', leaf], process.cwd()),
  ]
  const pids = children.map(observe)
  await until(() => pids.every((list) => list.length === 1))
  await closeOwnedProcesses()
  expect(pids.flat().every((pid) => !alive(pid))).toBe(true)
  expect(() => spawnOwnedProcess(process.execPath, [], process.cwd())).toThrow('closing')
}, 15_000)
