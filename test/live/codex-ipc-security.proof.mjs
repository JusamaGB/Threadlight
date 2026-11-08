// Read-only opt-in smoke: initialize, close, and check native handle cleanup. No chat RPCs.
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { once } from 'node:events'
const require = createRequire(import.meta.url)
const ts = require('typescript')
require.extensions['.ts'] = (module, file) =>
  module._compile(
    ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText,
    file,
  )
const { openVerifiedCodexPipe } = require('../../src/main/codex/verifiedPipe.ts')
const { initializeDesktopConnection } = require('../../src/main/codex/desktopConnection.ts')
const koffi = require('koffi'),
  kernel = koffi.load('kernel32.dll')
const current = kernel.func('void * __stdcall GetCurrentProcess()')
const count = kernel.func('int __stdcall GetProcessHandleCount(void *,_Out_ uint32 *)')
const handles = () => {
  const n = [0]
  if (!count(current(), n)) throw Error('Cannot count handles')
  return n[0]
}
async function roundTrip() {
  const pipe = await openVerifiedCodexPipe()
  try {
    const client = await initializeDesktopConnection(pipe)
    global.gc?.()
    const closed = once(pipe, 'close')
    client.close()
    await closed
  } finally {
    pipe.destroy()
  }
}
await roundTrip()
const before = handles()
for (let i = 0; i < 5; i++) await roundTrip()
const after = handles()
if (after > before + 2) throw Error(`Unexpected handle growth: ${before} -> ${after}`)
console.log(
  JSON.stringify({
    verifiedInitializations: 6,
    chatOperations: 0,
    handlesBefore: before,
    handlesAfter: after,
  }),
)
