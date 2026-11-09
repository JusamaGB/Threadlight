'use strict'
const vscode = require('vscode')
const { randomUUID } = require('crypto')
const { moveLine, remember, relocate } = require('./anchors')
const { Overlay } = require('./overlay')

function activate(context) {
  const cache = new Map()
  const key = (uri) => 'notes:' + uri.toString()
  const report = (e) => vscode.window.showErrorMessage('Margin Notes: ' + e.message)
  function notes(doc) {
    const k = key(doc.uri)
    if (!cache.has(k)) {
      const records = structuredClone(context.workspaceState.get(k, []))
      records.forEach((n) => relocate(n, doc))
      cache.set(k, records)
    }
    return cache.get(k)
  }
  function save(doc) {
    const records = notes(doc)
    return context.workspaceState
      .update(key(doc.uri), records.length ? structuredClone(records) : undefined)
      .then(undefined, report)
  }
  function patch(doc, id, data, remove) {
    const records = notes(doc),
      index = records.findIndex((n) => n.id === id)
    if (index < 0) return
    const n = records[index]
    if (remove) records.splice(index, 1)
    else {
      for (const prop of ['title', 'body']) if (typeof data[prop] === 'string') n[prop] = data[prop]
      if (typeof data.collapsed === 'boolean') n.collapsed = data.collapsed
      if (Number.isFinite(data.width)) n.width = Math.max(135, Math.min(2200, data.width))
      if (Number.isFinite(data.x)) n.x = Math.max(0, Math.min(1, data.x))
      if (Number.isInteger(data.line)) {
        n.line = data.line
        remember(n, doc)
      }
    }
    save(doc)
    overlay.refresh()
  }
  const overlay = new Overlay(context, notes, patch, report)
  async function add() {
    const editor = vscode.window.activeTextEditor
    if (!editor || editor.document.isUntitled)
      return vscode.window.showInformationMessage(
        'Open a saved file in the standard text editor to add a note.',
      )
    if (process.platform !== 'win32')
      return vscode.window.showInformationMessage(
        'Draggable overlay cards currently require VS Code on Windows.',
      )
    const doc = editor.document
    const n = {
      id: randomUUID(),
      line: editor.selection.active.line,
      x: 0.62,
      width: 252,
      title: '',
      body: '',
      collapsed: false,
    }
    remember(n, doc)
    notes(doc).push(n)
    await save(doc)
    overlay.focus(n.id)
  }
  async function find() {
    const editor = vscode.window.activeTextEditor
    if (!editor) return
    const entries = notes(editor.document).map((n) => ({
      label: n.title || n.body.trim().split(/\r?\n/)[0] || 'Annotation',
      description: 'Line ' + (n.line + 1),
      n,
    }))
    if (!entries.length) return vscode.window.showInformationMessage('No annotations in this file.')
    const item = await vscode.window.showQuickPick(entries, { placeHolder: 'Choose an annotation' })
    if (!item) return
    const range = editor.document.lineAt(item.n.line).range
    editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport)
    overlay.focus(item.n.id)
  }
  context.subscriptions.push(
    overlay,
    vscode.commands.registerCommand('marginNotes.add', add),
    vscode.commands.registerCommand('marginNotes.open', find),
    vscode.window.onDidChangeActiveTextEditor(() => overlay.refresh()),
    vscode.window.onDidChangeWindowState(() => overlay.refresh()),
    vscode.window.onDidChangeTextEditorVisibleRanges((e) => {
      if (e.textEditor === vscode.window.activeTextEditor) overlay.refresh()
    }),
    vscode.window.onDidChangeActiveColorTheme(() => overlay.refresh()),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        ['editor.fontFamily', 'editor.fontSize', 'window.zoomLevel'].some((key) =>
          e.affectsConfiguration(key),
        )
      )
        overlay.refresh()
    }),
    vscode.workspace.onDidOpenTextDocument((doc) => {
      if (context.workspaceState.get(key(doc.uri))) notes(doc)
    }),
    vscode.workspace.onDidCloseTextDocument((doc) => cache.delete(key(doc.uri))),
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (!e.contentChanges.length || !cache.has(key(e.document.uri))) return
      const changes = [...e.contentChanges].sort((a, b) => b.rangeOffset - a.rangeOffset)
      const records = notes(e.document)
      for (const n of records) {
        n.line = moveLine(n.line, changes)
        remember(n, e.document)
      }
      if (records.length) {
        save(e.document)
        overlay.refresh()
      }
    }),
    vscode.workspace.onDidRenameFiles(async (event) => {
      for (const { oldUri, newUri } of event.files) {
        const old = key(oldUri)
        for (const k of context.workspaceState
          .keys()
          .filter((k) => k === old || k.startsWith(old + '/'))) {
          const next = key(newUri) + k.slice(old.length)
          const records = cache.get(k) || context.workspaceState.get(k, [])
          await context.workspaceState.update(next, records)
          cache.delete(k)
          cache.set(next, records)
          await context.workspaceState.update(k, undefined)
        }
      }
    }),
  )
  // Old sessions can contain a custom editor tab. Reopen only that resource
  // in VS Code's text editor. Never close a dirty tab or change an association.
  const migrating = new Set()
  async function restoreLegacyTab() {
    const group = vscode.window.tabGroups.activeTabGroup,
      tab = group.activeTab
    if (
      !(tab?.input instanceof vscode.TabInputCustom) ||
      tab.input.viewType !== 'marginNotes.editor'
    )
      return
    if (migrating.has(tab)) return
    migrating.add(tab)
    try {
      const doc = await vscode.workspace.openTextDocument(tab.input.uri)
      await vscode.window.showTextDocument(doc, { viewColumn: group.viewColumn, preview: false })
      if (!tab.isDirty && group.tabs.includes(tab)) await vscode.window.tabGroups.close(tab, true)
    } finally {
      migrating.delete(tab)
    }
  }
  context.subscriptions.push(
    vscode.window.tabGroups.onDidChangeTabs(() => restoreLegacyTab().catch(report)),
  )
  restoreLegacyTab().catch(report)
  overlay.refresh()
}
module.exports = { activate }
