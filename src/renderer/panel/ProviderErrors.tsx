import { CHAT_RATE_LIMITED, chatSourceName, type ChatSource } from '../../shared/accountChats'
import type { RelayStatus } from '../../shared/types'
import { useAccountChatState } from '../hooks/useAccountChats'
import styles from './Panel.module.css'

// Reports copied outside the app use fixed categories, never raw provider errors or chat data.
function diagnostic(reason: string) {
  if (reason === CHAT_RATE_LIMITED) return 'rate limited'
  if (/cannot verify/i.test(reason)) return 'desktop identity could not be verified'
  if (/format changed|not expose|not advertise|not been validated/i.test(reason))
    return 'incompatible desktop interface'
  if (/open one|open a local/i.test(reason)) return 'desktop app or routing context unavailable'
  if (/uncertain|not be confirmed/i.test(reason)) return 'unconfirmed operation'
  return 'request failed'
}

export function ProviderErrors({
  sources,
  version,
  relays,
}: {
  sources: ChatSource[]
  version: string
  relays: Map<string, RelayStatus>
}) {
  const state = useAccountChatState()
  const issues = sources.flatMap((source) =>
    Object.entries(state[source].issues).map(([operation, issue]) => ({
      provider: chatSourceName(source),
      operation,
      reason: issue.reason,
      since: new Date(issue.since).toISOString(),
      lastListSuccess: state[source].lastListSuccess || null,
    })),
  )
  for (const provider of ['Codex', 'Claude']) {
    const failed = [...relays.values()].filter(
      (relay) =>
        relay.state === 'failed' &&
        (relay.sessionId.startsWith('codex:') ? 'Codex' : 'Claude') === provider,
    )
    const latest = failed.sort((a, b) => b.at - a.at)[0]
    if (latest)
      issues.push({
        provider,
        operation: 'Work-thread messaging',
        reason: latest.detail || 'Delivery failed.',
        since: new Date(latest.at).toISOString(),
        lastListSuccess: null,
      })
  }
  if (!issues.length) return null
  return (
    <div className={styles.providerErrors} data-provider-errors="">
      <div role="status" aria-live="polite">
        {issues.map(({ provider, operation, reason, lastListSuccess }) => {
          const paused = operation === 'Discovery' && diagnostic(reason) === 'rate limited'
          return (
            <div key={provider + operation}>
              <span
                className={styles.errorLight}
                data-paused={paused || undefined}
                aria-hidden="true"
              />
              <strong>
                {provider} · {operation === 'Discovery' ? 'Chat list' : operation}
              </strong>{' '}
              {paused
                ? 'Refresh paused after a rate limit. Threadlight retries automatically while the panel is visible.'
                : reason}
              {operation === 'Discovery' && lastListSuccess && (
                <small> Last refreshed {new Date(lastListSuccess).toLocaleTimeString()}.</small>
              )}
            </div>
          )
        })}
      </div>
      <button
        type="button"
        onClick={() =>
          window.threadlight.copyText(
            JSON.stringify(
              {
                threadlightVersion: version || null,
                observedAt: new Date().toISOString(),
                issues: issues.map(({ reason, lastListSuccess, ...issue }) => ({
                  ...issue,
                  category: diagnostic(reason),
                  lastListSuccess: lastListSuccess ? new Date(lastListSuccess).toISOString() : null,
                })),
              },
              null,
              2,
            ),
          )
        }
      >
        Copy diagnostics
      </button>
    </div>
  )
}
