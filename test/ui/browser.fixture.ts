import { youtubeLayoutScript } from '../../src/main/browser/youtube'
import './artifacts-native.fixture'
import { app, ipcMain, nativeTheme, type BrowserWindow } from 'electron'
nativeTheme.themeSource = 'dark'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { SharedBrowserService } from '../../src/main/browser/service'
import { IPC } from '../../src/shared/ipc'
import { IDLE_AGENT } from '../../src/shared/agent'
import { DEFAULT_SETTINGS } from '../../src/shared/settings'
import { MemoryStore } from '../../src/main/memory/store'
import { MemoryServer } from '../../src/main/memory/server'
import { memoryTestTransport } from '../memoryTransportHelper'

void app.whenReady().then(async () => {
  const fixture = (
    globalThis as unknown as { artifactProof: { directory: string; panel: BrowserWindow } }
  ).artifactProof
  fixture.panel.show()
  if (process.env.THREADLIGHT_BROWSER_CAPTION_FIXTURE === '1') {
    fixture.panel.setAlwaysOnTop(true, 'screen-saver')
    for (const channel of [IPC.getSettings, IPC.agentGet, IPC.agentLiveStart])
      ipcMain.removeHandler(channel)
    ipcMain.handle(IPC.getSettings, () => ({
      ...DEFAULT_SETTINGS,
      enabledProviders: ['codex'],
      agentProvider: 'codex',
      voiceMode: 'gpt-live',
    }))
    ipcMain.handle(IPC.agentGet, () => ({ ...IDLE_AGENT, provider: 'codex' }))
    ipcMain.handle(IPC.agentLiveStart, () => ({ ok: true, sdp: 'synthetic' }))
    ipcMain.handle('control:hello', () => ({ instanceId: 'captions', generation: 1 }))
    ipcMain.handle('control:claim', () => true)
  }
  const store = new MemoryStore(join(fixture.directory, 'browser-memory.sqlite'))
  store.connectionProjects = () => store.projectIdentities()
  const space = store.execute({
    action: 'create_space',
    title: 'Browser test',
    operationId: randomUUID(),
  }) as { id: string }
  const auth = memoryTestTransport(fixture.directory)
  const server = new MemoryServer(store, auth)
  const endpoint = await server.start(0)
  const browser = new SharedBrowserService(
    fixture.panel,
    join(fixture.directory, 'browsers.json'),
    (id) => id === 'codex:artifact-native-test',
    () => server.connections.list(),
  )
  const http = createServer((request, response) => {
    if (request.url === '/tone.wav') {
      const samples = 8000 * 120
      const wave = Buffer.alloc(44 + samples * 2)
      wave.write('RIFF')
      wave.writeUInt32LE(wave.length - 8, 4)
      wave.write('WAVEfmt ', 8)
      wave.writeUInt32LE(16, 16)
      wave.writeUInt16LE(1, 20)
      wave.writeUInt16LE(1, 22)
      wave.writeUInt32LE(8000, 24)
      wave.writeUInt32LE(16000, 28)
      wave.writeUInt16LE(2, 32)
      wave.writeUInt16LE(16, 34)
      wave.write('data', 36)
      wave.writeUInt32LE(samples * 2, 40)
      response.setHeader('Content-Type', 'audio/wav')
      response.setHeader('Accept-Ranges', 'bytes')
      const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? '')
      const start = range ? Number(range[1]) : 0
      const end = range?.[2] ? Math.min(Number(range[2]), wave.length - 1) : wave.length - 1
      if (range) {
        response.statusCode = 206
        response.setHeader('Content-Range', `bytes ${start}-${end}/${wave.length}`)
      }
      response.setHeader('Content-Length', end - start + 1)
      response.end(wave.subarray(start, end + 1))
      return
    }
    response.setHeader('Content-Type', 'text/html')
    if (request.url === '/youtube-layout') {
      response.end(`<!doctype html><style>
        body{margin:0;background:#171717;color:#eee;font:14px Arial} ytd-masthead{display:block;height:70px} .ytSearchboxComponentInputBox{height:40px;display:flex} input{background:#222;color:white} ytd-search{display:block;padding:20px}
        .result{height:140px;border-bottom:1px solid #444} ytd-miniplayer{display:block;position:fixed;right:16px;bottom:16px;width:400px;height:301px;background:#222;border-radius:8px} video{width:400px;height:225px} h1{font-size:14px;margin:8px} .playlist{height:40px}
      </style><ytd-masthead><div id="container"><div class="ytSearchboxComponentInputBox"><input class="ytSearchboxComponentInput" aria-label="Search videos"></div></div></ytd-masthead>
      <ytd-search>${Array.from({ length: 20 }, (_, i) => `<div class="result">Video result ${i + 1}</div>`).join('')}</ytd-search>
      <ytd-miniplayer><div class="ytdMiniplayerComponentContent"><video muted></video><h1 class="ytdMiniplayerInfoBarTitle">A lecture with a long title that stays on one line</h1><button class="playlist" onclick="window.playlistClicks++">Playlist</button></div></ytd-miniplayer>
      <script>window.playlistClicks=0;const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;const ctx=canvas.getContext('2d');setInterval(()=>{ctx.fillStyle='navy';ctx.fillRect(0,0,320,180);ctx.fillStyle='white';ctx.fillText('Video',20,20)},100);const v=document.querySelector('video');v.srcObject=canvas.captureStream(10);v.play();</script>`)
      return
    }

    if (request.url === '/slow') {
      setTimeout(() => response.end('<h1>Slow page</h1>'), 1500)
      return
    }
    if (request.url === '/frame') {
      response.end(
        '<audio src="/tone.wav" preload="auto"></audio><button onclick="this.textContent=\'Frame clicked\'">Frame button</button>',
      )
      return
    }

    response.end(
      request.url === '/next'
        ? '<h1>Next page</h1><a href="/">Return</a>'
        : `<!doctype html><style>body{font:18px sans-serif;background:#eee;color:#111} video{width:240px;height:135px} video:fullscreen{width:100%;height:100%;object-fit:contain} .space{height:1200px}</style>
      <audio id="lesson-audio" src="/tone.wav" preload="auto"></audio><h1>Shared browser test</h1><button id="counter" onclick="this.textContent='Count '+(++window.count)">Count 0</button>
      <label>Name <input aria-label="Name"></label><a href="/next">Next page</a><div id="movie_player"><video controls muted></video><span class="ytp-caption-segment">Visible player caption.</span></div>
      <button id="fullscreen" onclick="document.querySelector('video').requestFullscreen()">Player fullscreen</button>
      <iframe title="Cross origin example" src="http://${request.headers.host?.replace('127.0.0.1', 'localhost')}/frame"></iframe><div class="space"></div><p>Bottom</p><script>window.count=0; const canvas=document.createElement('canvas'); canvas.width=320;canvas.height=180;const ctx=canvas.getContext('2d');setInterval(()=>{ctx.fillStyle='navy';ctx.fillRect(0,0,320,180);ctx.fillStyle='white';ctx.font='30px sans-serif';ctx.fillText('Video '+Date.now(),10,90)},100); const v=document.querySelector('video');v.srcObject=canvas.captureStream(10);v.play();</script>`,
    )
  })
  await new Promise<void>((resolve) =>
    http.listen(Number(process.env.THREADLIGHT_BROWSER_TEST_PORT ?? 0), '127.0.0.1', resolve),
  )
  const address = http.address() as { port: number }
  Object.assign(globalThis, {
    browserProof: {
      youtubeLayoutScript,
      browser,
      revokeAndRead: (id: string) => {
        const grant = server.connections.list().find((c) => c.id === id)!.grantId!
        store.execute({ action: 'revoke_grant', id: grant, operationId: randomUUID() })
        return readFileSync(join(fixture.directory, 'browsers.json'), 'utf8')
      },
      server,
      store,
      spaceId: space.id,
      endpoint,
      authFile: auth.authFile,
      url: `http://127.0.0.1:${address.port}/`,
      directory: fixture.directory,
    },
  })
  app.once('will-quit', () => {
    server.close()
    store.close()
    http.close()
  })
})
