/* global window, document, getComputedStyle */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { openHeaderPage } from './header-navigation.mjs'
import { setupLegacySpace, openSpace } from './space-navigation.mjs'
import { setupVoiceInput } from './voice-input.fixture.mjs'

export async function checkNotesComposer(page, proof, capture) {
  await openHeaderPage(page, 'Shared Spaces')
  await setupLegacySpace(page)
  const view = page.getByRole('region', { name: 'Shared Spaces', exact: true })
  await view.getByRole('tab', { name: 'Notes', exact: true }).click()
  const box = view.getByRole('textbox', { name: 'New note', exact: true })
  const composer = view.locator('[data-shared-composer]')
  await box.waitFor()
  assert.equal(await composer.locator('[data-composer-input]').count(), 1)
  assert.equal(await view.getByText('No notes yet.', { exact: true }).count(), 1)
  assert.equal(await view.getByText(/Capture notes, decisions/).count(), 0)
  assert.equal(await box.evaluate((el) => getComputedStyle(el).resize), 'none')
  assert.ok((await box.boundingBox()).height < 40, 'empty composer stays compact')
  await capture('notes-composer-empty')

  await box.fill('Human note test. Keep this additional context intact.')
  await box.press('Shift+Enter')
  await box.press('End')
  await page.keyboard.insertText('Second line')
  assert.equal(proof.store.all().length, 0, 'Shift+Enter does not save')
  await view.getByRole('tab', { name: 'Chats', exact: true }).click()
  await view.getByRole('tab', { name: 'Notes', exact: true }).click()
  const text = await box.inputValue()
  assert.equal(
    text,
    'Human note test. Keep this additional context intact.\nSecond line',
    'tab navigation preserves draft',
  )

  await page.evaluate(() => {
    const request = window.threadlight.spacesRequest
    let fail = true
    window.threadlight.spacesRequest = async (input) => {
      if (input.action === 'create' && fail) {
        fail = false
        return { ok: false, reason: 'Synthetic save failure' }
      }
      return request(input)
    }
  })
  await box.press('Enter')
  await view.getByText('Synthetic save failure', { exact: true }).waitFor()
  assert.equal(await box.inputValue(), text, 'failed save retains draft')
  assert.equal(proof.store.all().length, 0)
  await view.getByRole('button', { name: 'Save note', exact: true }).click()
  await view.getByRole('button', { name: /Human note test.*Saved note/ }).waitFor()
  assert.equal(await box.inputValue(), '')
  assert.equal(proof.store.all().length, 1)
  const note = proof.store.all()[0]
  assert.equal(note.title, 'Human note test.')
  assert.equal(note.text, text)
  const savedDocument = proof.service.snapshot().documents.find((d) => d.id === note.id)
  assert.ok(savedDocument.path.replaceAll('\\', '/').includes('/notes/'))
  assert.ok(readFileSync(savedDocument.path, 'utf8').includes(text))
  assert.equal(proof.calls.length, 0, 'saving does not start Brainstorm')
  await capture('notes-composer-saved')

  const row = view.getByRole('button', { name: /Human note test.*Saved note/ })
  assert.equal(
    await view.getByRole('button', { name: 'Discuss in Brainstorm', exact: true }).count(),
    0,
  )
  await row.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Rename', exact: true }).click()
  const titleBox = view.getByRole('textbox', { name: 'Note title', exact: true })
  await titleBox.fill('Cancel this rename')
  await titleBox.press('Escape')
  assert.equal(proof.store.get(note.id).title, 'Human note test.')
  await row.focus()
  await row.press('Shift+F10')
  await capture('notes-context-menu')
  await page.getByRole('menuitem', { name: 'Rename', exact: true }).click()
  const renamed = 'Human note test with a deliberately long title that should fade on one line'
  await titleBox.fill(renamed)
  await titleBox.press('Enter')
  await row.waitFor()
  assert.equal(proof.store.get(note.id).title, renamed)
  assert.equal(proof.store.get(note.id).text, text, 'rename preserves the complete body')
  const titleStyle = await row.locator('strong').evaluate((el) => ({
    wrap: getComputedStyle(el).whiteSpace,
    mask: getComputedStyle(el).maskImage,
    overflow: el.scrollWidth > el.clientWidth,
  }))
  assert.equal(titleStyle.wrap, 'nowrap')
  assert.match(titleStyle.mask, /linear-gradient/)
  assert.equal(titleStyle.overflow, true)
  await capture('notes-title-fade')
  await row.click()
  await view.getByRole('heading', { name: renamed, exact: true }).waitFor()
  assert.equal(await view.getByRole('textbox', { name: 'Note', exact: true }).inputValue(), text)
  await page.getByRole('button', { name: 'Back in Shared Spaces', exact: true }).click()

  await setupVoiceInput(page)
  await page.evaluate(() => {
    window.threadlight.transcribe = async () => 'Dictated note'
  })
  await composer.getByRole('button', { name: 'Talk', exact: true }).click()
  const stop = composer.getByRole('button', { name: 'Stop and transcribe', exact: true })
  await stop.waitFor()
  await page.waitForTimeout(250)
  await stop.click()
  await page.waitForFunction(
    () => document.querySelector('[aria-label="New note"]')?.value === 'Dictated note',
  )
  assert.equal(proof.store.all().length, 1, 'dictation fills draft without saving')
  await box.press('Enter')
  await view.getByRole('button', { name: /Dictated note.*Saved note/ }).waitFor()
  assert.equal(proof.store.all().length, 2)
  assert.equal(proof.calls.length, 0)
  await page.reload()
  await openHeaderPage(page, 'Shared Spaces')
  await openSpace(page)
  await view.getByRole('tab', { name: 'Notes', exact: true }).click()
  await view.getByRole('button', { name: /Human note test.*Saved note/ }).waitFor()
  await view.getByRole('button', { name: /Dictated note.*Saved note/ }).waitFor()
  assert.equal(proof.store.get(note.id).title, renamed, 'renamed title survives reload')
  await view.getByRole('button', { name: /Human note test.*Saved note/ }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Discuss', exact: true }).click()
  await view
    .locator('[role="tab"][aria-selected="true"]')
    .filter({ hasText: 'Brainstorm' })
    .waitFor()
  assert.ok(
    proof.store.discussions().some((d) => d.title === renamed && d.noteIds.includes(note.id)),
  )
  assert.equal(proof.calls.length, 0, 'Discuss opens context without starting inference')
  console.log(
    'PASS: shared Notes composer, first-sentence title, one-line fade, right-click/keyboard rename and Discuss, full body preservation, persistence, dictation and no inference.',
  )
}
