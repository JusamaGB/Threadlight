// Isolated KimiSettings + disposable SettingsStore. Default: browser with mocked IPC.
// Opt-in --electron: actual preload/main IPC. Existing dependencies only; never launches Kimi.
// Add --review to keep the real Settings layout open with an isolated temporary profile.
/* global window, document */
import assert from 'node:assert/strict'
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  existsSync,
  readdirSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { createServer, build } from 'vite'
import react from '@vitejs/plugin-react'

const require = createRequire(import.meta.url)
const ts = require('typescript')
require.extensions['.ts'] = (module, filename) =>
  module._compile(
    ts.transpileModule(readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    filename,
  )
const root = fileURLToPath(new URL('../../', import.meta.url))
if (process.argv.includes('--electron')) {
  await runNativeSettingsProof()
  process.exit(0)
}
const { SettingsStore } = require(join(root, 'src/main/settings.ts'))
const { kimiSetupKey } = require(join(root, 'src/shared/kimi.ts'))
const { chromium } = require(process.env.THREADLIGHT_PLAYWRIGHT || 'playwright')
const scratch = mkdtempSync(join(tmpdir(), 'threadlight-kimi-ui-'))
const store = new SettingsStore(join(scratch, 'state'))
await store.load()
await store.update({ shownProviders: ['claude', 'perplexity', 'kimi'] })
const output = process.env.THREADLIGHT_SCREENSHOTS
if (output) mkdirSync(output, { recursive: true })
const fullSettings = process.env.THREADLIGHT_KIMI_FULL_SETTINGS === '1'
const componentName = fullSettings ? 'SettingsView' : 'KimiSettings'
const component = join(root, `src/renderer/settings/${componentName}.tsx`).replaceAll('\\', '/')
const theme = join(root, 'src/renderer/theme.css').replaceAll('\\', '/')
writeFileSync(
  join(scratch, 'index.html'),
  '<html><body style="background:#171717;margin:0"><div id="root"></div><script type="module" src="/fixture.tsx"></script></body></html>',
)
writeFileSync(
  join(scratch, 'fixture.tsx'),
  `
import React, {useState, useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import {${componentName}} from ${JSON.stringify(component)};
import ${JSON.stringify(theme)};
window.threadlight = {inspectKimiLocalRuntime: (setup) => window.inspectFixture(setup)};
function Fixture() {
  const [settings, setSettings] = useState(null), [open, setOpen] = useState(true);
  useEffect(() => { window.readFixture().then(setSettings) }, []);
  if (!settings) return null;
  window.threadlight.updateSettings = async patch => {
    const result = await window.saveFixture(patch);
    if (result.ok) setSettings(result.settings);
    return result;
  };
  return <><button onClick={() => setOpen(!open)}>{open ? 'Close Settings' : 'Open Settings'}</button>
    {open && ${
      fullSettings
        ? '<SettingsView settings={settings} stt={{state:"missing"}} version="synthetic" onPickWorkspace={() => {}} />'
        : `<KimiSettings key={JSON.stringify(settings.kimiSetup)} setup={settings.kimiSetup} save={async patch => {
      const result = await window.saveFixture(patch);
      if (result.ok) setSettings(result.settings);
      return result.ok;
    }}/>`
    }}</>;
}

createRoot(document.getElementById('root')).render(<Fixture/>);
`,
)
let browser, server, page
let inspections = 0,
  saves = 0,
  failSave = false,
  delayInspection = false,
  releaseInspection
let inspectionStatus = 'verified'
const errors = [],
  unexpectedRequests = []
try {
  server = await createServer({
    configFile: false,
    root: scratch,
    plugins: [react()],
    resolve: {
      alias: {
        'react-dom/client': require.resolve('react-dom/client'),
        'react-dom': require.resolve('react-dom'),
        'react/jsx-dev-runtime': require.resolve('react/jsx-dev-runtime'),
        'react/jsx-runtime': require.resolve('react/jsx-runtime'),
        react: require.resolve('react'),
      },
    },
    server: { host: '127.0.0.1', port: 0, fs: { allow: [root, scratch] } },
  })
  await server.listen()
  const address = server.httpServer.address()
  const origin = `http://127.0.0.1:${address.port}`
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.THREADLIGHT_CHROMIUM || undefined,
  })
  page = await browser.newPage({ viewport: { width: 340, height: 780 } })
  page.on('pageerror', (error) => errors.push(String(error)))
  await page.route('**/*', (route) => {
    if (
      !route
        .request()
        .url()
        .startsWith(origin + '/')
    ) {
      unexpectedRequests.push(route.request().url())
      return route.abort()
    }
    return route.continue()
  })
  await page.exposeFunction('readFixture', () => new SettingsStore(join(scratch, 'state')).load())
  await page.exposeFunction('saveFixture', async (patch) => {
    saves++
    return failSave ? { ok: false, reason: 'Synthetic refusal' } : store.update(patch)
  })
  await page.exposeFunction('inspectFixture', async (setup) => {
    inspections++
    if (delayInspection)
      await new Promise((done) => {
        releaseInspection = done
      })
    return {
      configurationKey: kimiSetupKey(setup),
      checkedAt: new Date().toISOString(),
      status: inspectionStatus,
      detail: 'Synthetic verified package result; model not checked.',
    }
  })
  const capture = async (name) => {
    if (output) await page.screenshot({ path: join(output, `${name}.png`), fullPage: true })
  }
  const select = (label, value) => page.getByLabel(label, { exact: true }).selectOption(value)
  const fill = (label, value) => page.getByLabel(label, { exact: true }).fill(value)
  const save = () =>
    page.getByRole('button', { name: 'Save Kimi configuration', exact: true }).click()
  await page.goto(origin)
  await page.getByRole('region', { name: 'Kimi setup' }).waitFor()
  assert.equal(inspections, 0)
  await capture('kimi-empty')
  await fill('Model endpoint', 'http://localhost:8000/v1')
  await fill('Exact model ID', 'vendor/Exact-model:Q4')
  await fill('Kimi Code package folder', 'C:\\Synthetic\\kimi-code')
  await save()
  await page.getByText('Saved', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Close Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Open Settings', exact: true }).click()
  assert.equal(
    await page.getByLabel('Exact model ID', { exact: true }).inputValue(),
    'vendor/Exact-model:Q4',
  )
  await page.reload()
  await page.getByRole('region', { name: 'Kimi setup' }).waitFor()
  assert.equal(
    await page.getByLabel('Model endpoint', { exact: true }).inputValue(),
    'http://localhost:8000/v1',
  )
  assert.equal(inspections, 0)
  inspectionStatus = 'missing'
  await page.getByRole('button', { name: 'Inspect local runtime', exact: true }).click()
  await page.getByText('Missing', { exact: true }).waitFor()
  inspectionStatus = 'unverified'
  await page.getByRole('button', { name: 'Inspect local runtime', exact: true }).click()
  await page.getByText('Unverified', { exact: true }).waitFor()
  inspectionStatus = 'verified'
  await page.getByRole('button', { name: 'Inspect local runtime', exact: true }).click()
  await page.getByText('Version verified', { exact: true }).waitFor()
  await capture('kimi-local')
  delayInspection = true
  await page.getByRole('button', { name: 'Inspect local runtime', exact: true }).click()
  await fill('Exact model ID', 'changed-model')
  await page.waitForFunction(() => document.body.innerText.includes('Runtime not checked'))
  assert.ok(releaseInspection)
  releaseInspection()
  delayInspection = false
  await page.waitForTimeout(100)
  assert.equal(await page.getByText('Version verified', { exact: true }).count(), 0)
  await select('Agent execution location', 'server')
  await fill('Agent server hostname', 'agent.example')
  await page
    .getByText('A loopback model address would refer to the agent server, not this computer.', {
      exact: true,
    })
    .waitFor()
  assert.equal(
    await page.getByRole('button', { name: 'Inspect local runtime', exact: true }).count(),
    0,
  )
  await save()
  await page.getByText('Saved', { exact: true }).waitFor()
  await capture('kimi-server-agent')
  await select('Model connection', 'server')
  await fill('Model endpoint', 'https://user:password@model.example/v1')
  await page.getByRole('alert').waitFor()
  assert.equal(
    await page.getByRole('button', { name: 'Save Kimi configuration', exact: true }).isEnabled(),
    false,
  )
  await fill('Model endpoint', 'https://models.example/v1')
  await fill('Exact model ID', 'server-model-exact')
  await select('Authentication', 'external-api-key')
  await select('Agent execution location', 'local')
  await fill('Kimi Code package folder', 'C:\\Synthetic\\kimi-code')
  failSave = true
  await save()
  await page
    .getByText('Could not save Kimi configuration. Your draft is still here.', { exact: true })
    .waitFor()
  assert.equal(
    await page.getByLabel('Exact model ID', { exact: true }).inputValue(),
    'server-model-exact',
  )
  failSave = false
  await save()
  await page.getByText('Saved', { exact: true }).waitFor()
  await page.reload()
  await page.getByRole('region', { name: 'Kimi setup' }).waitFor()
  assert.equal(await page.getByLabel('Model connection', { exact: true }).inputValue(), 'server')
  assert.equal(
    await page.getByLabel('Agent execution location', { exact: true }).inputValue(),
    'local',
  )
  await capture('kimi-server-model')
  await select('Model connection', 'moonshot')
  await fill('Exact model ID', 'user-supplied-model')
  await save()
  await page.getByText('Saved', { exact: true }).waitFor()
  await page.reload()
  await page.getByRole('region', { name: 'Kimi setup' }).waitFor()
  assert.equal(await page.getByLabel('Model connection', { exact: true }).inputValue(), 'moonshot')
  await page.getByText('Connection details', { exact: true }).click()
  await capture('kimi-moonshot')
  // Narrow and long-content states, including keyboard navigation and horizontal clipping.
  await page.setViewportSize({ width: 300, height: 650 })
  await fill('Exact model ID', 'vendor/' + 'long-model-'.repeat(12))
  await page.getByRole('button', { name: 'Save Kimi configuration', exact: true }).focus()
  await page.keyboard.press('Enter')
  await page.getByText('Saved', { exact: true }).waitFor()
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
  assert.equal(await page.getByText('Connected', { exact: true }).count(), 0)
  assert.equal(await page.getByText('Ready', { exact: true }).count(), 0)
  assert.equal(inspections, 4)
  assert.deepEqual(unexpectedRequests, [])
  assert.deepEqual(errors, [])
  assert.equal(store.settings.agentProvider, 'claude')
  assert.deepEqual(store.settings.enabledProviders, ['claude'])
  console.log(
    JSON.stringify({
      status: 'PASS',
      saves,
      inspections,
      ipc: 'mocked',
      surface: fullSettings ? 'SettingsView' : 'KimiSettings',
      persistence: 'actual disposable SettingsStore',
      endpointCalls: 0,
      screenshots: output || null,
    }),
  )
} catch (error) {
  console.error({ errors, unexpectedRequests, body: await page?.locator('body').innerText() })
  throw error
} finally {
  releaseInspection?.()
  await browser?.close()
  await server?.close()
  if (resolve(scratch).startsWith(resolve(tmpdir()) + sep + 'threadlight-kimi-ui-'))
    rmSync(scratch, { recursive: true, force: true })
}

/** Real Electron transport, actual preload, extracted current main handlers and real store.
 * Unrelated app lifecycle effects are inert in this isolated harness; app startup is not run.
 */
async function runNativeSettingsProof() {
  const review = process.argv.includes('--review')
  const workspace = process.argv.includes('--workspace')
  const fullLayout = review || workspace || process.argv.includes('--full-settings')
  const revision = process.env.THREADLIGHT_PREVIEW_REVISION || 'unrecorded'
  assert.ok(!review || revision !== 'unrecorded', 'Review requires an explicit source revision')
  const { _electron } = require(process.env.THREADLIGHT_PLAYWRIGHT || 'playwright')
  const nativeRoot = mkdtempSync(join(tmpdir(), 'threadlight-kimi-native-'))
  const resultPath = process.env.THREADLIGHT_SCREENSHOTS
  if (resultPath) mkdirSync(resultPath, { recursive: true })
  const packagePath = process.env.THREADLIGHT_KIMI_RUNTIME_PACKAGE
  assert.ok(packagePath, 'Explicit THREADLIGHT_KIMI_RUNTIME_PACKAGE is required')
  const sourceText = readFileSync(join(root, 'src/main/index.ts'), 'utf8')
  const source = ts.createSourceFile('index.ts', sourceText, ts.ScriptTarget.Latest, true)
  let updateFunction = '',
    applyLive = ''
  const handlers = new Map()
  const needed = ['IPC.getSettings', 'IPC.updateSettings', 'IPC.inspectKimiLocalRuntime']
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'updateApplicationSettings')
      updateFunction = node.getText(source)
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'applyLive')
      applyLive = `const ${node.getText(source)};`
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(source) === 'ipcMain.handle' &&
      needed.includes(node.arguments[0]?.getText(source))
    )
      handlers.set(
        node.arguments[0].getText(source),
        node.arguments[0].getText(source) === 'IPC.updateSettings'
          ? `ipcMain.handle(IPC.updateSettings, (event, patch) => {
              if (!patch || Object.keys(patch).some(key => key !== 'kimiSetup'))
                return {ok:false,reason:'Only Kimi setup can be changed in this review.'};
              return (${node.arguments[1].getText(source)})(event, patch);
            });`
          : node.getText(source) + ';',
      )
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(
    updateFunction && applyLive && handlers.size === 3,
    'Current actual handlers must be extracted, never replaced by a mocked store API',
  )
  const importPath = (path) => JSON.stringify(join(root, path).replaceAll('\\', '/'))
  writeFileSync(
    join(nativeRoot, 'main.ts'),
    `
import {app, BrowserWindow, ipcMain} from 'electron';
import {join} from 'node:path';
import {SettingsStore} from ${importPath('src/main/settings.ts')};
import {inspectLocalRuntime} from ${importPath('src/main/kimi/runtime.ts')};
import {IPC} from ${importPath('src/shared/ipc.ts')};
import {voiceHotkeyMode} from ${importPath('src/shared/settings.ts')};
app.setPath('userData', ${JSON.stringify(join(nativeRoot, 'app-data'))});
app.whenReady().then(async()=>{
  const settings = new SettingsStore(app.getPath('userData')); await settings.load(); await settings.update({shownProviders:['claude','perplexity','kimi']});
  const panel = new BrowserWindow({show:false,width:${workspace ? 1100 : fullLayout ? 640 : 420},height:850,title:'Threadlight — Kimi ${workspace ? 'workspace preview' : 'Settings review'}',webPreferences:{preload:join(${JSON.stringify(nativeRoot)},'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
  panel.setMenuBarVisibility(false);
  panel.webContents.session.webRequest.onBeforeRequest((request, done)=>done({cancel: /^https?:/.test(request.url)}));
  const windows = {panel, send:(channel,value)=>panel.webContents.send(channel,value)};
  const unexpected = () => {throw Error('Unexpected unrelated lifecycle operation')};
  const tracker={configure:unexpected}, codexTracker=tracker, sessions={refresh:unexpected};
  const publish=()=>{}, reportHotkey=()=>{}, reservedBrainstormHotkey=(value)=>value==='Ctrl+Alt+B';
  const controlSettingsRevision=unexpected, setLaunchAtSignIn=unexpected;
  const hotkey={set:unexpected,setMode:()=>null}; let hotkeyProblem=null;
  const agent={stopLive:unexpected,refreshDefaults:()=>{}}, spaces={stopLive:unexpected};
  const enabled=unexpected, holds={releaseAll:unexpected}, codexHolds=holds, syncPolling=unexpected, SCAN_INTERVAL_MS=1;
  ${applyLive}
  ${updateFunction}
  ${needed.map((key) => handlers.get(key)).join('\n')}
  globalThis.kimiNativeProof={panel, settings};
  await panel.loadFile(join(${JSON.stringify(nativeRoot)},'renderer/index.html'));
});
app.on('window-all-closed',()=>app.quit());
`,
  )
  writeFileSync(
    join(nativeRoot, 'index.html'),
    '<html><body style="background:#171717;margin:0"><div id="root"></div><script type="module" src="/renderer.tsx"></script></body></html>',
  )
  writeFileSync(
    join(nativeRoot, 'renderer.tsx'),
    `
import React,{useState,useEffect} from 'react'; import {createRoot} from 'react-dom/client';
import {${fullLayout ? 'SettingsView' : 'KimiSettings'}} from ${importPath(`src/renderer/settings/${fullLayout ? 'SettingsView' : 'KimiSettings'}.tsx`)};
import ${importPath('src/renderer/theme.css')};
function App(){ const [settings,setSettings]=useState(null);
useEffect(()=>{ if (${fullLayout}) {
  for(const control of document.querySelectorAll('button,input,select')) {
    if (!control.closest('[aria-label="Kimi setup"], [aria-label="Kimi workspace"]')) {control.disabled=true; control.title='Inactive in this isolated review';}
  }
}},[settings]);
useEffect(()=>{
  const off=window.threadlight.onSettings(setSettings); window.threadlight.getSettings().then(setSettings); return off;
},[]); return settings && ${
      fullLayout
        ? `<main style={{maxWidth:1100,margin:'0 auto',padding:16,height:'100vh',overflowY:'auto',boxSizing:'border-box'}}><p style={{fontSize:12,color:'#aaa'}}>Isolated review · temporary data · other settings inactive<br/>Source ${revision.replaceAll('<', '')} · close this window to finish</p><SettingsView settings={settings} stt={{state:'missing'}} version="review" onPickWorkspace={()=>{}} providerLocked /></main>`
        : `<KimiSettings key={JSON.stringify(settings.kimiSetup)} setup={settings.kimiSetup} save={async patch=>{
  const result=await window.threadlight.updateSettings(patch); if(result.ok)setSettings(result.settings); return result.ok;
}}/>`
    }; } createRoot(document.getElementById('root')).render(<App/>);
`,
  )
  let application
  try {
    for (const [entry, filename] of [
      [join(root, 'src/preload/index.ts'), 'preload.cjs'],
      [join(nativeRoot, 'main.ts'), 'main.cjs'],
    ]) {
      await build({
        configFile: false,
        logLevel: 'silent',
        ssr: { noExternal: true, external: ['electron'] },
        build: {
          ssr: true,
          target: 'node22',
          outDir: nativeRoot,
          emptyOutDir: false,
          lib: { entry, formats: ['cjs'], fileName: () => filename },
          rollupOptions: {
            external: ['electron'],
            output: { entryFileNames: filename, format: 'cjs' },
          },
        },
      })
    }
    await build({
      configFile: false,
      root: nativeRoot,
      base: './',
      plugins: [react()],
      logLevel: 'silent',
      resolve: {
        alias: {
          'react-dom/client': require.resolve('react-dom/client'),
          'react-dom': require.resolve('react-dom'),
          'react/jsx-runtime': require.resolve('react/jsx-runtime'),
          react: require.resolve('react'),
        },
      },
      build: { outDir: join(nativeRoot, 'renderer'), emptyOutDir: false },
    })
    assert.ok(existsSync(join(nativeRoot, 'main.cjs')), 'Generated Electron main entry is missing')
    assert.ok(existsSync(join(nativeRoot, 'preload.cjs')), 'Generated actual preload is missing')
    // Temporary entry files have no node_modules ancestor. Bundle application dependencies
    // and reject unresolved imports before Electron can show a main-process error dialog.
    for (const filename of ['main.cjs', 'preload.cjs']) {
      const bundled = ts.createSourceFile(
        filename,
        readFileSync(join(nativeRoot, filename), 'utf8'),
        ts.ScriptTarget.Latest,
        true,
      )
      function checkImports(node) {
        if (ts.isCallExpression(node) && node.expression.getText(bundled) === 'require') {
          assert.ok(ts.isStringLiteral(node.arguments[0]), 'Unexpected dynamic bundle dependency')
          const dependency = node.arguments[0].text
          assert.ok(
            dependency === 'electron' || require('node:module').isBuiltin(dependency),
            `Unbundled ${filename} dependency: ${dependency}`,
          )
        }
        ts.forEachChild(node, checkImports)
      }
      checkImports(bundled)
    }
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    application = await _electron.launch({
      executablePath: require('electron'),
      args: [join(nativeRoot, 'main.cjs')],
      env,
      timeout: 30000,
    })
    const page = await application.firstWindow()
    page.setDefaultTimeout(15000)
    const errors = []
    page.on('pageerror', (error) => errors.push(String(error)))
    await page.getByRole('region', { name: 'Kimi setup' }).waitFor()
    await page.getByLabel('Model endpoint', { exact: true }).fill('http://127.0.0.1:8000/v1')
    await page.getByLabel('Exact model ID', { exact: true }).fill('synthetic-electron-model')
    await page.getByLabel('Kimi Code package folder', { exact: true }).fill(packagePath)
    await page.getByRole('button', { name: 'Save Kimi configuration', exact: true }).click()
    await page.getByText('Saved', { exact: true }).waitFor()
    const disk = JSON.parse(readFileSync(join(nativeRoot, 'app-data/settings.json'), 'utf8'))
    assert.equal(disk.kimiSetup.connection.model, 'synthetic-electron-model')
    // Reload from disk in the actual main process, then reload the renderer through the bridge.
    await application.evaluate(async () => {
      await globalThis.kimiNativeProof.settings.load()
    })
    await page.reload()
    await page.getByRole('region', { name: 'Kimi setup' }).waitFor()
    assert.equal(
      await page.getByLabel('Exact model ID', { exact: true }).inputValue(),
      'synthetic-electron-model',
    )
    await page.getByRole('button', { name: 'Inspect local runtime', exact: true }).click()
    await page.getByText('Version verified', { exact: true }).waitFor()
    if (fullLayout) {
      await page.getByLabel('Model connection', { exact: true }).selectOption('server')
      await page.getByLabel('Model endpoint', { exact: true }).fill('https://model.example/v1')
      await page.getByLabel('Agent execution location', { exact: true }).selectOption('server')
      await page.getByLabel('Agent server hostname', { exact: true }).fill('agent.example')
      assert.equal(
        await page.getByRole('button', { name: 'Inspect local runtime', exact: true }).count(),
        0,
      )
      await page.getByLabel('Model connection', { exact: true }).selectOption('moonshot')
      assert.equal(await page.getByLabel('Model endpoint', { exact: true }).count(), 0)
      await page.reload()
      await page.getByRole('region', { name: 'Kimi setup' }).waitFor()
      assert.equal(await page.getByLabel('Model connection', { exact: true }).inputValue(), 'local')
      await page.getByRole('button', { name: 'Inspect local runtime', exact: true }).click()
      await page.getByText('Version verified', { exact: true }).waitFor()
      await page.getByRole('region', { name: 'Kimi setup' }).scrollIntoViewIfNeeded()
    }
    assert.deepEqual(errors, [])
    if (workspace) {
      const before = readFileSync(join(nativeRoot, 'app-data/settings.json'), 'utf8')
      const { exerciseWorkspace } = await import('./kimi-workspace.check.mjs')
      await exerciseWorkspace({ page, application, resultPath })
      assert.equal(readFileSync(join(nativeRoot, 'app-data/settings.json'), 'utf8'), before)
      assert.deepEqual(errors, [])
    }
    if (resultPath) {
      // DOM visibility can precede the hidden window's compositor frame.
      await page.waitForTimeout(150)
      writeFileSync(
        join(resultPath, 'native-settings.png'),
        Buffer.from(
          await application.evaluate(async () =>
            (await globalThis.kimiNativeProof.panel.capturePage()).toPNG().toString('base64'),
          ),
          'base64',
        ),
      )
      writeFileSync(
        join(resultPath, 'native-settings-result.json'),
        JSON.stringify(
          {
            status: 'PASS',
            transport: 'actual Electron IPC',
            store: 'actual SettingsStore',
            handlers: 'extracted current main handler and settings update/apply functions',
            isolation: 'unrelated lifecycle effects inert; full application startup not exercised',
            saveReload: true,
            inspection: 'verified artifact',
            modelCalls: 0,
            sourceRevision: revision,
            surface: fullLayout ? 'actual SettingsView' : 'KimiSettings',
            workspacePreview: workspace,
            previewRoot: nativeRoot,
            pid: application.process().pid,
            buildHashes: Object.fromEntries(
              [
                'main.cjs',
                'preload.cjs',
                ...readdirSync(join(nativeRoot, 'renderer/assets')).map(
                  (name) => `renderer/assets/${name}`,
                ),
              ].map((name) => [
                name,
                require('node:crypto')
                  .createHash('sha256')
                  .update(readFileSync(join(nativeRoot, name)))
                  .digest('hex'),
              ]),
            ),
            mainSourceSha256: require('node:crypto')
              .createHash('sha256')
              .update(sourceText)
              .digest('hex'),
          },
          null,
          2,
        ),
      )
    }
    console.log(
      'PASS: actual Electron renderer/preload/main/SettingsStore save, disk reload and local artifact inspection; no model calls.',
    )
    if (review) {
      await application.evaluate(() => globalThis.kimiNativeProof.panel.show())
      console.log(
        'REVIEW OPEN: close the owned Settings window to finish and clean up its temporary profile.',
      )
      await new Promise((done) => application.once('close', done))
      application = undefined
    }
  } catch (error) {
    if (resultPath)
      writeFileSync(
        join(resultPath, 'native-failure.json'),
        JSON.stringify({ message: error.message, files: readdirSync(nativeRoot) }, null, 2),
      )
    throw error
  } finally {
    await application?.close()
    if (resolve(nativeRoot).startsWith(resolve(tmpdir()) + sep + 'threadlight-kimi-native-'))
      rmSync(nativeRoot, { recursive: true, force: true })
  }
}
