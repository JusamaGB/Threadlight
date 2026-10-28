import { app } from 'electron'
import { join } from 'node:path'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { AppControlService, type ControlCaller } from '../../src/main/appControl/service'
import { AppControlServer } from '../../src/main/appControl/server'
import { restartAction } from '../../src/main/restart'
import { DEFAULT_SETTINGS } from '../../src/shared/settings'

const recovery = process.argv.indexOf('--recovery-profile')
const directory =
  recovery >= 0
    ? process.argv[recovery + 1]!
    : mkdtempSync(join(tmpdir(), 'threadlight-control-restart-'))
app.setPath('userData', directory)
void app.whenReady().then(async () => {
  const restart = restartAction({
    relaunch: () =>
      app.relaunch({
        args: [join(__dirname, 'app-control-restart.fixture.js'), '--recovery-profile', directory],
      }),
    quit: () => app.quit(),
    exit: (code) => app.exit(code),
  })
  const service = new AppControlService(
    {
      settings: () => DEFAULT_SETTINGS,
      updateSettings: async () => ({ ok: false }),
      workspaces: () => [],
      spaces: () => [],
      artifacts: async () => [],
      changes: async () => null,
      createSpace: async () => ({ ok: false }),
      createChat: async () => ({ ok: false }),
      busy: () => ({ agent: true, otherWork: false }),
      send: () => {},
      restart,
    },
    join(directory, 'operations.json'),
  )
  service.ready()
  if (recovery >= 0) {
    writeFileSync(
      join(directory, 'ready.json'),
      JSON.stringify({ instanceId: service.instanceId, pid: process.pid }),
    )
    app.quit()
    return
  }
  const caller: ControlCaller = {
    active: true,
    owner: () => 'restart-fixture',
    resolve: () => null,
    cards: async () => null,
    approve: (_id, _title, _detail, decide) => decide(true),
  }
  const server = new AppControlServer(service)
  await server.start()
  const connection = server.connect(caller)
  app.on('before-quit', () => writeFileSync(join(directory, 'cleanup.txt'), 'Graceful cleanup ran'))
  app.on('will-quit', () => server.close())
  Object.assign(globalThis, {
    restartProof: {
      directory,
      instanceId: service.instanceId,
      call: async (name: string, args: unknown) => {
        const response = await fetch(connection.endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${connection.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: { name, arguments: args },
          }),
        })
        const value = (await response.json()) as { result: { content: { text: string }[] } }
        return JSON.parse(value.result.content[0]!.text)
      },
    },
  })
})
