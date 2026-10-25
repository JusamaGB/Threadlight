// One-shot helpers for scripts/install.mjs: `electron . --setup <command> [args…]` prints one
// line of JSON and exits. It opens no windows and takes no single-instance lock, so it works
// while Threadlight itself is running.
//
//   check-keys <accelerator>…  can each hotkey be registered? → [{ accelerator, ok, reason }]
//   corner <corner>            the dot's position in that corner of the main screen → { x, y }
//   login [on|off]             turn the sign-in entry on or off, or just report → { openAtLogin }

import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { app, globalShortcut, screen } from 'electron'

import { launchesAtSignIn, setLaunchAtSignIn } from './loginItem'
import { cornerPosition, isCorner } from './windows'

/** Same rule as the Settings hotkey field: a plain letter would fire while typing. */
const MODIFIER = /(^|\+)(Control|Ctrl|CommandOrControl|CmdOrCtrl|Alt|Option|Super|Meta)\+/i

/** The arguments after `--setup`, or null when the app should start normally. */
export function setupArgs(argv = process.argv): string[] | null {
  const at = argv.indexOf('--setup')
  return at === -1 ? null : argv.slice(at + 1)
}

export function runSetup(args: string[]): void {
  // Its own profile, so it never fights a running Threadlight over the real one.
  app.setPath('userData', join(tmpdir(), 'threadlight-setup'))
  void app.whenReady().then(() => {
    let result: unknown
    try {
      result = run(args)
    } catch (error) {
      result = { error: error instanceof Error ? error.message : String(error) }
    }
    process.stdout.write(`${JSON.stringify(result)}\n`)
    app.exit(0)
  })
}

function run([command, ...rest]: string[]): unknown {
  switch (command) {
    case 'check-keys':
      return rest.map(checkKey)
    case 'corner': {
      const corner = rest[0]
      if (!isCorner(corner)) throw new Error(`Unknown corner: ${String(corner)}`)
      return cornerPosition(corner, screen.getPrimaryDisplay().workArea)
    }
    case 'login':
      if (rest[0] === 'on' || rest[0] === 'off') setLaunchAtSignIn(rest[0] === 'on')
      return { openAtLogin: launchesAtSignIn() }
    default:
      throw new Error(`Unknown setup command: ${String(command)}`)
  }
}

/** Registers the key for a moment: Windows refuses one that another program already holds. */
function checkKey(accelerator: string): { accelerator: string; ok: boolean; reason?: string } {
  if (!MODIFIER.test(accelerator)) return { accelerator, ok: false, reason: 'needs-modifier' }
  try {
    const ok = globalShortcut.register(accelerator, () => {})
    if (ok) globalShortcut.unregister(accelerator)
    return ok ? { accelerator, ok } : { accelerator, ok, reason: 'taken' }
  } catch {
    return { accelerator, ok: false, reason: 'invalid' }
  }
}
