import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

// Three builds: main (Node side), preload (the bridge) and renderer (the React UI).
// Dependencies of main/preload stay external (loaded from node_modules at runtime).
export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    plugins: [react()],
  },
})
