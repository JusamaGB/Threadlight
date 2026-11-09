// Replay the production caller's first-page/context/first-page/save/first-page sequence.
// Run against an actual installed companion in an isolated extension host.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vscode = require('vscode')

async function run(root, EditorCoach) {
  const version = vscode.extensions.getExtension('threadlight.threadlight-live-coach').packageJSON
    .version
  const supportsReview = Number(version.split('.')[1]) >= 3
  const file = path.join(root, 'receipt.py')
  const saved = '# saved\r\n'
  fs.writeFileSync(file, saved)
  const doc = await vscode.workspace.openTextDocument(file)
  const editor = await vscode.window.showTextDocument(doc)
  const source = Array.from({ length: 21 }, (_, i) => '# receipt ' + i)
    .concat('print(missing_price)')
    .join('\r\n')
  await editor.edit((edit) =>
    edit.replace(new vscode.Range(doc.positionAt(0), doc.positionAt(saved.length)), source),
  )
  editor.selection = new vscode.Selection(21, 0, 21, 0)
  await vscode.commands.executeCommand('threadlight.coach.start')
  const descriptor = path.join(
    root,
    'profile',
    'User',
    'globalStorage',
    'threadlight.threadlight-live-coach',
    'editor-coach.json',
  )
  const coach = new EditorCoach(
    () => 'compatibility',
    async () => assert.fail('Unexpected narration'),
    descriptor,
  )
  async function review(dirty) {
    const call = coach.run('compatibility', { action: 'review' })
    if (!supportsReview) {
      await assert.rejects(call, /without whole-file review\. Zero lines reviewed\..*Reload Window/)
    } else {
      const page = await call
      assert.equal(page.status, 'complete')
      assert.equal(page.coveredLines, 22)
      assert.equal(page.dirty, dirty)
      assert.equal(page.text, source)
    }
    assert.equal(doc.isDirty, dirty)
    assert.equal(doc.getText(), source)
    assert.equal(fs.readFileSync(file, 'utf8'), dirty ? saved : source)
  }
  try {
    const caps = await coach.run('compatibility', { action: 'capabilities' })
    assert.equal(caps.connected, true)
    if (version === '0.6.11') {
      assert.ok(caps.actions.includes('trace') && caps.actions.includes('propose'))
      assert.ok(!caps.actions.includes('ghost_practice'))
      assert.match(
        caps.ghostPracticeActivation,
        /0\.6\.11.*0\.6\.14.*Developer: Reload Window.*Threadlight: Start Live Coaching/,
      )
      const source = await coach.run('compatibility', { action: 'context' })
      assert.equal(source.file, 'receipt.py')
      await assert.rejects(
        coach.run('compatibility', {
          action: 'ghost_practice',
          snapshot: source.snapshot,
          scope: 'file',
          spoken: true,
        }),
        (error) => error.message === caps.ghostPracticeActivation,
      )
    }
    if (Number(version.split('.')[1]) < 6) {
      assert.ok(!caps.actions.includes('propose'))
      await assert.rejects(
        coach.run('compatibility', { action: 'proposal_status' }),
        /0.6.0.*Reload/,
      )
      if (version === '0.5.0') assert.equal(caps.version, version)
    }
    await review(true)
    const context = await coach.run('compatibility', { action: 'context' })
    assert.equal(context.lines[0].line, 10)
    await vscode.commands.executeCommand('workbench.files.action.focusFilesExplorer')
    await review(true)
    await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup')
    assert.equal(await doc.save(), true)
    await review(false)
    console.log(
      'PASS companion ' +
        version +
        ', real first-page/context/retry/save/retry sequence: ' +
        (supportsReview
          ? 'complete dirty and saved text'
          : 'zero coverage with correct activation advice'),
    )
  } finally {
    coach.close()
    await vscode.commands.executeCommand('threadlight.coach.stop')
  }
}
module.exports = { run }
