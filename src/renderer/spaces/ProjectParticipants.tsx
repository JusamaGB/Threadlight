import { useRef, useState } from 'react'
import type { MemoryInput, MemorySnapshot } from '../../shared/memory'
import type { Session } from '../../shared/types'
import { projectParticipants } from '../../shared/projectParticipants'
import styles from './ProjectParticipants.module.css'

const kinds = ['tool', 'skill', 'plugin', 'role'] as const
export function ProjectParticipants({
  data,
  sessions,
  spaceId,
  onUpdated,
  onConnect,
}: {
  data: MemorySnapshot
  sessions: Session[]
  spaceId: string
  onUpdated: (data: MemorySnapshot) => void
  onConnect: () => void
}) {
  const participants = projectParticipants(data, sessions, spaceId)
  const [editing, setEditing] = useState('')
  const [fields, setFields] = useState({ tool: '', skill: '', plugin: '', role: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const attempt = useRef<{ signature: string; input: MemoryInput } | null>(null)
  async function mutate(input: MemoryInput) {
    setBusy(true)
    setError('')
    setSaved('')
    const signature = JSON.stringify(input)
    if (attempt.current?.signature !== signature)
      attempt.current = { signature, input: { ...input, operationId: crypto.randomUUID() } }
    try {
      const result = await window.threadlight.memoryRequest(attempt.current.input)
      if (!result.ok) throw new Error(result.reason)
      if (result.snapshot) onUpdated(result.snapshot)
      attempt.current = null
      setSaved(
        input.action === 'report_capabilities'
          ? 'Capability report saved.'
          : 'Verification evidence saved.',
      )
      if (input.action === 'report_capabilities') setEditing('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save. Your input is still here.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className={styles.view} aria-label="Project participants">
      <h3>Project participants</h3>
      <p>
        Connect the Claude and Codex chats working on this project. Brainstorm uses their capability
        reports to suggest who could take each task.
      </p>
      <p>
        Tools stay with their provider. A report describes availability; it does not grant
        permission or prove a tool works.
      </p>
      <button onClick={onConnect}>Connect a chat</button>
      {!participants.length && <p>No participants yet. Connect a chat to begin.</p>}
      {participants.map((p) => (
        <article key={p.assignee}>
          <h4>{p.title}</h4>
          <p>
            {p.provider === 'codex' ? 'Codex' : 'Claude'} ·{' '}
            {p.status === 'connected'
              ? 'Connected'
              : p.status === 'approved'
                ? 'Approved · waiting for chat'
                : p.status === 'unavailable'
                  ? 'Chat unavailable in this workspace'
                  : 'Reconnect from chat'}{' '}
            · {p.canPublish ? 'Project publishing enabled' : 'Project publishing unavailable'}
          </p>
          {p.lastUsedAt && (
            <p>
              Last seen{' '}
              <time dateTime={new Date(p.lastUsedAt).toISOString()}>
                {new Date(p.lastUsedAt).toLocaleString()}
              </time>
            </p>
          )}
          {!p.reports.length && <p>No capability report yet.</p>}
          {p.reports.map((report) => (
            <details key={report.id}>
              <summary>
                {report.source === 'manual' ? 'Manually recorded' : 'Chat reported'} ·{' '}
                {report.capabilities.length} capabilities
              </summary>
              <p>
                Reported{' '}
                <time dateTime={new Date(report.createdAt).toISOString()}>
                  {new Date(report.createdAt).toLocaleString()}
                </time>
              </p>
              {Date.now() - report.createdAt > 7 * 24 * 60 * 60 * 1000 && (
                <p>Over seven days old. Recheck availability before assigning work.</p>
              )}
              {!report.capabilities.length && <p>This report lists no current capabilities.</p>}
              {report.capabilities.map((capability, index) => {
                const verification = report.verifications.find((v) => v.index === index)
                return (
                  <div className={styles.capability} key={`${capability.kind}:${capability.name}`}>
                    <strong>{capability.name}</strong>
                    <p>
                      {capability.kind} · {verification ? 'Human verified' : 'Unverified'}
                    </p>
                    {capability.description && <p>{capability.description}</p>}
                    {verification ? (
                      <>
                        <p>{verification.evidence}</p>
                        <p>Verified {new Date(verification.at).toLocaleString()}</p>
                      </>
                    ) : (
                      <details>
                        <summary>Record verification</summary>
                        <form
                          onSubmit={(e) => {
                            e.preventDefault()
                            const form = new FormData(e.currentTarget)
                            void mutate({
                              action: 'verify_capability',
                              id: report.id,
                              capabilityIndex: index,
                              evidence: String(form.get('evidence') ?? ''),
                            })
                          }}
                        >
                          <label>
                            Verification evidence for {capability.name}
                            <textarea
                              name="evidence"
                              required
                              maxLength={1000}
                              placeholder="What did you test or inspect, and what was the result?"
                            />
                          </label>
                          <button disabled={busy}>Save verification</button>
                        </form>
                      </details>
                    )}
                  </div>
                )
              })}
            </details>
          ))}
          <button
            disabled={busy}
            onClick={() => {
              setEditing(p.assignee)
              const report = p.reports.find((r) => r.source === 'manual')
              setFields(
                Object.fromEntries(
                  kinds.map((kind) => [
                    kind,
                    report?.capabilities
                      .filter((c) => c.kind === kind)
                      .map((c) => (c.description ? `${c.name} — ${c.description}` : c.name))
                      .join('\n') ?? '',
                  ]),
                ) as typeof fields,
              )
              setError('')
              setSaved('')
            }}
          >
            Record capabilities for {p.title}
          </button>
          {editing === p.assignee && (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                const capabilities = kinds.flatMap((kind) =>
                  fields[kind]
                    .split('\n')
                    .filter((line) => line.trim())
                    .map((line) => {
                      const [name, ...description] = line.split(' — ')
                      return {
                        kind,
                        name: name!.trim(),
                        description: description.join(' — ').trim(),
                      }
                    }),
                )
                void mutate({
                  action: 'report_capabilities',
                  spaceId,
                  assignee: p.assignee,
                  capabilities,
                })
              }}
            >
              <p>
                Record what this chat can use. One entry per line: Name — description. Saving empty
                lists clears the current manual report. New reports start unverified.
              </p>
              {kinds.map((kind) => (
                <label key={kind}>
                  {kind === 'tool'
                    ? 'Tools'
                    : kind === 'skill'
                      ? 'Skills'
                      : kind === 'plugin'
                        ? 'Plugins'
                        : 'Roles'}
                  <textarea
                    aria-label={`${kind} capabilities`}
                    value={fields[kind]}
                    maxLength={12000}
                    onChange={(e) => setFields({ ...fields, [kind]: e.target.value })}
                    disabled={busy}
                  />
                </label>
              ))}
              <button disabled={busy}>{busy ? 'Saving…' : 'Save capability report'}</button>
              <button type="button" disabled={busy} onClick={() => setEditing('')}>
                Cancel
              </button>
            </form>
          )}
        </article>
      ))}
      <details>
        <summary>Ask a chat to report its capabilities</summary>
        <p>
          In the connected chat, ask: “Use the Threadlight plugin to report the tools, skills,
          plugins and roles available to this chat with memory_report_capabilities. Report actual
          available capabilities without credentials or private configuration. Treat them as
          unverified claims.”
        </p>
        <p>
          The chat needs project-wide publishing access. After a plugin update, reconnect its tools
          to load the reporting tool.
        </p>
      </details>
      {error && <p role="alert">{error}</p>}
      {saved && <p role="status">{saved}</p>}
    </section>
  )
}
