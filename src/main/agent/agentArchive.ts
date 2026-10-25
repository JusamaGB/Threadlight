import type { CodexTransport } from './codexClient'
import type { AgentRecord, AgentStore } from './agentStore'

/** Retire only a registered agent conversation. Keep its history and uncertain-send journal. */
export async function archiveAgentConversation(
  store: AgentStore,
  id: string,
  connect: () => Promise<CodexTransport>,
): Promise<void> {
  await store.flush()
  const record = store.get(id)
  if (!record || record.provider !== 'codex') throw new Error('Unknown agent conversation.')
  if (record.archiveState === 'archived') return
  await store.put({ ...record, archiveState: 'pending' })
  const client = await connect()
  try {
    await client.request('thread/archive', { threadId: record.providerId }, 10_000)
    // Reload metadata: archiving never removes or rewrites the transcript or pending input.
    await store.put({ ...store.get(id)!, archiveState: 'archived' })
  } finally {
    client.close()
  }
}

export async function restoreAgentConversation(
  store: AgentStore,
  record: AgentRecord,
  client: CodexTransport,
): Promise<AgentRecord> {
  if (record.archiveState === 'pending')
    throw new Error('Archiving is pending. Retry cleanup before continuing this conversation.')
  if (record.archiveState !== 'archived') return record
  await client.request('thread/unarchive', { threadId: record.providerId })
  const restored = { ...record, archiveState: undefined }
  await store.put(restored)
  return restored
}
