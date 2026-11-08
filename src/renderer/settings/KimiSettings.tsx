import { useEffect, useRef, useState, type ReactNode } from 'react'

import {
  kimiSetupIncomplete,
  kimiSetupKey,
  kimiSetupSchema,
  MOONSHOT_ENDPOINT,
  type KimiRuntimeInspection,
  type KimiSetup,
} from '../../shared/kimi'
import type { SettingsPatch } from '../../shared/settings'
import styles from './Settings.module.css'

export function KimiSettings({
  setup,
  save,
  onOpenWorkspace,
}: {
  setup: KimiSetup
  save: (patch: SettingsPatch) => Promise<boolean>
  onOpenWorkspace?: () => void
}) {
  const [draft, setDraft] = useState(setup)
  const [saved, setSaved] = useState(kimiSetupKey(setup))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [inspecting, setInspecting] = useState(false)
  const [inspection, setInspection] = useState<KimiRuntimeInspection | null>(null)
  const generation = useRef(0)
  useEffect(
    () => () => {
      generation.current++
    },
    [],
  )
  const parsed = kimiSetupSchema.safeParse(draft)
  const key = parsed.success ? kimiSetupKey(parsed.data) : null
  const changed = key !== saved
  const update = (next: KimiSetup) => {
    generation.current++
    setDraft(next)
    setInspection(null)
    setInspecting(false)
    setError(null)
  }
  const inspect = async () => {
    if (!parsed.success) return
    const request = ++generation.current
    const requestedKey = kimiSetupKey(parsed.data)
    setInspecting(true)
    setInspection(null)
    setError(null)
    try {
      const result = await window.threadlight.inspectKimiLocalRuntime(parsed.data)
      if (request === generation.current && result.configurationKey === requestedKey)
        setInspection(result)
    } catch {
      if (request === generation.current)
        setError('Could not inspect the local runtime. Try again.')
    } finally {
      if (request === generation.current) setInspecting(false)
    }
  }
  const field = (label: string, child: ReactNode) => (
    <label className={styles.row}>
      <span className={styles.text}>
        <span className={styles.label}>{label}</span>
      </span>
      {child}
    </label>
  )
  const inputStyle = { width: 'min(52%, 210px)', minWidth: 0, padding: '0 5px' }
  return (
    <section className={styles.group} aria-label="Kimi setup">
      <h3 className={styles.groupLabel}>Kimi</h3>
      {onOpenWorkspace && (
        <div className={styles.row}>
          <button className={styles.small} onClick={onOpenWorkspace}>
            Open workspace preview
          </button>
          <span className={styles.hint}>Simulated activity</span>
        </div>
      )}
      {field(
        'Model connection',
        <select
          aria-label="Model connection"
          value={draft.connection.kind}
          disabled={saving}
          onChange={(event) => {
            const kind = event.target.value as KimiSetup['connection']['kind']
            update({
              ...draft,
              connection:
                kind === 'moonshot'
                  ? { kind, model: '', protocol: 'kimi', authentication: 'external-api-key' }
                  : {
                      kind,
                      endpoint: '',
                      model: '',
                      protocol: 'openai-chat',
                      authentication: 'none',
                    },
            })
          }}
        >
          <option value="local">Local model</option>
          <option value="server">Server model</option>
          <option value="moonshot">Moonshot API</option>
        </select>,
      )}
      {draft.connection.kind !== 'moonshot' ? (
        field(
          'Model endpoint',
          <input
            className={styles.key}
            style={inputStyle}
            type="url"
            autoComplete="off"
            spellCheck={false}
            value={draft.connection.endpoint}
            disabled={saving}
            placeholder={
              draft.connection.kind === 'local'
                ? 'http://localhost:8000/v1'
                : 'https://server.example/v1'
            }
            onChange={(event) => {
              if (draft.connection.kind !== 'moonshot')
                update({
                  ...draft,
                  connection: { ...draft.connection, endpoint: event.target.value },
                })
            }}
          />,
        )
      ) : (
        <p className={styles.hint}>Platform endpoint: {MOONSHOT_ENDPOINT}</p>
      )}
      {field(
        'Exact model ID',
        <input
          className={styles.key}
          style={inputStyle}
          autoComplete="off"
          spellCheck={false}
          value={draft.connection.model}
          disabled={saving}
          onChange={(event) =>
            update({ ...draft, connection: { ...draft.connection, model: event.target.value } })
          }
        />,
      )}
      {draft.connection.kind !== 'moonshot' &&
        field(
          'Authentication',
          <select
            aria-label="Authentication"
            value={draft.connection.authentication}
            disabled={saving}
            onChange={(event) => {
              if (draft.connection.kind !== 'moonshot')
                update({
                  ...draft,
                  connection: {
                    ...draft.connection,
                    authentication: event.target.value as 'none' | 'external-api-key',
                  },
                })
            }}
          >
            <option value="none">None intended</option>
            <option value="external-api-key">API key outside Settings</option>
          </select>,
        )}
      {field(
        'Agent execution location',
        <select
          aria-label="Agent execution location"
          value={draft.agent.kind}
          disabled={saving}
          onChange={(event) =>
            update({
              ...draft,
              agent:
                event.target.value === 'local'
                  ? { kind: 'local', installationPath: '' }
                  : { kind: 'server', host: '' },
            })
          }
        >
          <option value="local">This computer</option>
          <option value="server">Server (inactive draft)</option>
        </select>,
      )}
      {draft.agent.kind === 'local' ? (
        <>
          {field(
            'Kimi Code package folder',
            <input
              className={styles.key}
              style={inputStyle}
              autoComplete="off"
              spellCheck={false}
              value={draft.agent.installationPath}
              disabled={saving}
              onChange={(event) =>
                update({ ...draft, agent: { kind: 'local', installationPath: event.target.value } })
              }
            />,
          )}
          <div className={styles.row}>
            <button
              className={styles.small}
              disabled={saving || inspecting || !parsed.success || !draft.agent.installationPath}
              onClick={() => void inspect()}
            >
              {inspecting ? 'Inspecting…' : 'Inspect local runtime'}
            </button>
            <span className={styles.status} role="status">
              {inspection
                ? {
                    verified: 'Version verified',
                    unverified: 'Unverified',
                    missing: 'Missing',
                    unavailable: 'Unavailable',
                  }[inspection.status]
                : 'Runtime not checked'}
            </span>
          </div>
          {inspection && <p className={styles.hint}>{inspection.detail}</p>}
        </>
      ) : (
        <>
          {field(
            'Agent server hostname',
            <input
              className={styles.key}
              style={inputStyle}
              autoComplete="off"
              spellCheck={false}
              value={draft.agent.host}
              disabled={saving}
              onChange={(event) =>
                update({ ...draft, agent: { kind: 'server', host: event.target.value } })
              }
            />,
          )}
          <p className={styles.hint}>Remote agent connection is not implemented.</p>
          {draft.connection.kind === 'local' && (
            <p className={styles.hint}>
              A loopback model address would refer to the agent server, not this computer.
            </p>
          )}
        </>
      )}
      <div className={styles.row}>
        <button
          className={styles.small}
          disabled={saving || !parsed.success || !changed}
          onClick={async () => {
            if (!parsed.success) return
            const submitted = parsed.data
            setSaving(true)
            setError(null)
            try {
              if (await save({ kimiSetup: submitted })) setSaved(kimiSetupKey(submitted))
              else setError('Could not save Kimi configuration. Your draft is still here.')
            } catch {
              setError('Could not save Kimi configuration. Your draft is still here.')
            } finally {
              setSaving(false)
            }
          }}
        >
          {saving ? 'Saving…' : 'Save Kimi configuration'}
        </button>
        <span className={styles.status}>
          {!parsed.success
            ? 'Invalid'
            : `${changed ? 'Unsaved' : 'Saved'}${kimiSetupIncomplete(parsed.data) ? ' · Incomplete' : ''}`}
        </span>
      </div>
      {!parsed.success && (
        <p className={styles.error} role="alert">
          {parsed.error.issues[0]?.message}
        </p>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <p className={styles.hint}>
        Connection not tested · Model behaviour not verified · Agent execution is not enabled yet.
      </p>
      <details className={styles.hint}>
        <summary>Connection details</summary>
        <p>
          {draft.connection.kind === 'moonshot'
            ? 'Moonshot platform API key; separate from Kimi Code account sign-in. Credential entry is not implemented here.'
            : 'OpenAI Chat Completions compatible endpoint. Streaming and tool compatibility are unverified. No credentials are stored here.'}
        </p>
        <p>
          Kimi Code is the agent runtime. Model weights and a model server must be installed
          separately for self-hosted inference.
        </p>
        <p>Save and inspection do not contact the model or start an agent.</p>
      </details>
    </section>
  )
}
