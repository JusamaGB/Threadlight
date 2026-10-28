/* global window, DataTransfer, ClipboardEvent, DragEvent */
import assert from 'node:assert/strict'
export async function checkComposerAttachments(page, conversation, toggle, capture) {
  await page.evaluate(() => {
    window.proof.composerFiles = []
    window.proof.attachCounter = 0
    window.proof.attachedSends = []
    window.threadlight.composerFilePath = () => ''
    window.threadlight.composerAttachments = async (input) => {
      const items = window.proof.composerFiles
      if (input.action === 'add' || input.action === 'pick') {
        const file = input.file ?? { name: 'selected.docx', bytes: new Uint8Array([1, 2]) }
        items.push({
          id: 'attachment-' + ++window.proof.attachCounter,
          name: file.name,
          size: file.bytes?.length ?? 10,
          kind: file.name.endsWith('.png') ? 'image' : 'file',
        })
      }
      if (input.action === 'pick' && window.proof.pickFailure)
        return { ok: false, reason: 'One selected file was rejected.' }
      if (input.action === 'remove')
        window.proof.composerFiles = items.filter((item) => item.id !== input.id)
      return { ok: true, items: structuredClone(window.proof.composerFiles) }
    }
    window.threadlight.sendMessage = async (...args) => {
      window.proof.attachedSends.push(args)
      if (window.proof.rejectAttachment)
        return { ok: false, reason: 'Rejected. Attachments retained.' }
      window.proof.composerFiles = window.proof.composerFiles.filter(
        (item) => !args[2]?.includes(item.id),
      )
      return { ok: true }
    }
  })
  const composer = conversation.getByRole('group', { name: 'Codex message composer' })
  const box = composer.getByRole('textbox')
  await box.fill('')
  await box.evaluate((el) => {
    const data = new DataTransfer()
    data.items.add(
      new File([new Uint8Array([137, 80, 78, 71])], 'pasted.png', { type: 'image/png' }),
    )
    el.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    )
  })
  await composer.getByRole('button', { name: 'Remove pasted.png' }).waitFor()
  await composer.evaluate((el) => {
    const data = new DataTransfer()
    data.items.add(new File(['%PDF-synthetic'], 'report.pdf', { type: 'application/pdf' }))
    el.dispatchEvent(
      new DragEvent('dragover', { dataTransfer: data, bubbles: true, cancelable: true }),
    )
    el.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }))
  })
  await composer.getByRole('button', { name: 'Remove report.pdf' }).waitFor()
  await composer.getByRole('button', { name: 'Attach files', exact: true }).click()
  await composer.getByRole('button', { name: 'Remove selected.docx' }).click()
  await composer
    .getByRole('button', { name: 'Remove selected.docx' })
    .waitFor({ state: 'detached' })
  await toggle.click()
  await toggle.click()
  await composer.getByRole('button', { name: 'Remove report.pdf' }).waitFor()
  assert.equal(await box.inputValue(), '')
  await capture('composer-attachments')
  await page.evaluate(() => {
    window.proof.rejectAttachment = true
  })
  await composer.getByRole('button', { name: /^(Send|Queue message)$/ }).click()
  await composer.getByText('Rejected. Attachments retained.').waitFor()
  assert.equal(
    await composer.getByRole('list', { name: 'Attached files' }).locator('li').count(),
    2,
  )
  await page.evaluate(() => {
    window.proof.rejectAttachment = false
  })
  await composer.getByRole('button', { name: /^(Send|Queue message)$/ }).click()
  await composer.getByRole('list', { name: 'Attached files' }).waitFor({ state: 'detached' })
  const calls = await page.evaluate(() => window.proof.attachedSends)
  assert.equal(calls.length, 2)
  assert.equal(calls[0][1], '')
  assert.deepEqual(calls[0][2], ['attachment-1', 'attachment-2'])
  assert.deepEqual(calls[1], calls[0])
  assert.equal(await composer.getByRole('button', { name: /^(Send|Queue message)$/ }).count(), 0)
  await page.evaluate(() => {
    window.proof.pickFailure = true
  })
  await composer.getByRole('button', { name: 'Attach files', exact: true }).click()
  await composer.getByText('One selected file was rejected.').waitFor()
  await composer.getByRole('button', { name: 'Remove selected.docx' }).waitFor()
  await composer.getByRole('button', { name: 'Remove selected.docx' }).click()
  await composer.getByRole('list', { name: 'Attached files' }).waitFor({ state: 'detached' })
}
