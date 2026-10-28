import { openHeaderPage } from './header-navigation.mjs'
/* global window, document */
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { openSpace } from './space-navigation.mjs'

export async function checkSpacesLibrary(page, proof, capture) {
  await openHeaderPage(page, 'Shared Spaces')
  const view = page.getByRole('region', { name: 'Shared Spaces', exact: true })
  const root = await page.evaluate(async () =>
    (await window.threadlight.getSnapshot()).currentWorkspace.replace(/^(claude|codex):/, ''),
  )
  await page.evaluate(
    async ({ root, sibling }) => {
      const folders = [
        { id: root, name: 'shared' },
        { id: `${root}/nested`, name: 'nested' },
        { id: sibling, name: 'second workspace' },
      ]
      window.proof.emit(
        'onSnapshot',
        await window.mockWorkspaceFolders({
          claude: folders,
          codex: folders,
        }),
      )
    },
    { root, sibling: proof.secondRoot },
  )
  await view.getByText(/No shared spaces yet/).waitFor()
  assert.equal(await view.getByLabel('Shared Spaces workspace').count(), 0)
  await capture('spaces-empty')
  for (const title of ['Advert storyboard', 'Product design']) {
    await view.getByRole('button', { name: 'Create a space', exact: true }).click()
    await view.getByLabel('Space name').fill(title)
    const picker = view.getByLabel('Shared Spaces workspace')
    assert.equal(await view.locator('select').count(), 0, 'no native workspace scroll list')
    assert.equal(await view.getByText(/\/shared-spaces\/$/).count(), 0, 'no repeated location line')
    const settings = await page.evaluate(() => window.threadlight.getSettings())
    await picker.click()
    const search = view.getByRole('searchbox', { name: 'Search workspaces' })
    await search.waitFor()
    assert.equal(await search.evaluate((el) => document.activeElement === el), true)
    assert.equal(await view.getByRole('button', { name: 'Use All Drives' }).count(), 0)
    assert.equal(await view.getByRole('button', { name: /^Workspace applications:/ }).count(), 0)
    if (title === 'Advert storyboard') {
      await view.getByRole('button', { name: 'Browse shared', exact: true }).click()
      await view.getByRole('button', { name: 'nested', exact: true }).waitFor()
      await capture('spaces-workspace-browse')
      await view.getByRole('button', { name: 'Parent folder', exact: true }).click()
      await search.fill('second workspace')
      await capture('spaces-workspace-search')
      await view.getByRole('button', { name: /^second workspace / }).click()
      await picker.getByText('second workspace', { exact: true }).waitFor()
      assert.equal(await view.getByLabel('Space name').inputValue(), title)
      await picker.click()
      await search.fill('no-matching-workspace')
      await view.getByText('No workspaces match your search.', { exact: true }).waitFor()
      await search.press('Escape')
      await search.waitFor({ state: 'detached' })
      await view.getByText('Choose workspace', { exact: true }).waitFor()
      await page.getByRole('button', { name: 'Back in Shared Spaces', exact: true }).click()
      assert.equal(await view.getByLabel('Space name').inputValue(), title)
      assert.equal(await picker.evaluate((el) => document.activeElement === el), true)
      await picker.click()
    }
    await search.fill(root.replaceAll('\\', '/'))
    await view
      .getByRole('button', { name: `shared ${root.replaceAll('\\', '/')}`, exact: true })
      .click()
    assert.deepEqual(
      await page.evaluate(() => window.threadlight.getSettings()),
      settings,
      'choosing a space workspace must not change app filters or the panel workspace',
    )
    await capture('spaces-create')
    await view.getByRole('button', { name: 'Create space', exact: true }).click()
    await view.getByRole('button', { name: /^Connect a chat/ }).waitFor()
    assert.equal(await view.getByLabel('Shared Spaces workspace').count(), 0)
    await view.getByRole('tab', { name: 'Notes', exact: true }).click()
    await view.getByLabel('New note').fill(`Only in ${title}`)
    await view.getByRole('button', { name: 'Save note', exact: true }).click()
    await view.getByRole('button', { name: new RegExp(`Only in ${title}`) }).waitFor()
    const location = proof.store.locations().find((l) => l.title === title)
    assert.ok(location)
    assert.ok(existsSync(join(root, 'shared-spaces', location.directory, 'space.json')))
    assert.equal(existsSync(join(root, 'ideas')), false)
    assert.equal(existsSync(join(root, 'shared-spaces', 'ideas')), false)
    await view.getByRole('button', { name: 'Spaces', exact: true }).click()
  }
  assert.equal(proof.store.locations().length, 2)
  await capture('spaces-library')
  await page.reload()
  await openHeaderPage(page, 'Shared Spaces')
  await openSpace(page, 'Advert storyboard')
  await view.getByRole('tab', { name: 'Notes', exact: true }).click()
  await view.getByRole('button', { name: /Only in Advert storyboard/ }).waitFor()
  assert.equal(await view.getByText(/Only in Product design/).count(), 0)
  await capture('spaces-isolation')
  console.log(
    'PASS: searchable workspace explorer, nested folders, cross-folder choices, preserved drafts and filters, named-space creation, persistence and isolation.',
  )
}
