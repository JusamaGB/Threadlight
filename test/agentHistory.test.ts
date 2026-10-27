import { mkdtemp, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  listConversations,
  parseConversation,
  readConversation,
  transcriptsFolder,
} from '../src/main/agent/agentHistory'

const line = (message: object) => JSON.stringify(message)
const transcript = (ask: string, reply: string) =>
  [
    line({ type: 'queue-operation' }),
    line({
      type: 'user',
      message: {
        role: 'user',
        content: `<threadlight-briefing>\n- "Docs" · idle\n</threadlight-briefing>\n\n${ask}`,
      },
    }),
    line({ type: 'user', isMeta: true, message: { role: 'user', content: 'Stop hook feedback' } }),
    line({
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', name: 'Task', input: { description: 'Read calendar' } }],
      },
    }),
    line({
      type: 'user',
      message: { content: [{ type: 'tool_result', content: 'Free all afternoon' }] },
    }),
    line({
      type: 'assistant',
      isSidechain: true,
      message: { content: [{ type: 'text', text: 'x' }] },
    }),
    line({ type: 'assistant', message: { content: [{ type: 'text', text: reply }] } }),
  ].join('\n')

describe('agent history', () => {
  it('finds the transcripts folder the way Claude Code names it', () => {
    expect(transcriptsFolder('P', 'C:\\Users\\a\\AppData\\Roaming\\Threadlight\\agent')).toBe(
      join('P', 'C--Users-a-AppData-Roaming-Threadlight-agent'),
    )
  })

  it('reads what you wrote (without the briefing), its steps and replies', () => {
    expect(parseConversation(transcript('Am I free?', 'Free all afternoon.'))).toEqual([
      { kind: 'you', text: 'Am I free?' },
      { kind: 'step', text: 'Worker · Read calendar' },
      { kind: 'agent', text: 'Free all afternoon.' },
    ])
  })

  it('lists past conversations newest first, titled by the first question', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'tl-history-'))
    const older = '11111111-1111-1111-1111-111111111111'
    const newer = '22222222-2222-2222-2222-222222222222'
    await writeFile(join(folder, `${older}.jsonl`), transcript('First  question', 'a'))
    await writeFile(join(folder, `${newer}.jsonl`), transcript('Second', 'b'))
    await writeFile(join(folder, 'empty.jsonl'), line({ type: 'queue-operation' }))
    await utimes(join(folder, `${older}.jsonl`), 1000, 1000)
    const listed = await listConversations(folder)
    expect(listed.map(({ id, title }) => ({ id, title }))).toEqual([
      { id: newer, title: 'Second' },
      { id: older, title: 'First question' },
    ])
    expect(await readConversation(folder, older)).toHaveLength(3)
    expect(await readConversation(folder, '../secrets')).toEqual([])
  })
})
