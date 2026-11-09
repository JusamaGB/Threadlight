import { randomUUID } from 'node:crypto'
import type { AccountChats } from '../accountChats/service'
import type { ClaudePaths } from '../sessions/paths'
import type { CliCommand } from '../relay'
import { startClaudeSpaceChat } from './claudeSpaceChat'
import { workflowSchema, type Workflow, type Participant } from '../../shared/communication'
import type { ControlOutcome } from '../../shared/appControl'

export type SpaceChatInput = {
  spaceId: string
  provider: 'claude' | 'perplexity' | 'codex'
  model?: string
  role: string
  openingMessage: string
}
export async function openSpaceProvider(
  input: SpaceChatInput,
  root: string,
  id: string,
  beforeSend: () => void,
  providers: {
    claude: () => Promise<CliCommand | null>
    paths: ClaudePaths
    chats: AccountChats
    codex?: (
      root: string,
      id: string,
      model: string | undefined,
      beforeCreate: () => void,
    ) => Promise<import('../../shared/newThread').NewThreadResult>
    sendCodex?: (
      target: string,
      text: string,
      model?: string,
    ) => Promise<{ ok: boolean; reason?: string }>
  },
  checkCurrent: () => void = () => {},
) {
  if (input.provider === 'codex') {
    if (!providers.codex || !providers.sendCodex) throw Error('Codex unavailable.')
    const chat = await providers.codex(root, id, input.model, beforeSend)
    if (!chat.ok && !chat.sessionId) throw Error(chat.reason)
    const target = chat.sessionId!
    if (!chat.ok) return { target, model: '', openingIssue: chat.reason }
    if (!chat.model)
      return {
        target,
        model: '',
        openingIssue:
          'Codex created the thread, but did not confirm its model. The opening message was not sent.',
      }
    const model = chat.model
    try {
      checkCurrent()
      const opening = await providers.sendCodex(target, input.openingMessage, chat.model)
      if (opening.ok) return { target, model }
    } catch {
      /* Keep the native identity available for recovery. */
    }
    return {
      target,
      model,
      openingIssue:
        'Codex created the thread, but delivery of its opening message was not confirmed. Inspect this thread before retrying.',
    }
  }
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
  enabled(provider: SpaceChatInput['provider']): boolean
  reserve(id: string): void
  start(
    input: SpaceChatInput,
    root: string,
    id: string,
    beforeSend: () => void,
    checkCurrent: () => void,
  ): Promise<{ target: string; model: string; openingIssue?: string }>
  save(workflow: Workflow, expectedRevision: number): void
}
export function spaceChatContext(
  input: Pick<SpaceChatInput, 'spaceId' | 'provider'>,
  deps: Pick<Dependencies, 'project' | 'workflow' | 'enabled'>,
) {
  try {
    const project = deps.project(input.spaceId),
      workflow = deps.workflow(input.spaceId)
    if (!project.root || !deps.enabled(input.provider))
      return { reason: 'Space workspace or selected provider unavailable.' }
    if (
      project.paused ||
      workflow?.paused ||
      project.expiresAt <= Date.now() ||
      (workflow && workflow.expiresAt <= Date.now())
    )
      return {
        reason:
          'Resume the Shared Space and set an active communication period before starting a chat.',
      }
    if ((workflow?.participants.length ?? 0) >= 12)
      return { reason: 'The Shared Space already has twelve participants.' }
    return { project, workflow }
  } catch {
    return { reason: 'The selected Shared Space or its workspace is unavailable.' }
  }
}
export async function startSpaceChat(
  input: SpaceChatInput,
  id: string,
  deps: Dependencies,
): Promise<{
  outcome: ControlOutcome
  target?: string
  linked?: boolean
  reason?: string
  model?: string
}> {
  const state = spaceChatContext(input, deps)
  if (!state.project) return { outcome: 'unavailable', reason: state.reason }
  const { project, workflow } = state,
    root = project.root
  let submitted = false
  function checkCurrent() {
    const current = deps.project(input.spaceId)
    if (
      current.root !== root ||
      current.paused ||
      current.expiresAt <= Date.now() ||
      deps.workflow(input.spaceId)?.revision !== workflow?.revision ||
      (workflow && workflow.expiresAt <= Date.now()) ||
      !deps.enabled(input.provider)
    )
      throw Error('Shared Space changed before sending.')
  }
  function beforeSend() {
    if (submitted) throw Error('Opening message already submitted.')
    checkCurrent()
    try {
      deps.reserve(input.spaceId)
    } catch {
      throw Error('The space has no remaining dispatch budget.')
    }
    submitted = true
  }
  let created
  try {
    created = await deps.start(input, root, id, beforeSend, checkCurrent)
    if (created.openingIssue)
      return {
        outcome: 'uncertain',
        linked: false,
        target: created.target,
        reason: created.openingIssue,
      }
    if (!submitted) throw Error('The opening message was not dispatched.')
  } catch (error) {
    // Only fixed adapter messages may enter a durable Agent receipt.
    const reason = error instanceof Error ? error.message : ''
    const safeReasons = [
      'The space has no remaining dispatch budget.',
      'Shared Space changed before sending.',
      'Claude Code unavailable.',
      'Codex unavailable.',
      'Requested Codex model is unavailable or ambiguous. Use an exact installed model ID.',
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
    return { outcome: 'ok', linked: true, target, model }
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
