// Every place Threadlight reads from lives in this file.
// Most of these are undocumented Claude internals: if a Claude update moves something,
// this is the one file to change.

import { homedir } from 'node:os'
import { join } from 'node:path'

export interface ClaudePaths {
  /** Claude Code transcripts: `<projectsDir>/<project>/<sessionId>.jsonl`. */
  projectsDir: string
  /** Claude app thread records: `<appSessionsDir>/<account>/<org>/local_<id>.json`. */
  appSessionsDir: string
  /** Electron keeps this file locked while the Claude app runs. */
  appLockFile: string
  /** The Claude app bundles Claude Code here: `<appCliRoot>/<version>/<build>/claude.exe`. */
  appCliRoot: string
  /** Where Claude Code's own native installer puts it. */
  nativeCli: string
  /** Every running Claude Code process registers here as `<pid>.json`, naming its session. */
  liveSessionsDir: string
}

export function defaultPaths(env: NodeJS.ProcessEnv = process.env, home = homedir()): ClaudePaths {
  const appData = env['APPDATA'] ?? join(home, 'AppData', 'Roaming')
  return {
    projectsDir: join(home, '.claude', 'projects'),
    appSessionsDir: join(appData, 'Claude', 'claude-code-sessions'),
    appLockFile: join(appData, 'Claude', 'lockfile'),
    appCliRoot: join(appData, 'Claude', 'claude-code'),
    nativeCli: join(home, '.local', 'bin', 'claude.exe'),
    liveSessionsDir: join(home, '.claude', 'sessions'),
  }
}

/** Opens a thread in the Claude app. */
export function appDeepLink(appId: string): string {
  return `claude://claude.ai/epitaxy/${appId}`
}

export interface CodexPaths {
  home: string
  state: string
  history: string
  sessions: string
  locks: string
  desktopState: string
  cliRoot: string
}

export const agentPaths = (userData: string) => ({
  workspace: join(userData, 'agent'),
  index: join(userData, 'agent-conversations.json'),
})

export const messagingPaths = (userData: string) => ({
  store: join(userData, 'message-recovery.json'),
})

export function codexPaths(env: NodeJS.ProcessEnv = process.env, home = homedir()): CodexPaths {
  const root = env['CODEX_HOME'] || join(home, '.codex')
  return {
    home: root,
    state: join(root, 'state_5.sqlite'),
    history: join(root, 'thread_history_1.sqlite'),
    sessions: join(root, 'sessions'),
    locks: join(root, 'thread-writer-locks'),
    desktopState: join(root, '.codex-global-state.json'),
    cliRoot: join(env['LOCALAPPDATA'] || join(home, 'AppData', 'Local'), 'OpenAI', 'Codex', 'bin'),
  }
}
