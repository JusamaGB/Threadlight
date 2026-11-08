import { useId, useState, type ReactNode } from 'react'
import { contributes } from '../../../vscode-coach/package.json'
import { acceleratorLabel, BRAINSTORM_HOTKEY, LIVE_MUTE_KEYS } from '../../shared/accelerator'
import { isGptLiveShortcut, type Settings } from '../../shared/settings'
import styles from './Settings.module.css'

function Keys({ entries }: { entries: [string, string][] }) {
  return (
    <dl className={styles.shortcuts}>
      {entries.map(([keys, action]) => (
        <div key={keys + action}>
          <dt>{keys}</dt>
          <dd>{action}</dd>
        </div>
      ))}
    </dl>
  )
}

const editorKeys: Record<string, string> = {
  tab: 'Tab',
  escape: 'Esc',
  left: '←',
  right: '→',
  'alt+]': 'Alt+]',
  'alt+backspace': 'Alt+Backspace',
}

export function Hotkeys({
  settings,
  problem,
  children,
}: {
  settings: Settings
  problem?: string | null
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const scope = settings.screenRegionModes
    .map((mode) => (mode === 'live' ? 'in Live' : 'outside Live'))
    .join(' and ')
  return (
    <div className={styles.hotkeys}>
      <button
        className={styles.hotkeysToggle}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        <span aria-hidden="true">{open ? '▾' : '▸'}</span> Hotkeys
      </button>
      {problem && (
        <p role="alert" className={styles.error}>
          {problem}
        </p>
      )}
      <div id={id} hidden={!open}>
        {open && (
          <>
            {children}
            <p>
              {isGptLiveShortcut(settings) || settings.voiceMode === 'gpt-live'
                ? 'Talk toggles GPT Live with the Codex Agent.'
                : settings.talkMode === 'hold'
                  ? 'Hold Talk to dictate. Release to finish.'
                  : 'Press Talk to start or finish dictation.'}
            </p>
            <Keys
              entries={[
                [
                  acceleratorLabel(BRAINSTORM_HOTKEY),
                  'Toggle voice in the current or last Brainstorm project.',
                ],
                [
                  LIVE_MUTE_KEYS.map(acceleratorLabel).join(' or '),
                  'Mute or unmute the mic during an Agent or Brainstorm call.',
                ],
                ['Hold Ctrl', 'Temporarily hide the floating logo.'],
                ['Hold Ctrl+Alt', 'Peek at Active threads.'],
                [
                  'Ctrl + right-drag',
                  scope
                    ? 'Share a screen region ' + scope + '. Release Ctrl to send, Esc to cancel.'
                    : 'Screen regions are off.',
                ],
              ]}
            />
            <h4>In Threadlight</h4>
            <Keys
              entries={[
                ['Ctrl+Enter', 'Use the primary action on an attention card.'],
                ['Shift+F10 / Menu', 'Open actions for the focused item or selected text.'],
                ['Ctrl+C', 'Copy selected text.'],
                ['Enter / Shift+Enter', 'Send a message or add a line in a multiline composer.'],
                ['Esc', 'Dismiss the current menu, reader, composer or panel.'],
                ['← / →', 'Browse files in the artifact viewer.'],
                [
                  '↑ / ↓ · Home / End',
                  'Resize a focused Agent or pin grip. Home and End select its limits.',
                ],
                ['Ctrl + left-drag', 'Pan a code block.'],
                ['Shift + wheel', 'Scroll code or a canvas sideways.'],
                ['Arrows · Ctrl + wheel', 'Pan a focused project canvas or zoom at the pointer.'],
                ['+ / − · Home', 'Zoom or fit the focused Handoffs canvas.'],
              ]}
            />
            <h4>VS Code companion</h4>
            <p>
              Default keys while tracing, reviewing changes or navigating a predicted edit. VS Code
              keybinding overrides apply.
            </p>
            <Keys
              entries={contributes.keybindings.map((binding) => [
                editorKeys[binding.key] ?? binding.key,
                (binding.command === 'tab'
                  ? 'Indent while tracing'
                  : (contributes.commands.find((command) => command.command === binding.command)
                      ?.title ?? binding.command)
                ).replace('Threadlight: ', ''),
              ])}
            />
          </>
        )}
      </div>
    </div>
  )
}
