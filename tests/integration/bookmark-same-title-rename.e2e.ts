import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { BrowserBookmark, HronautBookmarksApi } from '../../src/shared/types.js'
import { expect, test } from './fixtures.js'

test('keeps a bookmark in its place in Recently updated when Rename saves the same title', async ({ appWindow, profileDirectory }) => {
  await appWindow.evaluate(async () => {
    const api = (window as unknown as { hronautBookmarks: HronautBookmarksApi }).hronautBookmarks
    for (const name of ['Alpha', 'Beta', 'Gamma']) {
      await api.add(`https://example.test/${name.toLowerCase()}`, name)
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  })
  const stored = await readFile(join(profileDirectory, 'bookmarks.json'), 'utf8')
  const savedOrder = async (): Promise<string[]> => (await appWindow.evaluate('window.hronautBookmarks.list()') as BrowserBookmark[]).map((bookmark) => bookmark.title)
  expect(await savedOrder()).toEqual(['Gamma', 'Beta', 'Alpha'])
  await appWindow.getByRole('button', { name: 'New tab', exact: true }).click()
  await appWindow.getByRole('button', { name: 'Bookmarks', exact: true }).click()
  const panel = appWindow.getByRole('dialog', { name: 'Bookmarks' })
  const titles = panel.locator('.bookmark-copy strong')
  await expect(panel.getByRole('combobox', { name: 'Sort bookmarks' })).toHaveValue('updated')
  await expect(titles).toHaveText(['Gamma', 'Beta', 'Alpha'])

  // Enter in the name field, then the check button, each without a change to the name.
  await panel.getByRole('button', { name: 'Rename Alpha', exact: true }).click()
  await expect(panel.getByRole('textbox', { name: 'Rename Alpha', exact: true })).toBeFocused()
  await appWindow.keyboard.press('Enter')
  await expect(panel.getByRole('button', { name: 'Rename Alpha', exact: true })).toBeVisible()
  expect(await savedOrder()).toEqual(['Gamma', 'Beta', 'Alpha'])
  await panel.getByRole('button', { name: 'Rename Alpha', exact: true }).click()
  await panel.getByRole('button', { name: 'Save name for Alpha', exact: true }).click()
  await expect(panel.getByRole('button', { name: 'Rename Alpha', exact: true })).toBeVisible()

  expect(await savedOrder()).toEqual(['Gamma', 'Beta', 'Alpha'])
  await expect(titles).toHaveText(['Gamma', 'Beta', 'Alpha'])
  expect(await readFile(join(profileDirectory, 'bookmarks.json'), 'utf8')).toBe(stored)
})
