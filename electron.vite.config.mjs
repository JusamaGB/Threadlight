import { resolve } from 'node:path'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

// Three builds: main (Node side), preload (the bridge) and renderer (the React UI).
// Dependencies of main/preload stay external (loaded from node_modules at runtime).
export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        // The speech worker runs in its own utility process, so it is a separate entry.
        input: {
          index: resolve('src/main/index.ts'),
          'stt-worker': resolve('src/main/stt/worker.ts'),
        },
      },
    },
  },
  preload: {},
  renderer: {
    plugins: [react()],
  },
})
