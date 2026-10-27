import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
export const { chromium } = require(process.env.THREADLIGHT_PLAYWRIGHT || 'playwright')
export const previewUrl = (process.env.THREADLIGHT_PREVIEW_URL || 'http://127.0.0.1:5179').replace(
  /\/$/,
  '',
)
const output = resolve(
  process.env.THREADLIGHT_SCREENSHOTS ||
    fileURLToPath(new URL('../../screenshots-local/motion-preview', import.meta.url)),
)
export function outputPath(name) {
  mkdirSync(output, { recursive: true })
  return join(output, name)
}
