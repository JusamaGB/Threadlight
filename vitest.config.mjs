import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.{ts,mjs}'],
    environment: 'node',
    ...(process.env.CI && { maxWorkers: 2 }),
  },
})
