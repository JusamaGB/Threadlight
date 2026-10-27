// Stands in for claude.exe in tests. Records its arguments and answers like
// `claude -p … --output-format json` would, depending on FAKE_CLAUDE_MODE.
import { writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
if (process.env.FAKE_CLAUDE_ARGS_FILE) {
  writeFileSync(process.env.FAKE_CLAUDE_ARGS_FILE, JSON.stringify({ args, cwd: process.cwd() }))
}
const message = args[args.indexOf('-p') + 1]

switch (process.env.FAKE_CLAUDE_MODE) {
  case 'logged-out':
    console.log(
      JSON.stringify({
        type: 'result',
        is_error: true,
        result: 'Not logged in · Please run /login',
      }),
    )
    break
  case 'error':
    console.log(JSON.stringify({ type: 'result', is_error: true, result: 'Something broke' }))
    break
  case 'garbage':
    console.error('fatal: not json')
    break
  default:
    console.log(JSON.stringify({ type: 'result', is_error: false, result: `Got it: ${message}` }))
}
