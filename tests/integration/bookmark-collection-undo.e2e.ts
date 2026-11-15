import type { HronautBookmarksApi } from '../../src/shared/types.js'
import { expect, test } from './fixtures.js'
import { toastText } from './toast-view.js'

// Remove collection could not be undone, so a slip lost the collection and which bookmarks it held.
test('puts a removed bookmark collection back with its bookmarks with Ctrl+Z, and shows it again', async ({ appWindow, electronApp }) => {
  const { entries, collectionId } = await appWindow.evaluate(async () => {
    const api = (window as unknown as { hronautBookmarks: HronautBookmarksApi }).hronautBookmarks
    await api.add('https://example.test/alpha', 'Alpha reference')
    const saved = await api.add('https://example.test/beta', 'Beta reference')
    const entries = ['Alpha reference', 'Beta reference'].map(title => saved.find(entry => entry.title === title)!)
    const snapshot = await api.collections!.create('Project')
    const collectionId = snapshot.collections.find(collection => collection.name === 'Project')!.id
    for (const entry of entries) await api.collections!.assign(entry.id, collectionId)
    return { entries, collectionId }
  })
  const collections = () => appWindow.evaluate(async () => {
    const api = (window as unknown as { hronautBookmarks: HronautBookmarksApi }).hronautBookmarks
    return (await api.collections!.list()).collections
  })

  // The Bookmarks button is on a tab's toolbar, as in the collections test.
  await appWindow.getByRole('button', { name: 'New tab', exact: true }).click()
  await appWindow.getByRole('button', { name: 'Bookmarks', exact: true }).click()
  const panel = appWindow.getByRole('dialog', { name: 'Bookmarks' })
  const filter = panel.getByRole('combobox', { name: 'Filter bookmarks by collection' })
  await filter.selectOption(`c:${collectionId}`)
  await expect(panel.locator('.bookmark-item')).toHaveCount(2)
  await panel.getByRole('button', { name: 'Remove collection', exact: true }).click()
  await expect(filter).toHaveValue('unfiled')
  await expect(filter).toBeFocused()
  await expect.poll(collections).toEqual([])

  const removed = appWindow.getByRole('status', { name: 'Collection removed' })
  await expect(removed).toBeAttached()
  await expect.poll(() => toastText(electronApp)).toContain('Project')
  // Ctrl+Z from the filter, where Remove collection leaves the keyboard. A select kept Ctrl+Z as a text field does.
  await appWindow.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => toastText(electronApp)).toBeNull()

  await expect.poll(collections).toEqual([{ id: collectionId, name: 'Project', bookmarkIds: entries.map(entry => entry.id) }])
  // The panel shows the collection again, which stayed on Unfiled.
  await expect(filter).toHaveValue(`c:${collectionId}`)
  await expect(panel.locator('.bookmark-item')).toHaveCount(2)
})
