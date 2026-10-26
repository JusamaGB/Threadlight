#!/usr/bin/env node
// Sets Threadlight up from this source checkout: the setup skill (skills/setup/SKILL.md) runs
// it, and people can too. Every step says what it does; running it again changes nothing that
// is already right; uninstalling removes only what this script added (see install.json).
//
//   node scripts/install.mjs [--hotkey Control+Alt+Q] [--talk-mode toggle|hold]
//                            [--countdown 1-10] [--corner top-right|top-left|bottom-right|bottom-left]
//                            [--autostart | --no-autostart] [--no-start]
//   node scripts/install.mjs --check                 diagnose only; changes nothing
//   node scripts/install.mjs --check-keys <key>…     which hotkeys are free
//   node scripts/install.mjs --uninstall [--remove-data]
//
// Plain Node (22.16+), no dependencies of its own, so it runs before `npm ci`.

import { spawn, spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { homedir, release } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PLUGIN = 'threadlight@threadlight'
const MARKETPLACE = 'threadlight'
const HOOK_PORT = 47615
const SETTINGS_VERSION = 1
const CORNERS = ['top-right', 'top-left', 'bottom-right', 'bottom-left']
/** Windows 10 1803: the first build that ships curl.exe, which the plugin's hooks use. */
const MIN_WINDOWS_BUILD = 17134

const APPDATA = process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming')
const DATA_DIR = join(APPDATA, 'Threadlight')
const SETTINGS_FILE = join(DATA_DIR, 'settings.json')
const WINDOW_FILE = join(DATA_DIR, 'window-state.json')
const RECORD_FILE = join(DATA_DIR, 'install.json')
const CLAUDE_APP_DIR = join(APPDATA, 'Claude')

// ---------- output ----------

const say = (text) => console.log(text)
const ok = (text) => say(`  ✓ ${text}`)
const warn = (text) => say(`  ! ${text}`)
const bad = (text) => say(`  ✗ ${text}`)
const step = (text) => say(`\n${text}`)

class Stop extends Error {}
/** Ends the run with a message and exit code 1, before anything else changes. */
function fail(text) {
  bad(text)
  throw new Stop(text)
}

// ---------- arguments ----------

function parseArgs(argv) {
  const options = { keys: [] }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const value = () => {
      const next = argv[++i]
      if (next === undefined || next.startsWith('--')) fail(`${arg} needs a value.`)
      return next
    }
    switch (arg) {
      case '--check':
        options.mode = 'check'
        break
      case '--check-keys':
        options.mode = 'check-keys'
        while (argv[i + 1] && !argv[i + 1].startsWith('--')) options.keys.push(argv[++i])
        break
      case '--uninstall':
        options.mode = 'uninstall'
        break
      case '--remove-data':
        options.removeData = true
        break
      case '--hotkey':
        options.hotkey = value()
        break
      case '--talk-mode':
        options.talkMode = value()
        if (!['toggle', 'hold'].includes(options.talkMode)) fail('--talk-mode is toggle or hold.')
        break
      case '--countdown': {
        const seconds = Number(value())
        if (!Number.isInteger(seconds) || seconds < 1 || seconds > 10) {
          fail('--countdown is a whole number of seconds from 1 to 10.')
        }
        options.countdown = seconds
        break
      }
      case '--corner':
        options.corner = value()
        if (!CORNERS.includes(options.corner)) fail(`--corner is one of ${CORNERS.join(', ')}.`)
        break
      case '--autostart':
        options.autostart = true
        break
      case '--no-autostart':
        options.autostart = false
        break
      case '--no-start':
        options.noStart = true
        break
      case '--help':
      case '-h':
        options.mode = 'help'
        break
      default:
        fail(`Unknown option: ${arg} (see --help).`)
    }
  }
  options.mode ??= 'install'
  return options
}

// ---------- small helpers ----------

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

/** Writes through a temporary file, so a crash never leaves half a file behind. */
function writeJson(file, value) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(`${file}.tmp`, `${JSON.stringify(value, null, 2)}\n`)
  renameSync(`${file}.tmp`, file)
}

function run(command, args, { cwd = REPO, shell = false } = {}) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', shell, windowsHide: true })
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error,
  }
}

/** The last line of output that parses as JSON (CLIs may print notes before it). */
function lastJson(text) {
  for (const line of text.trim().split(/\r?\n/).reverse()) {
    try {
      return JSON.parse(line)
    } catch {
      // not JSON; keep looking
    }
  }
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function newestMtime(dir) {
  let newest = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    newest = Math.max(newest, entry.isDirectory() ? newestMtime(path) : statSync(path).mtimeMs)
  }
  return newest
}

// ---------- the pieces it looks at ----------

/** The Claude Code CLI: the copy the Claude app bundles, Claude Code's own install, or PATH. */
function findClaude() {
  const bundled = join(CLAUDE_APP_DIR, 'claude-code')
  if (existsSync(bundled)) {
    const versions = readdirSync(bundled, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .reverse()
    for (const version of versions) {
      for (const build of readdirSync(join(bundled, version))) {
        const exe = join(bundled, version, build, 'claude.exe')
        if (existsSync(exe)) return exe
      }
    }
  }
  const native = join(homedir(), '.local', 'bin', 'claude.exe')
  if (existsSync(native)) return native
  const where = run('where.exe', ['claude'])
  const found = where.stdout.split(/\r?\n/).find((line) => line.toLowerCase().endsWith('.exe'))
  return found ?? null
}

function claude(cli, args) {
  return run(cli, args)
}

function electronPath() {
  try {
    return createRequire(join(REPO, 'package.json'))('electron')
  } catch {
    return null
  }
}

const built = () => existsSync(join(REPO, 'out', 'main', 'index.js'))
const buildIsCurrent = () =>
  built() &&
  statSync(join(REPO, 'out', 'main', 'index.js')).mtimeMs >= newestMtime(join(REPO, 'src'))

/** Runs one of the app's `--setup` helpers (src/main/setupMode.ts) and returns its JSON. */
function setup(...args) {
  const electron = electronPath()
  if (!electron || !built()) return null
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE // would turn Electron into plain Node
  const result = spawnSync(electron, ['.', '--setup', ...args], {
    cwd: REPO,
    encoding: 'utf8',
    env,
    windowsHide: true,
    timeout: 30_000,
  })
  const answer = lastJson(result.stdout ?? '')
  if (answer && typeof answer === 'object' && 'error' in answer) fail(answer.error)
  return answer
}

/** Threadlight's own processes: anything running this checkout's copy of Electron. */
function threadlightProcesses() {
  const electron = electronPath()
  if (!electron) return []
  const path = electron.replaceAll("'", "''")
  const script =
    'Get-CimInstance Win32_Process -Filter "Name=\'electron.exe\'" | ' +
    `Where-Object { $_.ExecutablePath -eq '${path}' } | ForEach-Object { $_.ProcessId }`
  const result = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script])
  return result.stdout.split(/\s+/).filter(Boolean).map(Number)
}

/** Stops only this checkout's Electron processes; nothing else is ever touched. */
function stopThreadlight() {
  const ids = threadlightProcesses()
  if (ids.length === 0) return false
  for (const id of ids) {
    try {
      process.kill(id)
    } catch {
      // already gone (a child closes with its parent)
    }
  }
  return true
}

async function hookStatus() {
  try {
    const response = await fetch(`http://127.0.0.1:${HOOK_PORT}/status`, {
      signal: AbortSignal.timeout(1000),
    })
    return response.ok ? await response.json() : null
  } catch {
    return null
  }
}

async function waitForApp(seconds) {
  for (let i = 0; i < seconds * 4; i++) {
    const status = await hookStatus()
    if (status?.app === 'threadlight') return status
    await new Promise((done) => setTimeout(done, 250))
  }
  return null
}

function startThreadlight() {
  const electron = electronPath()
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(electron, ['.'], { cwd: REPO, env, detached: true, stdio: 'ignore' })
  child.unref()
}

function pluginState(cli) {
  const plugins = lastJson(claude(cli, ['plugin', 'list', '--json']).stdout) ?? []
  const marketplaces =
    lastJson(claude(cli, ['plugin', 'marketplace', 'list', '--json']).stdout) ?? []
  return {
    plugin: Array.isArray(plugins) ? plugins.find((p) => p.id === PLUGIN) : undefined,
    marketplace: Array.isArray(marketplaces)
      ? marketplaces.find((m) => m.name === MARKETPLACE)
      : undefined,
  }
}

const samePath = (a, b) =>
  typeof a === 'string' && resolve(a).toLowerCase() === resolve(b).toLowerCase()

/** What this script added, so uninstalling removes only that. Flags only ever turn on. */
function record(changes) {
  const current = readJson(RECORD_FILE) ?? { version: 1, repo: REPO, added: {} }
  for (const [key, value] of Object.entries(changes)) if (value) current.added[key] = true
  current.updatedAt = new Date().toISOString()
  writeJson(RECORD_FILE, current)
}

// ---------- checks shared by install and --check ----------

/** Returns the Claude CLI path, or stops with a clear reason. */
function preflight({ strict }) {
  step('Checking this PC')
  const problem = strict ? fail : bad
  if (process.platform !== 'win32') return problem('Threadlight runs on Windows only.')
  const build = Number(release().split('.')[2])
  if (build < MIN_WINDOWS_BUILD) problem('Needs Windows 10 version 1803 or later, or Windows 11.')
  else ok(`Windows (build ${build})`)
  const [major, minor] = process.versions.node.split('.').map(Number)
  if (major < 22 || (major === 22 && minor < 16))
    problem(`Needs Node 22.16 or later (this is ${process.versions.node}).`)
  else ok(`Node ${process.versions.node}`)
  const curl = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'curl.exe')
  if (!existsSync(curl)) problem('curl.exe is missing from Windows; the hooks need it.')
  else ok('curl.exe (used by the hooks)')
  if (!existsSync(CLAUDE_APP_DIR)) problem('The Claude desktop app does not seem to be installed.')
  else ok('Claude desktop app')
  const cli = findClaude()
  if (!cli) problem('Claude Code (the `claude` command) was not found.')
  else ok('Claude Code CLI')
  return cli
}

/** Every hotkey free? A key the running Threadlight already holds is fine: it is its own. */
function checkKeys(keys) {
  const answers = setup('check-keys', ...keys)
  if (!Array.isArray(answers)) fail('Could not check hotkeys: build the app first (npm run build).')
  const current = readJson(SETTINGS_FILE)?.talkHotkey ?? 'Control+Alt+Q'
  const running = threadlightProcesses().length > 0
  const reasons = {
    taken: 'already used by another program',
    'needs-modifier': 'add Ctrl, Alt or Win',
    invalid: 'not a key combination Windows understands',
  }
  let allFree = true
  for (const answer of answers) {
    const own = !answer.ok && answer.reason === 'taken' && running && answer.accelerator === current
    if (answer.ok || own)
      ok(`${answer.accelerator} is free${own ? ' (Threadlight holds it now)' : ''}`)
    else {
      bad(`${answer.accelerator}: ${reasons[answer.reason] ?? answer.reason}`)
      allFree = false
    }
  }
  return allFree
}

// ---------- the three modes ----------

async function install(options) {
  const cli = preflight({ strict: true })
  const added = {}
  try {
    await installSteps(options, cli, added)
  } finally {
    // Kept even when a step fails, so --uninstall still knows what to take back.
    if (Object.keys(added).length > 0) record(added)
  }
}

async function installSteps(options, cli, added) {
  step('Building the app')
  if (!electronPath()) {
    say('  … npm ci (installs the app’s packages into node_modules)')
    const result = run('npm', ['ci'], { shell: true })
    if (result.status !== 0) fail(`npm ci failed:\n${result.stderr.trim()}`)
    added.packages = true
  }
  ok('Packages installed')
  if (!buildIsCurrent()) {
    say('  … npm run build')
    const result = run('npm', ['run', 'build'], { shell: true })
    if (result.status !== 0) fail(`The build failed:\n${result.stderr.trim()}`)
  }
  ok('App built')

  if (options.hotkey) {
    step('Checking the talk hotkey')
    if (!checkKeys([options.hotkey])) fail('Pick another talk hotkey and run this again.')
  }

  step('Settings')
  const existing = readJson(SETTINGS_FILE)
  const changes = {
    ...(options.hotkey && { talkHotkey: options.hotkey }),
    ...(options.talkMode && { talkMode: options.talkMode }),
    ...(options.countdown && { voiceCountdownSeconds: options.countdown }),
    ...(options.autostart !== undefined && { launchAtSignIn: options.autostart }),
  }
  // A running copy would keep its old settings in memory and save over these.
  if ((Object.keys(changes).length > 0 || options.corner) && stopThreadlight()) {
    say('  … stopped the running Threadlight, to apply the changes')
  }
  if (Object.keys(changes).length > 0 || !existing) {
    writeJson(SETTINGS_FILE, { ...(existing ?? {}), version: SETTINGS_VERSION, ...changes })
    if (!existing) added.settings = true
    for (const [key, value] of Object.entries(changes)) ok(`${key}: ${value}`)
  }
  ok(`Saved in ${SETTINGS_FILE}`)
  if (options.corner) {
    const point = setup('corner', options.corner)
    writeJson(WINDOW_FILE, { dot: point })
    ok(`Dot in the ${options.corner} corner`)
  }

  step('Hooks (the Claude Code plugin)')
  let { plugin, marketplace } = pluginState(cli)
  if (marketplace && !samePath(marketplace.path ?? marketplace.installLocation, REPO)) {
    fail(
      `A "${MARKETPLACE}" plugin source already points at ${marketplace.path ?? marketplace.source}. ` +
        `Remove it first: claude plugin marketplace remove ${MARKETPLACE}`,
    )
  }
  if (!marketplace) {
    say('  … claude plugin marketplace add <this folder>')
    const result = claude(cli, ['plugin', 'marketplace', 'add', REPO])
    if (result.status !== 0) fail(`Could not add the plugin source:\n${result.stderr.trim()}`)
    added.marketplace = true
  }
  if (!plugin) {
    say(`  … claude plugin install ${PLUGIN} --scope user`)
    const result = claude(cli, ['plugin', 'install', PLUGIN, '--scope', 'user'])
    if (result.status !== 0) fail(`Could not install the plugin:\n${result.stderr.trim()}`)
    added.plugin = true
  } else if (plugin.enabled === false) {
    say(`  … claude plugin enable ${PLUGIN}`)
    claude(cli, ['plugin', 'enable', PLUGIN])
  }
  ;({ plugin } = pluginState(cli))
  if (!plugin) fail('The plugin did not install.')
  ok('Hooks installed; sessions started from now on report to Threadlight')

  step('Start at sign-in')
  const launch = readJson(SETTINGS_FILE)?.launchAtSignIn === true
  // The app applies the setting each time it starts; with --no-start it is applied here.
  if (options.noStart) setup('login', launch ? 'on' : 'off')
  ok(launch ? 'On' : 'Off')

  if (options.noStart) {
    step('Not started (--no-start). Start it with: npm start')
  } else {
    step('Starting Threadlight')
    if (threadlightProcesses().length === 0) startThreadlight()
    const status = await waitForApp(15)
    if (status) ok(`Running (version ${status.version})`)
    else warn('Started, but it has not answered yet. Look for the dot or the tray icon.')
  }

  step('Done. To undo all of this: node scripts/install.mjs --uninstall')
  say('The speech model (76 MB) downloads the first time you use voice, after you agree to it.')
}

async function check() {
  const cli = preflight({ strict: false })

  step('App')
  if (!electronPath()) bad('Packages not installed (npm ci)')
  else ok('Packages installed')
  if (!built()) bad('Not built (npm run build)')
  else if (!buildIsCurrent()) warn('Built, but older than the source (npm run build)')
  else ok('Built')

  step('Settings')
  const settings = readJson(SETTINGS_FILE)
  if (!settings) warn(`None yet; defaults apply (${SETTINGS_FILE})`)
  else {
    ok(`Talk hotkey ${settings.talkHotkey ?? 'Control+Alt+Q'} (${settings.talkMode ?? 'toggle'})`)
    ok(
      `Send countdown ${settings.voiceCountdownSeconds ?? 5} s${settings.voiceHold ? ', on Hold' : ''}`,
    )
  }
  const login = setup('login')
  if (login)
    ok(`Start at sign-in: ${login.openAtLogin ? 'wait quietly for Claude or Codex' : 'off'}`)

  step('Hooks')
  if (cli) {
    const { plugin, marketplace } = pluginState(cli)
    if (!plugin) bad(`Plugin not installed (${PLUGIN})`)
    else if (plugin.enabled === false) bad('Plugin installed but turned off')
    else ok('Plugin installed and on')
    if (marketplace && !samePath(marketplace.path ?? marketplace.installLocation, REPO)) {
      warn(`The plugin source points at another folder: ${marketplace.path ?? marketplace.source}`)
    }
    const auth = lastJson(claude(cli, ['auth', 'status', '--json']).stdout)
    if (auth?.loggedIn === true) ok('Signed in to Claude Code')
    else bad('Not signed in to Claude Code: run `claude auth login` (sending needs it)')
  }

  step('Running')
  const status = await hookStatus()
  if (!status) warn('Threadlight is not running (npm start)')
  else {
    ok(`Threadlight ${status.version} is running`)
    if (status.hookEvents > 0) ok(`${status.hookEvents} hook events received since it started`)
    else warn('No hook events yet: send a prompt in any Claude session, then check again')
  }
}

async function uninstall(options) {
  const done = readJson(RECORD_FILE)?.added ?? {}

  step('Stopping Threadlight')
  ok(stopThreadlight() ? 'Stopped' : 'Was not running')

  step('Start at sign-in')
  if (setup('login', 'off')) ok('Off')
  else warn('Could not check (the app is not built); turn it off in Settings first if it was on')

  step('Hooks')
  const cli = findClaude()
  if (!cli) warn('Claude Code was not found, so the plugin was left as it is')
  else {
    const { plugin, marketplace } = pluginState(cli)
    if (plugin && done.plugin) {
      claude(cli, ['plugin', 'uninstall', PLUGIN, '--scope', 'user'])
      ok('Plugin removed')
    } else if (plugin) {
      warn(`Plugin left in place (not added by this script): claude plugin uninstall ${PLUGIN}`)
    }
    if (marketplace && done.marketplace) {
      claude(cli, ['plugin', 'marketplace', 'remove', MARKETPLACE])
      ok('Plugin source removed')
    } else if (marketplace) {
      warn(`Plugin source left in place: claude plugin marketplace remove ${MARKETPLACE}`)
    }
  }

  step('Your data')
  if (options.removeData) {
    // Threadlight's own folder: settings, dot position, speech model, the app's caches.
    rmSync(DATA_DIR, { recursive: true, force: true })
    ok(`Removed ${DATA_DIR}`)
  } else {
    rmSync(RECORD_FILE, { force: true })
    ok(`Kept settings and the speech model in ${DATA_DIR} (add --remove-data to delete them)`)
  }
  say('\nThis folder, its node_modules and out were left alone; delete the folder to finish.')
}

function help() {
  say(
    readFileSync(fileURLToPath(import.meta.url), 'utf8')
      .split('\n')
      .slice(1, 13)
      .join('\n'),
  )
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.mode === 'help') return help()
  if (options.mode === 'check') return check()
  if (options.mode === 'uninstall') return uninstall(options)
  if (options.mode === 'check-keys') {
    if (options.keys.length === 0) fail('--check-keys needs at least one key, e.g. Control+Alt+Q')
    step('Hotkeys')
    if (!checkKeys(options.keys)) process.exitCode = 1
    return
  }
  return install(options)
}

main().catch((error) => {
  if (!(error instanceof Stop)) console.error(error)
  process.exitCode = 1
})
