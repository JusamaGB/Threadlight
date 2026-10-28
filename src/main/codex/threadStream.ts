import type { TimelineItem } from '../../shared/threadTimeline'
import { isObject } from '../sessions/json'
import { connectCodexDesktop, type StreamingDesktopConnection } from './desktopConnection'
import { applyStreamPatches, projectStream } from './threadStreamState'

export type StreamUpdate =
  { connection: 'live'; items: TimelineItem[] } | { connection: 'reconnecting'; notice: string }

/** A bounded read subscription. No UI selection, read receipt, resume or turn creation. */
export function readCapturedCards(id: string, timeoutMs = 2500): Promise<TimelineItem[] | null> {
  return new Promise((resolve) => {
    let stop = () => {}
    const timer = setTimeout(() => {
      stop()
      resolve(null)
    }, timeoutMs)
    stop = followCodexThread(id, (update) => {
      if (update.connection !== 'live') return
      clearTimeout(timer)
      stop()
      resolve(update.items.filter((item) => item.fileChanges?.length).slice(-50))
    })
  })
}

/** A follower only: no ownership, resume, turn creation, messages or provider writes. */
export function followCodexThread(
  id: string,
  changed: (update: StreamUpdate) => void,
  connect = connectCodexDesktop,
): () => void {
  let stopped = false,
    generation = 0,
    attempt = 0
  let client: StreamingDesktopConnection | undefined, owner: string | undefined
  let state: Record<string, unknown> | undefined, revision: number | undefined
  let retry: NodeJS.Timeout | undefined,
    timeout: NodeJS.Timeout | undefined,
    publish: NodeJS.Timeout | undefined
  let detach: (() => void)[] = []
  const following = (value: boolean) => {
    if (client && owner)
      client.broadcast(
        'thread-stream-following-changed',
        { hostId: 'local', conversationId: id, following: value },
        1,
        [owner],
      )
  }
  const cleanup = () => {
    clearTimeout(timeout)
    clearTimeout(publish)
    publish = undefined
    for (const off of detach) off()
    detach = []
    try {
      following(false)
    } catch {
      /* Socket may have gone away. */
    }
    client?.close()
    client = undefined
    owner = undefined
    state = undefined
    revision = undefined
  }
  const recover = (notice: string) => {
    if (stopped) return
    generation++
    cleanup()
    clearTimeout(retry)
    changed({ connection: 'reconnecting', notice })
    retry = setTimeout(() => void start(), Math.min(30_000, 1000 * 2 ** Math.min(attempt++, 5)))
  }
  const start = async () => {
    const current = ++generation
    try {
      const connected = await connect()
      if (stopped || current !== generation) {
        connected.close()
        return
      }
      client = connected
      detach.push(client.onClose(() => recover('Connection lost. Showing last received messages.')))
      const response = await client.request(
        'thread-owner-discovery',
        { hostId: 'local', conversationId: id },
        1,
      )
      if (stopped || current !== generation) return
      if (response.resultType !== 'success' || typeof response.handledByClientId !== 'string')
        throw Error('No owner')
      owner = response.handledByClientId
      detach.push(
        client.onBroadcast((message) => {
          if (stopped || current !== generation) return
          const params = message.params
          if (
            message.method === 'ipc-connection-reset' ||
            (message.method === 'client-status-changed' &&
              isObject(params) &&
              params.clientId === owner &&
              params.status === 'disconnected')
          ) {
            recover('Reconnecting to Codex. Previous messages are retained.')
            return
          }
          if (
            message.method !== 'thread-stream-state-changed' ||
            message.sourceClientId !== owner ||
            !isObject(params) ||
            params.conversationId !== id ||
            params.hostId !== 'local'
          )
            return
          try {
            if (message.version !== 11 || !isObject(params.change))
              throw Error('Unsupported stream version')
            const change = params.change
            if (!Number.isSafeInteger(change.revision) || Number(change.revision) < 0)
              throw Error('Invalid revision')
            if (change.type === 'snapshot') {
              if (!isObject(change.conversationState) || change.conversationState.id !== id)
                throw Error('Wrong snapshot')
              state = change.conversationState
            } else if (change.type === 'patches') {
              if (
                !state ||
                revision === undefined ||
                revision !== change.baseRevision ||
                Number(change.revision) <= revision
              )
                throw Error('Revision gap')
              state = applyStreamPatches(state, change.patches)
              if (state.id !== id) throw Error('Thread identity changed')
            } else throw Error('Unknown change')
            revision = Number(change.revision)
            clearTimeout(timeout)
            attempt = 0
            if (!publish)
              publish = setTimeout(() => {
                publish = undefined
                try {
                  if (state) changed({ connection: 'live', items: projectStream(state) })
                } catch {
                  recover('Native history changed format. Using saved history while reconnecting.')
                }
              }, 50)
          } catch {
            recover('Refreshing the native stream. Previous messages are retained.')
          }
        }),
      )
      timeout = setTimeout(
        () => recover('Native stream unavailable. Using saved history while reconnecting.'),
        8000,
      )
      following(true)
    } catch {
      if (!stopped && current === generation)
        recover('Native stream unavailable. Using saved history while reconnecting.')
    }
  }
  void start()
  return () => {
    stopped = true
    generation++
    clearTimeout(retry)
    cleanup()
  }
}
