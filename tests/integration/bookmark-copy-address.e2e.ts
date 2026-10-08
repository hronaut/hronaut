import type { HronautApi, HronautBookmarksApi } from '../../src/shared/types.js'
import { expect, test } from './fixtures.js'

test('copies a saved bookmark URL without navigation and preserves filters and keyboard focus', async ({ appWindow, electronApp }, testInfo) => {
  await appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.newTab({ url: 'about:blank', active: true }))
  const url = 'https://example.test/reference?q=alpha%20beta#section-2'
  const stored = await appWindow.evaluate(async url => {
    const api = (window as unknown as { hronautBookmarks: HronautBookmarksApi }).hronautBookmarks
    await api.add(url, 'Copy reference')
    return (await api.list()).find(item => item.title === 'Copy reference')!
  }, url)
  expect(stored.url).toBe(url)
  const state = () => appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState())
  const before = await state()
  await appWindow.getByRole('button', { name: 'Bookmarks', exact: true }).click()
  const panel = appWindow.getByRole('dialog', { name: 'Bookmarks' })
  const search = panel.getByRole('searchbox')
  const collection = panel.getByRole('combobox', { name: 'Filter bookmarks by collection' })
  await search.fill('Copy reference')
  await collection.selectOption('unfiled')
  const copy = panel.getByRole('button', { name: 'Copy address for Copy reference' })
  await copy.focus()
  for (const key of ['Enter', 'Space']) {
    await electronApp.evaluate(({ clipboard }) => clipboard.writeText('synthetic sentinel'))
    await copy.press(key)
    await expect.poll(() => electronApp.evaluate(({ clipboard }) => clipboard.readText())).toBe(url)
    await expect(panel.getByRole('status')).toHaveText('Address copied')
    await expect(copy).toBeFocused()
    await expect(search).toHaveValue('Copy reference')
    await expect(collection).toHaveValue('unfiled')
    const after = await state()
    expect(after.activeTabId).toBe(before.activeTabId)
    expect(after.tabs.map(tab => [tab.id, tab.url])).toEqual(before.tabs.map(tab => [tab.id, tab.url]))
  }
  await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(760, 760))
  await expect(copy).toBeInViewport({ ratio: 1 })
  expect(await panel.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
  await testInfo.attach('bookmark-copy-compact', { body: await panel.screenshot(), contentType: 'image/png' })
  await search.fill('changed query')
  await expect(panel.getByRole('status')).toHaveCount(0)
})
