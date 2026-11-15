import type { HronautApi } from '../../src/shared/types.js'
import { expect, test } from './fixtures.js'
import { openTabsView } from './home-tabs-view.js'

test('refreshes recently closed labels in an idle Tabs view without moving focus', async ({ appWindow, electronApp }) => {
  const url = 'data:text/html,<title>Recency fixture</title><main>Recency fixture</main>'
  const opened = await appWindow.evaluate(url => (window as unknown as { hronaut: HronautApi }).hronaut.newTab({ url, active: true }), url)
  const tabId = opened.activeTabId!
  await expect.poll(() => appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.getState().then(state => state.tabs.find(tab => tab.id === id)?.title), tabId)).toBe('Recency fixture')
  await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.closeTab(id), tabId)
  // The Undo toast's view loads with the first toast; the clock below goes into every page, so it waits for that one.
  await expect.poll(() => electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().flatMap(window => window.contentView.children)
    .some(child => 'webContents' in child && (child as Electron.WebContentsView).webContents.getURL().endsWith('toast-overlay.html') && child.getVisible()))).toBe(true)
  const before = await appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState())
  const closed = before.closedTabs.find(tab => tab.url === url)!
  const start = new Date(Date.parse(closed.closedAt) + 10_000)
  await appWindow.clock.install({ time: new Date(start.getTime() - 60_000) })
  await appWindow.clock.pauseAt(start)
  try {
    const { view, search } = await openTabsView(appWindow, electronApp)
    await view.getByRole('tab', { name: 'Recently closed', exact: true }).click()
    const row = view.locator('.tab-row.closed').filter({ hasText: 'Recency fixture' })
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
    expect(after.tabs.find(tab => tab.id === after.activeTabId)?.url).toMatch(/^hronaut:\/\/home/u)
    expect(after.tabs.map(tab => tab.id)).toEqual(before.tabs.map(tab => tab.id))
  } finally { await appWindow.clock.resume() }
})
