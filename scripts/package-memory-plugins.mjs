// One canonical bridge, skill and protocol; committed copies make plugin caches standalone.
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { format, resolveConfig } from 'prettier'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const formatting = await resolveConfig(resolve(root, 'scripts/memory-protocol.json'))
const require = createRequire(import.meta.url),
  ts = require('typescript')
require.extensions['.ts'] = (module, filename) =>
  module._compile(
    ts.transpileModule(readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    filename,
  )
const { memoryTools, memoryInstructions } = require('../src/main/memory/protocol.ts')
const generated = new Map([
  [
    'scripts/memory-protocol.json',
    await format(
      JSON.stringify({ version: 1, instructions: memoryInstructions, tools: memoryTools }),
      { ...formatting, parser: 'json' },
    ),
  ],
  [
    'codex-plugin/scripts/memory-protocol.json',
    await format(
      JSON.stringify({ version: 1, instructions: memoryInstructions, tools: memoryTools }),
      { ...formatting, parser: 'json' },
    ),
  ],
  [
    'codex-plugin/scripts/memory-bridge.mjs',
    readFileSync(resolve(root, 'scripts/memory-bridge.mjs'), 'utf8'),
  ],
  [
    'codex-plugin/skills/shared-memory/SKILL.md',
    readFileSync(resolve(root, 'skills/shared-memory/SKILL.md'), 'utf8'),
  ],
])
for (const [file, content] of generated) {
  const path = resolve(root, file)
  if (process.argv.includes('--check')) {
    if (readFileSync(path, 'utf8').replaceAll('\r\n', '\n') !== content.replaceAll('\r\n', '\n'))
      throw new Error(`Stale plugin asset: ${file}. Run npm run plugins:package.`)
  } else {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content)
  }
}
console.log(
  process.argv.includes('--check')
    ? 'Plugin assets match canonical sources.'
    : 'Packaged both memory plugins.',
)
