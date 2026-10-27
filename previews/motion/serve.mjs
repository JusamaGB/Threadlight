import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))
const server = await createServer({
  configFile: false,
  root,
  cacheDir: fileURLToPath(new URL('../../node_modules/.vite/motion-preview', import.meta.url)),
  server: {
    host: '127.0.0.1',
    port: Number(process.env.THREADLIGHT_PREVIEW_PORT ?? 5179),
    strictPort: true,
    fs: { allow: [fileURLToPath(new URL('../../', import.meta.url))] },
  },
})
await server.listen()
server.printUrls()
