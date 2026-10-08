import type { HronautBookmarksApi } from '../../src/shared/types.js'
import { expect, test } from './fixtures.js'

const cases = (['remove', 'collection'] as const).flatMap(update =>
  (['row', 'search', 'filter'] as const).map(control => ({ update, control })))

for (const { update, control } of cases) {
  test(`preserves bookmark ${control} focus after an external ${update} update removes a row`, async ({ appWindow }, testInfo) => {
    const state = await appWindow.evaluate(async () => {
      const api = (window as unknown as { hronautBookmarks: HronautBookmarksApi }).hronautBookmarks
      await api.add('https://example.test/alpha', 'Alpha reference')
      const entries = await api.add('https://example.test/beta', 'Beta reference')
      const collections = await api.collections!.create('Project')
      return { alpha: entries.find(entry => entry.title === 'Alpha reference')!.id, project: collections.collections[0]!.id }
    })
    await appWindow.getByRole('button', { name: 'New tab', exact: true }).click()
    await appWindow.getByRole('button', { name: 'Bookmarks', exact: true }).click()
    const panel = appWindow.getByRole('dialog', { name: 'Bookmarks' })
    const filter = panel.getByRole('combobox', { name: 'Filter bookmarks by collection' })
    await filter.selectOption('unfiled')
    const search = panel.getByRole('searchbox')
    await search.fill('reference')
    const focused = control === 'search' ? search : control === 'filter' ? filter
      : panel.getByRole('button', { name: 'Open Alpha reference in background tab' })
    await focused.focus()
    await expect(focused).toBeFocused()
    await appWindow.evaluate(async ({ update, state }) => {
      const api = (window as unknown as { hronautBookmarks: HronautBookmarksApi }).hronautBookmarks
      if (update === 'remove') await api.remove(state.alpha)
      else await api.collections!.assign(state.alpha, state.project)
    }, { update, state })
    await expect(panel.locator('.bookmark-item')).toHaveCount(1)
    await expect(filter).toHaveValue('unfiled')
    await expect(search).toHaveValue('reference')
    await testInfo.attach('focus-after-external-update', {
      body: JSON.stringify(await appWindow.evaluate(() => ({ tag: document.activeElement?.tagName, class: document.activeElement?.className }))),
      contentType: 'application/json'
    })
    await expect(control === 'row' ? panel.getByRole('button', { name: 'Open Beta reference in background tab' }) : focused).toBeFocused()
  })
}
