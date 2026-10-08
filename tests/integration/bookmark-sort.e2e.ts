import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { HronautBookmarksApi } from '../../src/shared/types.js'
import { closeHronaut, expect, launchHronaut, test } from './fixtures.js'

test('sorts bookmarks within search and collections without persisting order, and retains live row focus', async ({ profileDirectory, mcpPort }, testInfo) => {
  let instance = await launchHronaut(profileDirectory, mcpPort)
  try {
    const setup = await instance.window.evaluate(async () => {
      const api = (window as unknown as { hronautBookmarks: HronautBookmarksApi }).hronautBookmarks
      await api.add('https://example.test/zebra', 'Zebra')
      await api.add('https://example.test/page10', 'Page 10')
      const entries = await api.add('https://example.test/page2', 'Page 2')
      const created = await api.collections!.create('Reference')
      const id = created.collections[0]!.id
      for (const entry of entries.filter(entry => entry.title.startsWith('Page'))) await api.collections!.assign(entry.id, id)
      return { entries, id }
    })
    const storedBefore = await readFile(join(profileDirectory, 'bookmarks.json'), 'utf8')
    await instance.window.getByRole('button', { name: 'New tab', exact: true }).click()
    await instance.window.getByRole('button', { name: 'Bookmarks', exact: true }).click()
    let panel = instance.window.getByRole('dialog', { name: 'Bookmarks' })
    let sort = panel.getByRole('combobox', { name: 'Sort bookmarks' })
    const titles = () => panel.locator('.bookmark-copy strong')
    await expect(sort).toHaveValue('updated')
    await expect(titles()).toHaveText(setup.entries.map(entry => entry.title))
    await sort.focus()
    await sort.press('ArrowDown')
    await expect(sort).toHaveValue('title')
    await expect(sort).toBeFocused()
    await expect(titles()).toHaveText(['Page 2', 'Page 10', 'Zebra'])
    const filter = panel.getByRole('combobox', { name: 'Filter bookmarks by collection' })
    await filter.selectOption(`c:${setup.id}`)
    await expect(titles()).toHaveText(['Page 2', 'Page 10'])
    await panel.getByRole('searchbox').fill('10')
    await expect(titles()).toHaveText(['Page 10'])
    await panel.getByRole('searchbox').fill('missing')
    await expect(panel.locator('.bookmark-item')).toHaveCount(0)
    await expect(sort).toBeEnabled()
    await panel.getByRole('searchbox').fill('')
    await filter.selectOption('all')
    expect(await readFile(join(profileDirectory, 'bookmarks.json'), 'utf8')).toBe(storedBefore)
    expect(await instance.window.evaluate('window.hronautBookmarks.list()')).toEqual(setup.entries)
    await panel.getByRole('button', { name: 'Copy address for Zebra' }).focus()
    await instance.window.evaluate(async id => {
      await (window as unknown as { hronautBookmarks: HronautBookmarksApi }).hronautBookmarks.rename(id, 'Alpha')
    }, setup.entries.find(entry => entry.title === 'Zebra')!.id)
    await expect(titles()).toHaveText(['Alpha', 'Page 2', 'Page 10'])
    await expect(panel.getByRole('button', { name: 'Copy address for Alpha' })).toBeFocused()
    await panel.getByRole('button', { name: 'Close bookmarks' }).click()
    await instance.window.getByRole('button', { name: 'Bookmarks', exact: true }).click()
    await expect(sort).toHaveValue('title')
    await instance.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(760, 760))
    await expect(sort).toBeInViewport({ ratio: 1 })
    expect(await panel.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
    await testInfo.attach('bookmark-title-order-compact', { body: await panel.screenshot(), contentType: 'image/png' })
    await closeHronaut(instance.app)
    instance = await launchHronaut(profileDirectory, mcpPort)
    await instance.window.getByRole('button', { name: 'Bookmarks', exact: true }).click()
    panel = instance.window.getByRole('dialog', { name: 'Bookmarks' })
    sort = panel.getByRole('combobox', { name: 'Sort bookmarks' })
    await expect(sort).toHaveValue('updated')
    const persisted = await instance.window.evaluate('window.hronautBookmarks.list()') as Array<{ title: string }>
    await expect(titles()).toHaveText(persisted.map(entry => entry.title))
  } finally { await closeHronaut(instance.app) }
})
