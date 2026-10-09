import { join } from 'node:path'
import type { HronautBookmarksApi } from '../../src/shared/types.js'
import { blockFileDestination, closeHronaut, expect, launchHronaut, test } from './fixtures.js'

test('organizes bookmarks with keyboard recovery, failed-write retry and application restart', async ({ profileDirectory, mcpPort }, testInfo) => {
  let instance = await launchHronaut(profileDirectory, mcpPort)
  try {
    const entries = await instance.window.evaluate(async () => {
      const api = (window as unknown as { hronautBookmarks: HronautBookmarksApi }).hronautBookmarks
      await api.add('https://example.test/alpha', 'Alpha reference')
      return api.add('https://example.test/beta', 'Beta reference')
    })
    await instance.window.getByRole('button', { name: 'New tab', exact: true }).click()
    await instance.window.getByRole('button', { name: 'Bookmarks', exact: true }).click()
    let panel = instance.window.getByRole('dialog', { name: 'Bookmarks' })
    await panel.getByRole('button', { name: 'New collection' }).click()
    const name = panel.getByRole('textbox', { name: 'Collection name', exact: true })
    await expect(name).toBeFocused()
    await name.fill('Project')
    await name.press('Enter')
    let filter = panel.getByRole('combobox', { name: 'Filter bookmarks by collection' })
    await expect(filter).toBeFocused()
    await expect(panel).toContainText('No bookmarks in this collection')
    const projectValue = await filter.inputValue()
    await filter.selectOption('unfiled')
    await panel.getByRole('searchbox').fill('alpha')
    await expect(panel.locator('.bookmark-item')).toHaveCount(1)
    const assignment = panel.getByRole('combobox', { name: 'Collection for Alpha reference' })
    await assignment.focus()
    await assignment.press('ArrowDown')
    await expect(panel.locator('.bookmark-item')).toHaveCount(0)
    await expect(filter).toBeFocused()
    await filter.selectOption(projectValue)
    await expect(panel.locator('.bookmark-item')).toHaveCount(1)
    await panel.getByRole('searchbox').fill('beta')
    await expect(panel.locator('.bookmark-item')).toHaveCount(0)
    await panel.getByRole('searchbox').fill('')
    await expect(panel.locator('.bookmark-item')).toHaveCount(1)

    const restore = await blockFileDestination(join(profileDirectory, 'bookmarks.json'))
    try {
      await panel.getByRole('button', { name: 'Rename collection', exact: true }).click()
      await name.fill('Renamed project')
      await name.press('Enter')
      await expect(panel.getByRole('alert')).toBeVisible()
      await expect(name).toHaveValue('Renamed project')
      await expect(name).toBeFocused()
    } finally { await restore() }
    await name.press('Enter')
    await expect(filter).toBeFocused()
    await expect(filter.locator('option:checked')).toHaveText('Renamed project')
    await panel.getByRole('button', { name: 'Close bookmarks' }).click()
    await instance.window.getByRole('button', { name: 'Bookmarks', exact: true }).click()
    await expect(filter).toHaveValue(projectValue)
    await testInfo.attach('bookmark-collection', { body: await panel.screenshot(), contentType: 'image/png' })
    await instance.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(760, 760))
    await expect(filter).toBeInViewport({ ratio: 1 })
    expect((await panel.getByRole('heading', { name: 'Bookmarks', exact: true }).boundingBox())?.height).toBeLessThan(50)
    await expect(panel.getByRole('button', { name: 'Remove collection', exact: true })).toBeInViewport({ ratio: 1 })
    await expect(panel.getByRole('combobox', { name: 'Collection for Alpha reference' })).toBeInViewport({ ratio: 1 })
    expect(await panel.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
    await testInfo.attach('bookmark-collection-compact', { body: await panel.screenshot(), contentType: 'image/png' })
    await closeHronaut(instance.app)
    instance = await launchHronaut(profileDirectory, mcpPort)
    const restored = await instance.window.evaluate(async () => {
      const api = (window as unknown as { hronautBookmarks: HronautBookmarksApi }).hronautBookmarks
      return { bookmarks: await api.list(), organization: await api.collections!.list() }
    })
    expect(restored.bookmarks).toEqual(entries)
    expect(restored.organization.collections).toEqual([{
      id: projectValue.slice(2), name: 'Renamed project', bookmarkIds: [entries.find(entry => entry.title === 'Alpha reference')!.id]
    }])
    await instance.window.getByRole('button', { name: 'Bookmarks', exact: true }).click()
    panel = instance.window.getByRole('dialog', { name: 'Bookmarks' })
    filter = panel.getByRole('combobox', { name: 'Filter bookmarks by collection' })
    await filter.selectOption(projectValue)
    await panel.getByRole('button', { name: 'Remove collection', exact: true }).click()
    await expect(filter).toHaveValue('unfiled')
    await expect(filter).toBeFocused()
    await expect(panel.locator('.bookmark-item')).toHaveCount(2)
    expect(await instance.window.evaluate('window.hronautBookmarks.list()')).toEqual(entries)

    // A main-process update can remove toolbar controls without a panel action.
    for (const control of ['rename', 'editor'] as const) {
      const collection = await instance.window.evaluate(async () => {
        const api = (window as unknown as { hronautBookmarks: HronautBookmarksApi }).hronautBookmarks
        const snapshot = await api.collections!.create('External removal')
        return snapshot.collections.find(item => item.name === 'External removal')!
      })
      await filter.selectOption(`c:${collection.id}`)
      const rename = panel.getByRole('button', { name: 'Rename collection', exact: true })
      if (control === 'editor') {
        await rename.click()
        await expect(panel.getByRole('textbox', { name: 'Collection name', exact: true })).toBeFocused()
      } else await rename.focus()
      await instance.window.evaluate(async id => {
        const api = (window as unknown as { hronautBookmarks: HronautBookmarksApi }).hronautBookmarks
        await api.collections!.remove(id)
      }, collection.id)
      await expect(filter).toHaveValue('unfiled')
      await expect(filter).toBeFocused()
      await expect(panel.getByRole('textbox', { name: 'Collection name', exact: true })).toHaveCount(0)
      expect(await instance.window.evaluate('window.hronautBookmarks.list()')).toEqual(entries)
    }
  } finally { await closeHronaut(instance.app) }
})
