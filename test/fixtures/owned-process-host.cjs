// Disposable owner for the Windows parent-death proof; no provider/account is used.
const fs = require('node:fs')
const ts = require('typescript')
require.extensions['.ts'] = (module, filename) =>
  module._compile(
    ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    filename,
  )
const { spawnOwnedProcess } = require('../../src/main/agent/ownedProcess.ts')
const child = spawnOwnedProcess(process.execPath, ['-e', process.argv[2]], process.cwd())
child.stdout.pipe(process.stdout)
child.stderr.resume()
setInterval(() => {}, 1000)
