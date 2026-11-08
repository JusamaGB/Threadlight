import { execFile, spawn } from 'node:child_process'

/** Only explicitly selected validation scripts; terminate their process tree on timeout. */
export function runProjectCheck(
  cwd: string,
  script: string,
  env: NodeJS.ProcessEnv,
  timeoutMs = 120_000,
): Promise<string> {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9:_-]*$/.test(script))
    return Promise.reject(Error('Invalid project check name.'))
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.platform === 'win32' ? 'cmd.exe' : 'npm',
      process.platform === 'win32' ? ['/d', '/s', '/c', `npm run ${script}`] : ['run', script],
      {
        cwd,
        env,
        windowsHide: true,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    let output = '',
      bytes = 0,
      failed = '',
      stopping = false
    const stop = (reason: string) => {
      if (stopping || child.exitCode !== null) return
      stopping = true
      failed = reason
      if (child.pid && process.platform === 'win32')
        execFile(
          'taskkill',
          ['/PID', String(child.pid), '/T', '/F'],
          { windowsHide: true },
          () => {},
        )
      else if (child.pid) {
        try {
          process.kill(-child.pid, 'SIGKILL')
        } catch {
          child.kill('SIGKILL')
        }
      }
    }
    const timer = setTimeout(
      () => stop('Check timed out after ' + Math.round(timeoutMs / 1000) + ' seconds.'),
      timeoutMs,
    )
    const receive = (chunk: Buffer) => {
      bytes += chunk.length
      output = (output + chunk.toString('utf8')).slice(-8000)
      if (bytes > 8 * 1024 * 1024) stop('Check exceeded the output limit.')
    }
    child.stdout.on('data', receive)
    child.stderr.on('data', receive)
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (failed || code !== 0)
        reject(Error((failed || `Check exited with code ${code}.`) + '\n' + output))
      else resolve(output)
    })
  })
}
