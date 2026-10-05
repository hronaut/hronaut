import { expect, test } from './fixtures.js'
import type { HronautBookmarksApi } from '../../src/shared/types.js'

test('keeps keyboard focus usable through bookmark removal and empty search results', async ({ appWindow }) => {
  await appWindow.evaluate(async () => {
    const bookmarks = (window as unknown as { hronautBookmarks: HronautBookmarksApi }).hronautBookmarks
    await bookmarks.add('https://example.test/alpha', 'Alpha docs')
    await bookmarks.add('https://example.test/beta', 'Beta page')
    await bookmarks.add('https://example.test/gamma', 'Gamma guide')
  })
  await appWindow.getByRole('button', { name: 'New tab' }).click()
  await appWindow.getByRole('button', { name: 'Bookmarks', exact: true }).click()
  const panel = appWindow.getByRole('dialog', { name: 'Bookmarks' })
  const removals = panel.getByRole('button', { name: /^Remove (Alpha docs|Beta page|Gamma guide)$/ })
  const nextName = await removals.nth(1).getAttribute('aria-label')
  await removals.first().focus()
  await appWindow.keyboard.press('Enter')
  await expect(removals).toHaveCount(2)
  await expect(panel.getByRole('button', { name: nextName!, exact: true })).toBeFocused()

  const lastName = await removals.last().getAttribute('aria-label')
  const search = panel.getByRole('searchbox', { name: 'Search bookmarks' })
  await search.fill(lastName!.replace(/^Remove /, ''))
  await expect(removals).toHaveCount(1)
  await removals.first().focus()
  await appWindow.keyboard.press('Enter')
  await expect(panel).toContainText('No matching bookmarks')
  await expect(search).toBeFocused()

  await search.fill('')
  await expect(removals).toHaveCount(1)
  await removals.first().focus()
  await appWindow.keyboard.press('Enter')
  await expect(panel).toContainText('No bookmarks yet')
  const close = panel.getByRole('button', { name: 'Close bookmarks' })
  await expect(close).toBeFocused()
  await appWindow.keyboard.press('Enter')
  await expect(panel).not.toBeVisible()
})
