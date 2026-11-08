import { expect, it } from 'vitest'
import { commandActivity } from '../src/shared/commandActivity'

it.each([
  [
    String.raw`"C:\Users\example\.cache\runtime\pwsh.exe" -NoProfile -Command "$env:THREADLIGHT_PLAYWRIGHT='C:/runtime/playwright'; node test/ui/providers.smoke.mjs"`,
    'Running UI checks',
  ],
  [
    String.raw`"C:\Program Files\nodejs\node.exe" "Z:\project\test\ui\restart.smoke.mjs"`,
    'Running UI checks',
  ],
  ['npx playwright test', 'Running UI checks'],
  [
    'THREADLIGHT_PLAYWRIGHT=/opt/runtime/playwright node test/ui/providers.smoke.mjs',
    'Running UI checks',
  ],
  ["$env:THREADLIGHT_PLAYWRIGHT='C:/runtime/playwright'", 'Running a command'],
  ["$env:CONFIG='C:/eslint/jest/tsc'; mystery.exe", 'Running a command'],
  ['npx vitest run test/one.test.ts', 'Running tests'],
  ['npm run typecheck', 'Checking types'],
  ['npx eslint src', 'Checking code style'],
  ['npm run build', 'Building the application'],
  ['git diff --stat', 'Reviewing repository changes'],
  ['rg -n pattern src', 'Searching the project'],
  ['Get-Content src/main.ts', 'Reading project files'],
  [String.raw`"C:\Users\example\custom-helper.exe" --unknown`, 'Running a command'],
])('labels %s as %s', (command, expected) => {
  expect(commandActivity(command)).toBe(expected)
})

it('describes completion without claiming that the checks passed', () => {
  expect(commandActivity('npx playwright test', true)).toBe('Ran UI checks')
  expect(commandActivity('npm run build', true)).toBe('Ran the build')
})
