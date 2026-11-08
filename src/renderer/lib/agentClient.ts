import type { ThreadlightApi } from '../../shared/ipc'

/** A conversation destination. Agent UI and voice do not own backend routing. */
export type AgentClient = Pick<
  ThreadlightApi,
  | 'getAgent'
  | 'onAgent'
  | 'agentSend'
  | 'agentReadPage'
  | 'agentHistory'
  | 'agentResume'
  | 'agentInterrupt'
  | 'agentClose'
  | 'finishCallChat'
  | 'agentRespond'
  | 'agentDecide'
  | 'agentLiveStart'
  | 'agentLiveOpen'
  | 'agentLiveStop'
  | 'onAgentLive'
> & {
  historyCurrentId?: () => string | null
  readDraft?: () => string
  writeDraft?: (text: string) => void
  readDraftSelection?: (id: string | null) => { start: number; end: number } | undefined
  writeDraftSelection?: (id: string | null, value: { start: number; end: number }) => void
}
