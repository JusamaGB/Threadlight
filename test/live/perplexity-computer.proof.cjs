// Explicit live proof. Run with Electron and --send to authorize one trivial model turn.
// Uses production encrypted Perplexity storage, without starting/restarting Threadlight.
const { app, safeStorage, shell } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { randomUUID } = require('node:crypto')
require.extensions['.ts'] = (module, file) =>
  module._compile(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText,
    file,
  )
const { PerplexityVault } = require('../../src/main/perplexity/vault.ts')
const { PerplexityComputer } = require('../../src/main/perplexity/computer.ts')
const { PerplexityService } = require('../../src/main/perplexity/service.ts')
const { discoverPerplexity } = require('../../src/main/perplexity/discovery.ts')
const output = process.env.THREADLIGHT_PERPLEXITY_PROOF
if (!output || !path.isAbsolute(output))
  throw Error('Set an absolute THREADLIGHT_PERPLEXITY_PROOF output file.')
const report = { live: true, desktop: false, oauth: false, modelTurn: false, transcript: false }
const save = () => fs.writeFileSync(output, JSON.stringify(report, null, 2))
app.on('window-all-closed', () => {})
app
  .whenReady()
  .then(async () => {
    const vault = new PerplexityVault(
      path.join(app.getPath('appData'), 'Threadlight', 'perplexity'),
      safeStorage,
    )
    let connection
    const service = new PerplexityService({
      vault,
      discover: discoverPerplexity,
      connection: (authorizing) =>
        (connection = new PerplexityComputer(
          vault,
          (url) => shell.openExternal(url),
          () => {
            authorizing()
            console.log('AUTH_REQUIRED: finish Perplexity sign-in in the browser.')
          },
        )),
      open: (url) => shell.openExternal(url),
      changed() {},
    })
    try {
      const discovery = await service.request({ action: 'discover' })
      report.desktop = discovery.snapshot.desktop.state === 'ready'
      report.desktopCount = discovery.snapshot.desktop.chats.length
      report.desktopReason = discovery.snapshot.desktop.reason
      console.log('DESKTOP', report.desktop, report.desktopCount)
      await service.request({ action: 'connect' })
      const deadline = Date.now() + 6 * 60000
      while (
        ['connecting', 'authorizing'].includes(service.snapshot().computer.state) &&
        Date.now() < deadline
      )
        await new Promise((resolve) => setTimeout(resolve, 1000))
      report.connectionState = service.snapshot().computer.state
      report.oauth = report.connectionState === 'connected'
      report.tools = service.snapshot().computer.tools
      save()
      if (!report.oauth) throw Error('OAuth connection did not complete.')
      console.log('CONNECTED', JSON.stringify(report.tools))
      // Provider schemas and this synthetic test's results only; never record OAuth material.
      const catalogue = await connection.client.listTools()
      report.toolSchemas = catalogue.tools.filter((tool) =>
        ['call_perplexity_computer', 'read_thread'].includes(tool.name),
      )
      const originalCall = connection.call.bind(connection)
      connection.call = async (name, args, progress) => {
        try {
          const result = await originalCall(name, args, progress)
          if (['call_perplexity_computer', 'read_thread'].includes(name)) {
            report[name] = result
            save()
          }
          return result
        } catch (error) {
          report.callFailure = { name, message: error.message }
          save()
          throw error
        }
      }
      if (report.tools.includes('models_list')) {
        const models = await connection.call('models_list', {})
        report.modelsRead = !models.isError
        save()
      }
      if (process.argv.includes('--reconcile')) {
        const reconciled = await service.request({ action: 'reconcile' })
        if (!reconciled.ok) throw Error(reconciled.reason)
        report.deliveryUncertain = reconciled.snapshot.uncertainSend
        save()
      }
      if (process.argv.includes('--send')) {
        const reply = await service.request({
          action: 'send',
          operationId: randomUUID(),
          message:
            'Connection test for Threadlight. Reply exactly THREADLIGHT_PERPLEXITY_OK. Do not browse, use connectors, modify files or take any external actions.',
        })
        report.modelTurn = reply.ok
        report.deliveryUncertain = reply.snapshot.uncertainSend
        report.taskStatus = reply.snapshot.thread?.status
        report.markerSeen =
          reply.snapshot.thread?.text.includes('THREADLIGHT_PERPLEXITY_OK') ?? false
        save()
        console.log(
          'TURN',
          JSON.stringify({
            accepted: report.modelTurn,
            status: report.taskStatus,
            markerSeen: report.markerSeen,
          }),
        )
        if (reply.snapshot.thread) {
          const read = await service.request({ action: 'read', threadId: reply.snapshot.thread.id })
          report.transcript = read.ok
          report.readStatus = read.snapshot.thread?.status
          report.readMarkerSeen =
            read.snapshot.thread?.text.includes('THREADLIGHT_PERPLEXITY_OK') ?? false
          save()
        }
      }
    } catch (error) {
      report.failure = error.message
      save()
      console.error(error.message)
    } finally {
      await service.close()
      console.log('PROOF_FINISHED')
      app.exit(
        report.oauth &&
          (!process.argv.includes('--send') || (report.modelTurn && report.transcript))
          ? 0
          : 1,
      )
    }
  })
  .catch((error) => {
    console.error(error.message)
    app.exit(1)
  })
