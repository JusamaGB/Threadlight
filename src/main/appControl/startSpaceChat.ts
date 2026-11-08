import { randomUUID } from 'node:crypto'
import type { AccountChats } from '../accountChats/service'
import type { ClaudePaths } from '../sessions/paths'
import type { CliCommand } from '../relay'
import { startClaudeSpaceChat } from './claudeSpaceChat'
import { workflowSchema, type Workflow, type Participant } from '../../shared/communication'
import type { ControlOutcome } from '../../shared/appControl'

type Input = {
  spaceId: string
  provider: 'claude' | 'perplexity'
  role: string
  openingMessage: string
}
export async function openSpaceProvider(
  input: Input,
  root: string,
  id: string,
  beforeSend: () => void,
  providers: { claude: () => Promise<CliCommand | null>; paths: ClaudePaths; chats: AccountChats },
) {
  if (input.provider === 'claude') {
    const command = await providers.claude()
    if (!command) throw Error('Claude Code unavailable.')
    beforeSend()
    return startClaudeSpaceChat(command, providers.paths, root, id, input.openingMessage)
  }
  const nativeId = await providers.chats.createPerplexityChat(input.openingMessage, id, beforeSend)
  return { target: 'perplexity:' + nativeId, model: 'Current native model' }
}
interface Dependencies {
  project(id: string): { root: string; paused: boolean; expiresAt: number; maxDispatches: number }
  workflow(id: string): Workflow | undefined
  enabled(provider: Input['provider']): boolean
  reserve(id: string): void
  start(
    input: Input,
    root: string,
    id: string,
    beforeSend: () => void,
  ): Promise<{ target: string; model: string }>
  save(workflow: Workflow, expectedRevision: number): void
}
export async function startSpaceChat(
  input: Input,
  id: string,
  deps: Dependencies,
): Promise<{ outcome: ControlOutcome; target?: string; linked?: boolean; reason?: string }> {
  let root: string, workflow: Workflow | undefined, project: ReturnType<Dependencies['project']>
  try {
    project = deps.project(input.spaceId)
    root = project.root
    workflow = deps.workflow(input.spaceId)
    if (!root || !deps.enabled(input.provider))
      return { outcome: 'unavailable', reason: 'Space workspace or selected provider unavailable.' }
    if (
      project.paused ||
      workflow?.paused ||
      project.expiresAt <= Date.now() ||
      (workflow && workflow.expiresAt <= Date.now())
    )
      return {
        outcome: 'unavailable',
        reason:
          'Resume the Shared Space and set an active communication period before starting a chat.',
      }
    if ((workflow?.participants.length ?? 0) >= 12)
      return { outcome: 'unavailable', reason: 'The Shared Space already has twelve participants.' }
  } catch {
    return {
      outcome: 'unavailable',
      reason: 'The selected Shared Space or its workspace is unavailable.',
    }
  }
  let submitted = false
  function beforeSend() {
    const current = deps.project(input.spaceId)
    if (
      submitted ||
      current.root !== root ||
      current.paused ||
      current.expiresAt <= Date.now() ||
      deps.workflow(input.spaceId)?.revision !== workflow?.revision ||
      (workflow && workflow.expiresAt <= Date.now()) ||
      !deps.enabled(input.provider)
    )
      throw Error('Shared Space changed before sending.')
    try {
      deps.reserve(input.spaceId)
    } catch {
      throw Error('The space has no remaining dispatch budget.')
    }
    submitted = true
  }
  let created
  try {
    created = await deps.start(input, root, id, beforeSend)
    if (!submitted) throw Error('The opening message was not dispatched.')
  } catch (error) {
    // Only fixed adapter messages may enter a durable Agent receipt.
    const reason = error instanceof Error ? error.message : ''
    const safeReasons = [
      'The space has no remaining dispatch budget.',
      'Shared Space changed before sending.',
      'Claude Code unavailable.',
      'Perplexity chat creation unavailable.',
      'Perplexity is busy. Wait for its current operation to finish.',
      'Perplexity access was denied. Run Threadlight in the same Windows sign-in as Perplexity.',
      'The Perplexity desktop pipe is busy. Wait for the current connection and try again.',
      'Open one Perplexity Windows app to read chats.',
      'Cannot verify the Perplexity desktop connection. Open the supported installed Perplexity app and try again.',
      'This Perplexity desktop version has not been validated for chat reading.',
      'Claude timed out. Check its saved history and network connection before retrying.',
      'Claude has not confirmed the saved chat and model in the selected space.',
    ]
    return {
      outcome: submitted ? 'uncertain' : 'unavailable',
      reason: safeReasons.includes(reason)
        ? reason
        : submitted
          ? 'The provider did not confirm a saved conversation. Check its history before trying again.'
          : 'The provider could not prepare the conversation. No opening message was sent.',
    }
  }
  const { target, model } = created
  try {
    const current = deps.project(input.spaceId)
    if (
      current.root !== root ||
      current.paused ||
      current.expiresAt <= Date.now() ||
      (workflow && workflow.expiresAt <= Date.now()) ||
      !deps.enabled(input.provider)
    )
      throw Error('Space changed')
    const revision = workflow?.revision ?? 0
    const base = workflow
      ? workflowSchema.parse(
          Object.fromEntries(
            Object.entries(workflow).filter(([key]) => key in workflowSchema.shape),
          ),
        )
      : {
          id: randomUUID(),
          spaceId: input.spaceId,
          mode: 'manual' as const,
          paused: false,
          maxConcurrent: 1,
          maxDispatches: current.maxDispatches,
          expiresAt: current.expiresAt,
          recover: false,
          acceptBy: 'human' as const,
          participants: [],
        }
    const participant: Participant = {
      id: randomUUID(),
      role: input.role,
      target,
      model,
      modelPolicy: input.provider === 'perplexity' ? 'current' : 'exact',
      communicate: true,
      requestWork: false,
    }
    deps.save(
      { ...base, revision: revision + 1, participants: [...base.participants, participant] },
      revision,
    )
    return { outcome: 'ok', linked: true, target }
  } catch {
    return {
      outcome: 'conflict',
      linked: false,
      target,
      reason:
        'The provider created this chat, but the Shared Space could not add it. Add this exact destination before sending. Do not create it again.',
    }
  }
}
