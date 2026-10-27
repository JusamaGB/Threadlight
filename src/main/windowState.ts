// Remembers where the user dragged the dot. Becomes part of settings.ts in a later step.

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { app } from 'electron'

export interface Point {
  x: number
  y: number
}

const file = () => join(app.getPath('userData'), 'window-state.json')

export function loadDotPosition(): Point | null {
  try {
    const raw: unknown = JSON.parse(readFileSync(file(), 'utf8'))
    const dot = (raw as { dot?: Point }).dot
    return dot && Number.isFinite(dot.x) && Number.isFinite(dot.y) ? dot : null
  } catch {
    return null
  }
}

export function saveDotPosition(point: Point): void {
  try {
    writeFileSync(file(), JSON.stringify({ dot: point }))
  } catch (error) {
    console.error('Could not save the dot position', error)
  }
}
