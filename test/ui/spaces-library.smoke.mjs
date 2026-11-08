import { openHeaderPage } from './header-navigation.mjs'
/* global window, document, getComputedStyle */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { openSpace } from './space-navigation.mjs'

export async function checkSpacesLibrary(page, proof, capture) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const offer = page.getByRole('switch', { name: 'Add to .gitignore', exact: true })
  assert.equal(await offer.getAttribute('aria-checked'), 'false')
  await offer.click()
  await page.waitForFunction(
    async () => (await window.threadlight.getSettings()).sharedSpacesGitignore,
  )
  await capture('spaces-gitignore-setting')
  await offer.click()
  await page.waitForFunction(
    async () => !(await window.threadlight.getSettings()).sharedSpacesGitignore,
  )
  await page.getByRole('button', { name: 'Back to sessions', exact: true }).click()
  await openHeaderPage(page, 'Shared Spaces')
  const view = page.getByRole('region', { name: 'Shared Spaces', exact: true })
  const header = page.locator('header[aria-label="Panel header"]')
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
  assert.equal(await header.getByText('Shared Spaces', { exact: true }).count(), 1)
  assert.equal(await header.getByRole('button', { name: 'Connect', exact: true }).count(), 0)
  assert.equal(await view.getByLabel('Shared Spaces workspace').count(), 0)
  await capture('spaces-empty')
  for (const title of ['Advert storyboard', 'Product design']) {
    await view.getByRole('button', { name: 'Create a space', exact: true }).click()
    await view.getByLabel('Space name').fill(title)
    const ignore = view.getByRole('checkbox', { name: 'Add to .gitignore', exact: true })
    if (title === 'Advert storyboard') {
      assert.equal(await ignore.count(), 0, 'disabled setting hides the creation option')
      await page.evaluate(() => window.threadlight.updateSettings({ sharedSpacesGitignore: true }))
      await ignore.waitFor()
      assert.equal(await ignore.isChecked(), false, 'enabling the option does not select it')
      await ignore.focus()
      await ignore.press('Space')
      assert.equal(await ignore.isChecked(), true)
    } else {
      assert.equal(await ignore.isChecked(), false, 'each new space starts unchecked')
    }
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
    await header.getByText(title, { exact: true }).waitFor()
    assert.equal(
      readFileSync(join(root, '.gitignore'), 'utf8'),
      '/shared-spaces/advert-storyboard/\n',
      'only the explicitly selected space is ignored',
    )
    assert.equal(await header.getByRole('button', { name: 'Connect', exact: true }).count(), 0)
    assert.equal(
      await view
        .getByRole('tab', { name: 'Brainstorm', exact: true })
        .getAttribute('aria-selected'),
      'true',
    )
    assert.equal(await view.getByRole('button', { name: 'Spaces', exact: true }).count(), 0)
    assert.equal(await view.getByText('Location', { exact: true }).count(), 0)
    const heading = header.getByText(title, { exact: true })
    assert.equal(await header.getByText('Shared Spaces', { exact: true }).count(), 0)
    assert.equal(
      await view.getByText(title, { exact: true }).filter({ visible: true }).count(),
      0,
      'no duplicate project row',
    )
    assert.equal(await header.evaluate((el) => getComputedStyle(el).borderBottomWidth), '0px')
    const headingBox = await heading.boundingBox()
    const headerBox = await header.boundingBox()
    assert.ok(
      Math.abs(headingBox.x + headingBox.width / 2 - (headerBox.x + headerBox.width / 2)) < 1,
      'project title is centered across the full panel',
    )
    assert.equal(await heading.evaluate((el) => getComputedStyle(el).textAlign), 'center')
    assert.ok(headerBox.height <= 22, 'project header is compact')
    const voiceInsets = await heading.evaluate((el) => {
      const header = el.closest('header')
      const previous = header.getAttribute('data-voice')
      header.setAttribute('data-voice', '')
      const style = getComputedStyle(el)
      const result = [style.left, style.right]
      if (previous === null) header.removeAttribute('data-voice')
      else header.setAttribute('data-voice', previous)
      return result
    })
    assert.deepEqual(voiceInsets, ['24px', '24px'], 'voice visuals preserve balanced title space')
    await capture('spaces-project-header')
    const tabs = view.getByRole('tablist', { name: 'Shared Spaces areas' })
    assert.ok(
      (await tabs.boundingBox()).y -
        (await header.boundingBox()).y -
        (await header.boundingBox()).height <=
        1,
      'tabs sit directly below the project header',
    )
    assert.ok(
      (await tabs.boundingBox()).y - (headingBox.y + headingBox.height) <= 3,
      'no extra title-to-tabs buffer',
    )
    const brainstorm = tabs.getByRole('tab', { name: 'Brainstorm', exact: true })
    const handoffs = tabs.getByRole('tab', { name: 'Handoffs', exact: true })
    const tabStyle = await brainstorm.evaluate((el) => {
      const active = getComputedStyle(el)
      const raised = getComputedStyle(el, '::after')
      const inactive = getComputedStyle(el.parentElement.querySelector('[aria-selected="false"]'))
      const divider = el.parentElement.parentElement.getBoundingClientRect()
      const tabs = el.parentElement.getBoundingClientRect()
      return {
        activeBorder: raised.borderTopWidth,
        inactiveBorder: inactive.borderTopWidth,
        activeColour: active.color,
        inactiveColour: inactive.color,
        bottomBorder: raised.borderBottomWidth,
        dividerBottom: divider.bottom,
        tabsBottom: tabs.bottom,
      }
    })
    assert.equal(tabStyle.activeBorder, '1px')
    assert.equal(tabStyle.inactiveBorder, '0px')
    assert.equal(tabStyle.bottomBorder, '0px')
    assert.notEqual(tabStyle.activeColour, tabStyle.inactiveColour)
    assert.ok(
      Math.abs(tabStyle.dividerBottom - tabStyle.tabsBottom) < 2,
      'page tabs meet the header divider',
    )
    assert.ok(
      (await brainstorm.boundingBox()).height > (await handoffs.boundingBox()).height,
      'selected page tab is taller',
    )
    assert.deepEqual(await tabs.getByRole('tab').allTextContents(), [
      'Handoffs',
      'Notes',
      'Brainstorm',
      'Workflow',
      'Chats',
    ])
    for (const selected of ['Handoffs', 'Notes', 'Brainstorm', 'Workflow', 'Chats']) {
      await tabs.getByRole('tab', { name: selected, exact: true }).click()
      await page.mouse.move(0, 0)
      await page.waitForFunction(() => {
        const tabs = document.querySelector('[aria-label="Shared Spaces areas"]')
        const active = tabs.querySelector('[aria-selected="true"]')
        return active.getBoundingClientRect().height === 25
      })
      const geometry = await tabs.evaluate((el) => {
        const buttons = [...el.querySelectorAll('[role="tab"]')]
        const selected = buttons.find((button) => button.getAttribute('aria-selected') === 'true')
        const selectedBox = selected.getBoundingClientRect()
        const area = el.getBoundingClientRect()
        const labels = buttons.map((button) => {
          const box = button.getBoundingClientRect()
          const label = button.querySelector('span').getBoundingClientRect()
          return {
            name: button.textContent.trim(),
            width: box.width,
            top: box.top,
            labelFits: label.left >= box.left + 3 && label.right <= box.right - 3,
            inside: box.left >= area.left && box.right <= area.right + 1,
          }
        })
        const neighbor =
          buttons[buttons.indexOf(selected) + 1] ?? buttons[buttons.indexOf(selected) - 1]
        const overlapX =
          buttons.indexOf(selected) === buttons.length - 1
            ? selectedBox.left - 2
            : selectedBox.right + 2
        const hit = document
          .elementFromPoint(overlapX, selectedBox.bottom - 8)
          ?.closest('[role="tab"]')
        return {
          labels,
          raisedBy: neighbor.getBoundingClientRect().top - selectedBox.top,
          overlapOwned: hit === selected,
        }
      })
      assert.ok(
        geometry.labels.every((label) => label.labelFits && label.inside),
        `${selected}: every label has room inside its tab`,
      )
      assert.ok(geometry.raisedBy >= 5, `${selected}: active tab sits above the continuous bar`)
      assert.equal(
        geometry.overlapOwned,
        true,
        `${selected}: neighbouring tab tucks behind the active edge`,
      )
      const selectedTab = tabs.getByRole('tab', { name: selected, exact: true })
      assert.equal(
        await selectedTab.locator('span').evaluate((el) => el.scrollWidth <= el.clientWidth),
        true,
        'selected label is fully revealed',
      )
      const workflowTab = tabs.getByRole('tab', { name: 'Workflow', exact: true })
      await workflowTab.focus()
      assert.equal(
        await workflowTab.locator('span').evaluate((el) => getComputedStyle(el).maskImage),
        'none',
        'keyboard focus reveals the label without a tooltip',
      )
      await selectedTab.focus()
      await capture(`spaces-raised-tab-${selected.toLowerCase()}`)
    }
    await brainstorm.click()
    assert.ok((await view.boundingBox()).height < 360, 'empty Brainstorm fits its content')
    await view.getByRole('textbox', { name: 'Message to Agent', exact: true }).waitFor()
    assert.equal(
      proof.store.discussions().length,
      0,
      'opening Brainstorm creates no empty discussions',
    )
    assert.equal(proof.calls.length, 0, 'opening Brainstorm starts no agent turn')
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
    if (title === 'Product design') {
      for (let index = 0; index < 12; index++) {
        const saved = await proof.service.request({
          action: 'create',
          id: randomUUID(),
          workspaceId: location.workspaceId,
          sharedSpaceId: location.spaceId,
          title: `Extra note ${index}`,
          text: 'A saved note for checking bounded content and scrolling.',
        })
        assert.equal(saved.ok, true)
      }
      const notes = view.getByRole('tabpanel', { name: 'Notes', exact: true })
      await view.getByRole('button', { name: /Extra note 11/ }).waitFor()
      const list = notes.locator('[class*="_notesList_"]')
      const composer = notes.locator('[data-shared-composer]')
      const size = await list.evaluate((el) => ({
        height: el.clientHeight,
        content: el.scrollHeight,
      }))
      assert.ok(size.content > size.height, 'long content scrolls within the panel')
      const composerBox = await composer.boundingBox()
      const listBox = await list.boundingBox()
      assert.ok(listBox.y + listBox.height <= composerBox.y, 'composer stays below the notes')
      await list.evaluate((el) => {
        el.scrollTop = el.scrollHeight
      })
      assert.equal(
        (await composer.boundingBox()).y,
        composerBox.y,
        'scrolling notes keeps composer fixed',
      )
      const panelBox = await notes.boundingBox()
      assert.ok(
        composerBox.y + composerBox.height <= panelBox.y + panelBox.height,
        'composer remains visible',
      )
      assert.ok((await view.boundingBox()).height <= 640, 'long content stays bounded')
      await capture('spaces-page-tabs-long')
      await brainstorm.click()
      assert.ok(
        (await view.boundingBox()).height < 360,
        'switching to empty Brainstorm shrinks the panel again',
      )
      await capture('spaces-page-tabs-compact')
    }
    await page.getByRole('button', { name: 'Back in Shared Spaces', exact: true }).click()
    assert.equal(await header.getByText('Shared Spaces', { exact: true }).count(), 1)
    assert.equal(await header.getByRole('button', { name: 'Connect', exact: true }).count(), 0)
  }
  assert.equal(proof.store.locations().length, 2)
  await capture('spaces-library')
  await page.reload()
  await openHeaderPage(page, 'Shared Spaces')
  await openSpace(page, 'Advert storyboard')
  assert.equal(
    await view.getByRole('tab', { name: 'Brainstorm', exact: true }).getAttribute('aria-selected'),
    'true',
  )
  await view.getByRole('tab', { name: 'Notes', exact: true }).click()
  await view.getByRole('button', { name: /Only in Advert storyboard/ }).waitFor()
  assert.equal(await view.getByText(/Only in Product design/).count(), 0)
  await capture('spaces-isolation')
  console.log(
    'PASS: searchable workspace explorer, nested folders, cross-folder choices, preserved drafts and filters, named-space creation, persistence and isolation.',
  )
}
