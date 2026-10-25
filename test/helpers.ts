// Builders for SYNTHETIC test data. Never copy real transcripts or app records in here.

import { mkdir, mkdtemp, rm, utimes, writeFile, appendFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import type { ClaudePaths } from '../src/main/sessions/paths'

export interface Sandbox {
  root: string
  paths: ClaudePaths
  cleanup(): Promise<void>
}

export async function sandbox(): Promise<Sandbox> {
  const root = await mkdtemp(join(tmpdir(), 'threadlight-test-'))
  const paths = {
    projectsDir: join(root, 'projects'),
    appSessionsDir: join(root, 'app-sessions'),
    appLockFile: join(root, 'lockfile'),
  }
  await mkdir(paths.projectsDir, { recursive: true })
  await mkdir(paths.appSessionsDir, { recursive: true })
  return { root, paths, cleanup: () => rm(root, { recursive: true, force: true }) }
}

const toLines = (records: object[]) => records.map((r) => JSON.stringify(r) + '\n').join('')

export async function writeTranscript(path: string, records: object[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, toLines(records))
}

export async function appendTranscript(path: string, records: object[]): Promise<void> {
  await appendFile(path, toLines(records))
}

export async function setModified(path: string, ms: number): Promise<void> {
  const seconds = ms / 1000
  await utimes(path, seconds, seconds)
}

export function transcriptPath(paths: ClaudePaths, project: string, sessionId: string): string {
  return join(paths.projectsDir, project, `${sessionId}.jsonl`)
}

export async function writeAppRecord(
  paths: ClaudePaths,
  record: Record<string, unknown>,
): Promise<void> {
  const dir = join(paths.appSessionsDir, 'account-1', 'org-1')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, `${String(record['sessionId'])}.json`), JSON.stringify(record))
}

// --- record builders, matching the shapes Claude Code writes ---

export const prompt = (text: string) => ({ type: 'user', message: { role: 'user', content: text } })

export const textReply = (text: string) => ({
  type: 'assistant',
  message: { role: 'assistant', content: [{ type: 'text', text }] },
})

export const toolCall = (name: string, input: object) => ({
  type: 'assistant',
  message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_test', name, input }] },
})

export const toolResult = () => ({
  type: 'user',
  message: {
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: 'toolu_test', content: 'ok' }],
  },
})

export const interrupt = () => ({
  type: 'user',
  message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] },
})

export const plan = (input: object) => toolCall('mcp__app_turn__update_plan', input)
