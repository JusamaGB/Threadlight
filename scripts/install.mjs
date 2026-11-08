#!/usr/bin/env node
// Sets Threadlight up from this source checkout: the setup skill (skills/setup/SKILL.md) runs
// it, and people can too. Every step says what it does; running it again changes nothing that
// is already right; uninstalling removes only what this script added (see install.json).
//
//   node scripts/install.mjs [--providers claude,codex] [--hotkey Control+Alt+Q] [--talk-mode toggle|hold]
//                            [--countdown 1-10] [--corner top-right|top-left|bottom-right|bottom-left]
//                            [--autostart | --no-autostart] [--no-start]
//   node scripts/install.mjs --check                 diagnose only; changes nothing
//   node scripts/install.mjs --check-keys <key>…     which hotkeys are free
//   node scripts/install.mjs --uninstall [--remove-data]
//
// Plain Node (22.16+), no dependencies of its own, so it runs before `npm ci`.

import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  createReadStream,
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
const bad = (text) => {
  process.exitCode = 1
  say(`  ✗ ${text}`)
}
const step = (text) => say(`\n${text}`)

class Stop extends Error {}
/** Ends the run with a message and exit code 1, before anything else changes. */
function fail(text) {
  bad(text)
  throw new Stop(text)
}

// ---------- arguments ----------

function parseArgs(argv) {
  const options = { keys: [], providers: ['claude'] }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const value = () => {
      const next = argv[++i]
      if (next === undefined || next.startsWith('--')) fail(`${arg} needs a value.`)
      return next
    }
    switch (arg) {
      case '--providers':
        options.providers = [...new Set(value().split(','))]
        if (!options.providers.every((name) => ['claude', 'codex'].includes(name)))
          fail('Choose claude or codex, separated by commas.')
        options.explicitProviders = true
        break
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
  try {
    return JSON.parse(text)
  } catch {
    // Some CLI commands put a compact JSON record after informational lines.
  }
  for (const line of text.trim().split(/\r?\n/).reverse()) {
    try {
      return JSON.parse(line)
    } catch {
      // not JSON; keep looking
    }
  }
  return null
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

function findCodex() {
  const bin = join(
    process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'),
    'OpenAI',
    'Codex',
    'bin',
  )
  if (existsSync(bin)) {
    const installs = readdirSync(bin)
      .map((name) => join(bin, name, 'codex.exe'))
      .filter(existsSync)
    installs.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
    if (installs.length) return installs[0]
  }
  return run('where.exe', ['codex.exe']).stdout.trim().split(/\r?\n/).find(existsSync)
}

const CODEX_PLUGIN = 'threadlight-codex@threadlight-local'
function codexPlugin(cli, ...args) {
  // Outside the checkout the listing reports registered marketplaces independently
  // of the implicit project marketplace visible when Codex starts in this repo.
  const result = run(cli, ['plugin', ...args], { cwd: homedir() })
  if (result.status !== 0)
    fail(result.stderr.trim() || result.error?.message || 'Codex plugin command failed.')
  return result.stdout
}
function codexSource(cli) {
  return JSON.parse(codexPlugin(cli, 'marketplace', 'list', '--json')).marketplaces.find(
    (m) => m.name === 'threadlight-local',
  )
}
function codexInstalled(cli) {
  return JSON.parse(
    codexPlugin(cli, 'list', '--marketplace', 'threadlight-local', '--json'),
  ).installed.find((p) => p.pluginId === CODEX_PLUGIN)
}
function installCodex(cli, added) {
  step('Codex plugin')
  const source = codexSource(cli)
  if (source && !matchesSource(source.root))
    fail('threadlight-local belongs to another source. Review it in Codex plugin settings.')
  if (!source) {
    codexPlugin(cli, 'marketplace', 'add', REPO)
    added.codexMarketplace = true
  }
  const expected = readJson(join(REPO, 'codex-plugin', 'plugin.json')).version
  const installed = codexInstalled(cli)
  if (!installed || installed.version !== expected) {
    codexPlugin(cli, 'add', CODEX_PLUGIN)
    if (!installed) added.codexPlugin = true
  }
  const plugin = codexInstalled(cli)
  if (!plugin?.enabled) fail('Enable the Threadlight plugin in Codex and rerun the check.')
  if (plugin.version !== expected)
    fail('Refresh the Codex marketplace to the same version as this checkout.')
  ok('Codex plugin installed. Review its hooks in /hooks and open a new chat.')
}

function electronPath() {
  const pkg = join(REPO, 'node_modules', 'electron')
  try {
    const dist = process.env.ELECTRON_OVERRIDE_DIST_PATH || join(pkg, 'dist')
    const exe = join(dist, readFileSync(join(pkg, 'path.txt'), 'utf8').trim())
    return existsSync(exe) && statSync(exe).isFile() ? exe : null
  } catch {
    return null
  }
}

// A fresh Windows profile can build the app but fail to load Electron's native
// ZIP extractor. Windows tar can extract the same pinned archive.
async function ensureElectron() {
  if (electronPath()) return
  if (process.env.ELECTRON_OVERRIDE_DIST_PATH)
    fail(
      'The configured Electron override is missing its executable. Check ELECTRON_OVERRIDE_DIST_PATH.',
    )
  const pkg = join(REPO, 'node_modules', 'electron')
  const require = createRequire(join(pkg, 'package.json'))
  const { version } = require('./package.json')
  const checksums = require('./checksums.json')
  const name = `electron-v${version}-win32-${process.arch}.zip`
  if (!checksums[name]) fail(`No pinned Electron archive for ${process.arch}.`)
  step('Installing the Windows desktop runtime')
  const archive = await require('@electron/get').downloadArtifact({
    version,
    artifactName: 'electron',
    platform: 'win32',
    arch: process.arch,
    checksums,
    cacheRoot: process.env.electron_config_cache,
  })
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(archive)) hash.update(chunk)
  if (hash.digest('hex') !== checksums[name]) fail('Electron archive checksum mismatch.')
  const dist = join(pkg, 'dist')
  mkdirSync(dist, { recursive: true })
  const result = run(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'), [
    '-xf',
    archive,
    '-C',
    dist,
  ])
  if (result.status !== 0)
    fail(result.error?.message || result.stderr || 'Could not extract Electron.')
  if (
    !existsSync(join(dist, 'electron.exe')) ||
    readFileSync(join(dist, 'version'), 'utf8').trim().replace(/^v/, '') !== version
  )
    fail('The extracted Electron runtime is incomplete.')
  writeFileSync(join(pkg, 'path.txt'), 'electron.exe')
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

function matchesSource(path) {
  if (samePath(path, REPO)) return true
  if (!path || !existsSync(path)) return false
  const origin = run('git', ['remote', 'get-url', 'origin'], { cwd: path })
  return (
    origin.status === 0 &&
    /^(?:https:\/\/github\.com\/|git@github\.com:)JusamaGB\/Threadlight(?:\.git)?$/i.test(
      origin.stdout.trim(),
    )
  )
}

/** What this script added, so uninstalling removes only that. Flags only ever turn on. */
function record(changes) {
  const current = readJson(RECORD_FILE) ?? { version: 1, repo: REPO, added: {} }
  for (const [key, value] of Object.entries(changes)) if (value) current.added[key] = true
  current.updatedAt = new Date().toISOString()
  writeJson(RECORD_FILE, current)
}

// ---------- checks shared by install and --check ----------

/** Returns the Claude CLI path, or stops with a clear reason. */
function preflight({ strict, providers }) {
  step('Checking this PC')
  const problem = strict ? fail : bad
  if (process.platform !== 'win32') fail('Threadlight runs on Windows only.')
  const build = Number(release().split('.')[2])
  if (build < MIN_WINDOWS_BUILD) problem('Needs Windows 10 version 1803 or later, or Windows 11.')
  else ok(`Windows (build ${build})`)
  const [major, minor] = process.versions.node.split('.').map(Number)
  if (major < 22 || (major === 22 && minor < 16))
    problem(`Needs Node 22.16 or later (this is ${process.versions.node}).`)
  else ok(`Node ${process.versions.node}`)
  const commands = {}
  if (providers.includes('codex')) {
    commands.codex = findCodex()
    if (!commands.codex) problem('Install the native Codex CLI and open a new terminal.')
    else ok('Codex CLI')
  }
  {
    const curl = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'curl.exe')
    if (!existsSync(curl)) problem('curl.exe is missing from Windows; the hooks need it.')
    else ok('curl.exe (used by the hooks)')
  }
  if (providers.includes('claude')) {
    if (!existsSync(CLAUDE_APP_DIR))
      problem('The Claude desktop app does not seem to be installed.')
    else ok('Claude desktop app')
    const cli = findClaude()
    if (!cli) problem('Claude Code (the `claude` command) was not found.')
    else ok('Claude Code CLI')
    commands.claude = cli
  }
  return commands
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
  const cli = preflight({ strict: true, providers: options.providers })
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
  if (
    !existsSync(join(REPO, 'node_modules', 'electron', 'package.json')) ||
    !existsSync(join(REPO, 'node_modules', 'electron-vite', 'package.json'))
  ) {
    say('  … npm ci (installs the app’s packages into node_modules)')
    const result = run('npm', ['ci'], { shell: true })
    if (result.status !== 0) fail(`npm ci failed:\n${result.stderr.trim()}`)
    added.packages = true
  }
  ok('Packages installed')
  await ensureElectron()
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
    ...(!existing &&
      options.explicitProviders && {
        enabledProviders: options.providers,
        agentProvider: options.providers.includes('codex') ? 'codex' : 'claude',
      }),
    ...(options.hotkey && { talkHotkey: options.hotkey }),
    ...(options.talkMode && { talkMode: options.talkMode }),
    ...(options.countdown && { voiceCountdownSeconds: options.countdown }),
    ...(options.autostart !== undefined && { launchAtSignIn: options.autostart }),
  }
  // A running copy would keep its old settings in memory and save over these.
  if ((Object.keys(changes).length > 0 || options.corner) && threadlightProcesses().length) {
    fail(
      'Finish current work and quit Threadlight from the tray before applying setup preferences.',
    )
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

  if (cli.claude) installClaude(cli.claude, added)
  if (cli.codex) installCodex(cli.codex, added)

  step('Start at sign-in')
  const launch = readJson(SETTINGS_FILE)?.launchAtSignIn === true
  // The app applies the setting each time it starts; with --no-start it is applied here.
  if (options.noStart && options.autostart !== undefined) setup('login', launch ? 'on' : 'off')
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
  say('Open Settings to check your selected providers and voice preferences.')
}

function installClaude(cli, added) {
  step('Hooks (the Claude Code plugin)')
  let { plugin, marketplace } = pluginState(cli)
  if (marketplace && !matchesSource(marketplace.path ?? marketplace.installLocation)) {
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
  } else if (plugin.version !== readJson(join(REPO, '.claude-plugin', 'plugin.json')).version) {
    const result = claude(cli, ['plugin', 'update', PLUGIN])
    if (result.status !== 0) fail(result.stderr.trim() || 'Claude plugin update failed.')
  }
  if (plugin?.enabled === false) {
    say(`  … claude plugin enable ${PLUGIN}`)
    claude(cli, ['plugin', 'enable', PLUGIN])
  }
  ;({ plugin } = pluginState(cli))
  if (
    !plugin?.enabled ||
    plugin.version !== readJson(join(REPO, '.claude-plugin', 'plugin.json')).version
  )
    fail('Verify the Claude plugin is enabled and its marketplace matches this checkout version.')
  ok('Hooks installed; sessions started from now on report to Threadlight')
}

async function check(options) {
  const cli = preflight({ strict: false, providers: options.providers })

  step('App')
  if (!electronPath())
    bad('Desktop runtime missing. Run source setup again with the selected providers.')
  else ok('Desktop runtime installed')
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
  if (cli.codex) {
    const source = codexSource(cli.codex)
    if (!source || !matchesSource(source.root))
      bad('Register the Codex marketplace from this checkout.')
    else {
      const plugin = codexInstalled(cli.codex)
      if (!plugin?.enabled) bad('Install or enable the Threadlight Codex plugin.')
      else if (plugin.version !== readJson(join(REPO, 'codex-plugin', 'plugin.json')).version)
        bad('Run setup again to update the installed Codex plugin.')
      else ok('Codex plugin installed and enabled. Review hook trust in /hooks.')
    }
    const signedIn = run(cli.codex, ['login', 'status'])
    if (signedIn.status === 0) ok('Signed in to Codex')
    else warn('Check sign-in with codex login status.')
  }
  if (cli.claude) {
    const { plugin, marketplace } = pluginState(cli.claude)
    if (!plugin) bad(`Plugin not installed (${PLUGIN})`)
    else if (plugin.enabled === false) bad('Plugin installed but turned off')
    else if (plugin.version !== readJson(join(REPO, '.claude-plugin', 'plugin.json')).version)
      bad('Run setup again to update the installed Claude plugin.')
    else ok('Plugin installed and on')
    if (marketplace && !matchesSource(marketplace.path ?? marketplace.installLocation)) {
      warn(`The plugin source points at another folder: ${marketplace.path ?? marketplace.source}`)
    }
    const auth = lastJson(claude(cli.claude, ['auth', 'status', '--json']).stdout)
    if (auth?.loggedIn === true) ok('Signed in to Claude Code')
    else bad('Not signed in to Claude Code: run `claude auth login` (sending needs it)')
  }

  step('Running')
  const status = threadlightProcesses().length ? await hookStatus() : null
  if (!status)
    warn('This checkout has no confirmed running Threadlight app. Open it and check the tray.')
  else {
    ok(`Threadlight ${status.version} is running`)
    if (status.hookEvents > 0) ok(`${status.hookEvents} hook events received since it started`)
    else if (cli.claude)
      warn('No Claude hook events yet. Start a new Claude session after installation.')
  }
}

async function uninstall(options) {
  const done = readJson(RECORD_FILE)?.added ?? {}

  step('Stopping Threadlight')
  ok(stopThreadlight() ? 'Stopped' : 'Was not running')

  step('Start at sign-in')
  if (readJson(SETTINGS_FILE)?.launchAtSignIn) {
    if (setup('login', 'off')) ok('Off')
    else warn('Could not check (the app is not built); turn it off in Settings first if it was on')
  }

  step('Hooks')
  if (done.codexPlugin || done.codexMarketplace) {
    const codex = findCodex()
    if (!codex) fail('Restore the Codex CLI to remove the recorded Codex installation.')
    const source = codexSource(codex)
    if (
      source &&
      (done.codexMarketplace ? !samePath(source.root, REPO) : !matchesSource(source.root))
    )
      fail('The registered Codex marketplace now belongs to a different checkout.')
    if (source && done.codexPlugin && codexInstalled(codex))
      codexPlugin(codex, 'remove', CODEX_PLUGIN)
    if (source && done.codexMarketplace)
      codexPlugin(codex, 'marketplace', 'remove', 'threadlight-local')
  }
  const cli = (done.plugin || done.marketplace) && findClaude()
  if (!cli && (done.plugin || done.marketplace))
    fail('Restore the Claude Code CLI to remove the recorded installation.')
  else if (cli) {
    const { plugin, marketplace } = pluginState(cli)
    if (marketplace && !matchesSource(marketplace.path ?? marketplace.installLocation))
      fail('The registered Claude marketplace now belongs to a different checkout.')
    if (plugin && done.plugin) {
      const result = claude(cli, ['plugin', 'uninstall', PLUGIN, '--scope', 'user'])
      if (result.status !== 0) fail(result.stderr.trim() || 'Claude plugin removal failed.')
      ok('Plugin removed')
    } else if (plugin) {
      warn(`Plugin left in place (not added by this script): claude plugin uninstall ${PLUGIN}`)
    }
    if (marketplace && done.marketplace) {
      const result = claude(cli, ['plugin', 'marketplace', 'remove', MARKETPLACE])
      if (result.status !== 0) fail(result.stderr.trim() || 'Claude marketplace removal failed.')
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
  if (options.mode === 'check') return check(options)
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
