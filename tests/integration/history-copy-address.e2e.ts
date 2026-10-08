import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { HronautApi, HronautHistoryApi } from '../../src/shared/types.js'
import { closeHronaut, expect, launchHronaut, test } from './fixtures.js'

test('copies a stored History address without navigation and retains filters and keyboard focus', async ({ profileDirectory, mcpPort }, testInfo) => {
  const url = 'https://example.test/reference?q=alpha%20beta#section-2'
  await writeFile(join(profileDirectory, 'history.json'), JSON.stringify({ version: 1, entries: [{
    id: 'copy-history', title: 'Copy reference', url, visitedAt: new Date().toISOString(), visitCount: 1
  }] }))
  const instance = await launchHronaut(profileDirectory, mcpPort)
  const { window: appWindow, app: electronApp } = instance
  try {
    const stored = await appWindow.evaluate(() => (window as unknown as { hronautHistory: HronautHistoryApi }).hronautHistory.list())
    expect(stored).toHaveLength(1)
    expect(stored[0]!.url).toBe('https://example.test/reference?q=alpha%20beta')
    const before = await appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState())
    await appWindow.getByRole('button', { name: 'Browsing history', exact: true }).click()
    const panel = appWindow.getByRole('dialog', { name: 'Browsing history' })
    const search = panel.getByRole('searchbox')
    const date = panel.getByRole('combobox', { name: 'Date range' })
    await search.fill('Copy reference')
    await date.selectOption('today')
    const copy = panel.getByRole('button', { name: 'Copy address for Copy reference' })
    await expect(copy).toBeVisible()
    await copy.focus()
    for (const key of ['Enter', 'Space']) {
      await electronApp.evaluate(({ clipboard }) => clipboard.writeText('synthetic sentinel'))
      await copy.press(key)
      await expect.poll(() => electronApp.evaluate(({ clipboard }) => clipboard.readText())).toBe(stored[0]!.url)
      await expect(panel.getByRole('status')).toHaveText('Address copied')
      await expect(copy).toBeFocused()
      await expect(search).toHaveValue('Copy reference')
      await expect(date).toHaveValue('today')
      const after = await appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState())
      expect(after.activeTabId).toBe(before.activeTabId)
      expect(after.tabs.map(tab => [tab.id, tab.url])).toEqual(before.tabs.map(tab => [tab.id, tab.url]))
    }
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(760, 760))
    await expect(copy).toBeInViewport({ ratio: 1 })
    expect(await panel.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
    await testInfo.attach('history-copy-compact', { body: await panel.screenshot(), contentType: 'image/png' })
    await search.fill('changed query')
    await expect(panel.getByRole('status')).toHaveCount(0)
  } finally { await closeHronaut(electronApp) }
})
