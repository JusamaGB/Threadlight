import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { windowsProcessJob, type ProcessJob } from './windowsProcessJob'

// Wait for assignment to the owning job before starting any provider code. The
// separate IPC channel leaves provider stdin/stdout exclusively for its protocol.
const launcher = `
const { spawn } = require('node:child_process');
let child;
const timer = setTimeout(() => process.exit(1), 10000);
process.once('disconnect', () => process.exit(1));
process.once('message', ({ command, args, cwd, env }) => {
  clearTimeout(timer);
  child = spawn(command, args, { cwd, env, windowsHide: true, shell: false, stdio: ['pipe', 'inherit', 'inherit'] });
  child.stdin.on('error', () => {});
  process.stdin.pipe(child.stdin);
  child.once('error', () => process.exit(1));
  child.once('exit', code => process.exit(code ?? 1));
});
`

const stops = new WeakMap<ChildProcessWithoutNullStreams, () => Promise<void>>()
const active = new Set<() => Promise<void>>()
let shuttingDown = false
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** Own only processes created here, never desktop apps or PID/name-based discovery. */
export function spawnOwnedProcess(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): ChildProcessWithoutNullStreams {
  if (shuttingDown) throw new Error('Threadlight is closing.')
  const job: ProcessJob | undefined = process.platform === 'win32' ? windowsProcessJob() : undefined
  const launcherEnv: NodeJS.ProcessEnv = { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  // A preload could run before the job is assigned; the provider receives its own env later.
  delete launcherEnv.NODE_OPTIONS
  delete launcherEnv.NODE_PATH
  let child: ChildProcessWithoutNullStreams
  try {
    child = spawn(process.execPath, ['-e', launcher], {
      cwd,
      env: launcherEnv,
      windowsHide: true,
      shell: false,
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    }) as ChildProcessWithoutNullStreams
  } catch (error) {
    job?.close()
    throw error
  }
  let exited = false
  let stopped: Promise<void> | undefined
  let resolveExit!: () => void
  const exit = new Promise<void>((resolve) => {
    resolveExit = resolve
  })
  const closed = new Promise<void>((resolve) => child.once('close', () => resolve()))
  const stop = () => {
    if (stopped) return stopped
    stopped = Promise.resolve().then(async () => {
      try {
        child.stdin.end()
        if (!exited) {
          let timer: ReturnType<typeof setTimeout> | undefined
          await Promise.race([
            exit,
            new Promise<void>((resolve) => {
              timer = setTimeout(resolve, 1000)
            }),
          ])
          clearTimeout(timer)
        }
        if (job) {
          job.terminate()
          const deadline = Date.now() + 2000
          while (job.active()) {
            if (Date.now() >= deadline) throw new Error('Agent process cleanup timed out.')
            await delay(20)
          }
        } else if (child.pid) {
          try {
            process.kill(-child.pid, 'SIGKILL')
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
          }
        }
        // Exit can precede the last stdout bytes. Drain protocol output after the
        // job is empty before destroying the parent's stream handles.
        let drainTimer: ReturnType<typeof setTimeout> | undefined
        await Promise.race([
          closed,
          new Promise<void>((resolve) => {
            drainTimer = setTimeout(resolve, 500)
          }),
        ])
        clearTimeout(drainTimer)
      } finally {
        job?.close()
        child.stdin.destroy()
        child.stdout.destroy()
        child.stderr.destroy()
        if (child.connected) child.disconnect()
        active.delete(stop)
      }
    })
    // Unexpected exits also initiate cleanup; callers can still await the same failure.
    void stopped.catch(() => console.error('Agent process cleanup could not be confirmed.'))
    return stopped
  }
  stops.set(child, stop)
  active.add(stop)
  const ended = () => {
    exited = true
    resolveExit()
    void stop()
  }
  child.once('exit', ended)
  child.once('error', ended)
  child.stdin.on('error', () => {
    void stop()
  })
  try {
    if (!child.pid) throw new Error('Could not start the Agent launcher.')
    job?.assign(child.pid)
    child.send!({ command, args, cwd, env }, (error) => {
      if (error) {
        void stop()
        child.emit('error', new Error('Could not initialize the Agent launcher.'))
      }
    })
  } catch (error) {
    // No provider has been sent its launch message, so only the gated helper can exist.
    child.kill()
    void stop()
    throw error
  }
  return child
}

export function stopOwnedProcess(child: ChildProcessWithoutNullStreams): Promise<void> {
  const stop = stops.get(child)
  if (stop) return stop()
  // Injected test transports have no OS job. Production always uses the launcher above.
  child.stdin.end()
  child.kill()
  return Promise.resolve()
}

/** Called on a real quit, after conversation retirement (which can archive via another CLI). */
export async function closeOwnedProcesses(): Promise<void> {
  shuttingDown = true
  await Promise.allSettled([...active].map((stop) => stop()))
}
