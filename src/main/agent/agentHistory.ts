// Past agent conversations. Claude Code keeps each one as a transcript in the projects folder
// named after the agent's own folder; the Agent view lists them under Earlier, opens one to
// read, and can continue it.

import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

import type { AgentConversation, AgentItem } from '../../shared/agent'
import { isObject, oneLine, str, type JsonObject } from '../sessions/json'
import { stepText } from './agentRun'

/** The most listed under Earlier. */
const MAX_LISTED = 30
const BRIEFING = /^<threadlight-briefing>[\s\S]*?<\/threadlight-briefing>\s*/

/** Claude Code names a project's folder after its path, every other character a dash. */
export const transcriptsFolder = (projectsDir: string, workspace: string) =>
  join(projectsDir, workspace.replace(/[^A-Za-z0-9]/g, '-'))

/** What you wrote, without the briefing that rode along; null for anything else. */
function yourText(message: JsonObject): string | null {
  if (message['isMeta'] === true) return null
  const body = message['message']
  if (!isObject(body)) return null
  const content = body['content']
  const text =
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content
            .filter(isObject)
            .filter((block) => block['type'] === 'text')
            .map((block) => str(block['text']) ?? '')
            .join('\n')
        : ''
  const own = text.replace(BRIEFING, '').trim()
  return own && !own.startsWith('<') ? own : null
}

/** A transcript → the conversation as the Agent view shows it. */
export function parseConversation(transcript: string): AgentItem[] {
  const items: AgentItem[] = []
  for (const line of transcript.split('\n')) {
    let message: unknown
    try {
      message = JSON.parse(line)
    } catch {
      continue
    }
    if (!isObject(message) || message['isSidechain'] === true) continue
    if (message['type'] === 'user') {
      const text = yourText(message)
      if (text) items.push({ kind: 'you', text })
    } else if (message['type'] === 'assistant') {
      const body = message['message']
      const content = isObject(body) && Array.isArray(body['content']) ? body['content'] : []
      for (const block of content.filter(isObject)) {
        if (block['type'] === 'text') {
          const text = str(block['text'])?.trim()
          if (text) items.push({ kind: 'agent', text })
        } else if (block['type'] === 'tool_use') {
          const input = isObject(block['input']) ? block['input'] : {}
          items.push({ kind: 'step', text: stepText(str(block['name']) ?? '', input, 'Worker') })
        }
      }
    }
  }
  return items
}

/** Past conversations, newest first: what you asked first, and when it last changed. */
export async function listConversations(folder: string): Promise<AgentConversation[]> {
  const names = await readdir(folder).catch(() => [] as string[])
  const found = await Promise.all(
    names
      .filter((name) => name.endsWith('.jsonl'))
      .map(async (name): Promise<AgentConversation | null> => {
        const file = join(folder, name)
        const [info, text] = await Promise.all([stat(file), readFile(file, 'utf8')])
        const first = parseConversation(text).find((item) => item.kind === 'you')
        return first
          ? { id: name.slice(0, -'.jsonl'.length), title: oneLine(first.text), at: info.mtimeMs }
          : null
      }),
  )
  return found
    .filter((conversation): conversation is AgentConversation => conversation !== null)
    .sort((a, b) => b.at - a.at)
    .slice(0, MAX_LISTED)
}

/** One past conversation's lines; empty if it is gone. */
export async function readConversation(folder: string, id: string): Promise<AgentItem[]> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return []
  const text = await readFile(join(folder, `${id}.jsonl`), 'utf8').catch(() => '')
  return parseConversation(text)
}
