import { useEffect, useState } from 'react'
import { PANEL_BROWSER_THREAD, type BrowserAccess } from '../../shared/browser'
import styles from './Settings.module.css'

export function BrowserAccessSettings() {
  const [open, setOpen] = useState(false)
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>Browser access</summary>
      {open && <BrowserAccessControls />}
    </details>
  )
}

function BrowserAccessControls() {
  const [browsers, setBrowsers] = useState<BrowserAccess[]>([])
  const [connections, setConnections] = useState<{ id: string; label: string }[]>([])
  const [selected, setSelected] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    let stopped = false
    void Promise.all([
      window.threadlight.browserRequest({ action: 'access' }),
      window.threadlight.browserRequest({ action: 'connections' }),
    ])
      .then(([access, available]) => {
        if (stopped) return
        if (!access.ok || !available.ok)
          throw Error(access.reason || available.reason || 'Browser access unavailable.')
        setBrowsers(access.access ?? [])
        setConnections(available.connections ?? [])
        setLoaded(true)
      })
      .catch(() => {
        if (!stopped)
          setError('Could not load browser access. Close and reopen this section to retry.')
      })
    return () => {
      stopped = true
    }
  }, [])
  const browser = browsers.find((entry) => entry.id === selected) ?? browsers[0]
  async function save(sharedWith: string[], hosted: boolean) {
    if (!browser || busy) return
    setBusy(true)
    setError('')
    try {
      const result = await window.threadlight.browserRequest({
        action: 'share',
        browserId: browser.id,
        connections: sharedWith,
        hosted,
      })
      if (!result.ok) throw Error(result.reason)
      setBrowsers((entries) =>
        entries.map((entry) =>
          entry.id === browser.id
            ? { ...entry, sharedWith: result.state?.sharedWith ?? sharedWith, hosted }
            : entry,
        ),
      )
    } catch {
      setError('Could not save browser access. Try again.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {!loaded && !error && <p role="status">Loading browser access…</p>}
      {loaded && !browser && <p>Open a browser from the header menu to manage its access here.</p>}
      {browser && (
        <>
          <label className={styles.row}>
            Browser
            <select
              aria-label="Browser access selection"
              disabled={busy}
              value={browser.id}
              onChange={(event) => setSelected(event.target.value)}
            >
              {browsers.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.threadId === PANEL_BROWSER_THREAD
                    ? 'Panel browser'
                    : entry.title || entry.url}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.row}>
            <span>Threadlight Agent</span>
            <input
              type="checkbox"
              checked={browser.hosted}
              disabled={busy}
              onChange={(event) => void save(browser.sharedWith, event.target.checked)}
            />
          </label>
          {connections.map((connection) => (
            <label className={styles.row} key={connection.id}>
              <span>{connection.label}</span>
              <input
                type="checkbox"
                disabled={busy}
                checked={browser.sharedWith.includes(connection.id)}
                onChange={(event) =>
                  void save(
                    event.target.checked
                      ? [...browser.sharedWith, connection.id]
                      : browser.sharedWith.filter((id) => id !== connection.id),
                    browser.hosted,
                  )
                }
              />
            </label>
          ))}
          {!connections.length && (
            <p>Enrol a Codex or Claude chat in Shared Spaces to grant it browser access.</p>
          )}
        </>
      )}
    </div>
  )
}
