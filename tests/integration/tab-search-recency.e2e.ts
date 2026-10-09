import type { HronautApi } from '../../src/shared/types.js'
import { expect, test } from './fixtures.js'

test('refreshes recently closed labels in an idle overview without moving focus', async ({ appWindow }) => {
  const url = 'data:text/html,<title>Recency fixture</title><main>Recency fixture</main>'
  const opened = await appWindow.evaluate(url => (window as unknown as { hronaut: HronautApi }).hronaut.newTab({ url, active: true }), url)
  const tabId = opened.activeTabId!
  await expect.poll(() => appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.getState().then(state => state.tabs.find(tab => tab.id === id)?.title), tabId)).toBe('Recency fixture')
  await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.closeTab(id), tabId)
  const before = await appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState())
  const closed = before.closedTabs.find(tab => tab.url === url)!
  const start = new Date(Date.parse(closed.closedAt) + 10_000)
  await appWindow.clock.install({ time: new Date(start.getTime() - 60_000) })
  await appWindow.clock.pauseAt(start)
  try {
    await appWindow.getByRole('button', { name: 'Search tabs', exact: true }).click()
    const panel = appWindow.getByRole('dialog', { name: 'Tabs', exact: true })
    await panel.getByRole('combobox', { name: 'Result type' }).selectOption('closed')
    const row = panel.locator('.tab-search-item.closed').filter({ hasText: 'Recency fixture' })
    const search = panel.getByRole('searchbox')
    await search.focus()
    await expect(row).toContainText('Closed just now')
    await appWindow.clock.fastForward(60_000)
    await expect(row).toContainText('Closed 1 min ago')
    await expect(search).toBeFocused()
    await appWindow.clock.fastForward(60_000)
    await expect(row).toContainText('Closed 2 min ago')
    await expect(search).toBeFocused()
    const after = await appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState())
    expect(after.closedTabs).toEqual(before.closedTabs)
    expect(after.activeTabId).toBe(before.activeTabId)
    expect(after.tabs.map(tab => tab.id)).toEqual(before.tabs.map(tab => tab.id))
  } finally { await appWindow.clock.resume() }
})
