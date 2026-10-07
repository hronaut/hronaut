import { createServer } from 'node:http'
import type { HronautApi, HronautBookmarksApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

test('opens bookmarks explicitly in the background while retaining the active page, panel and focus', async ({ appWindow, electronApp }, testInfo) => {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(`<!doctype html><title>${request.url === '/current' ? 'Current fixture' : 'Background fixture'}</title><h1>Synthetic bookmark fixture</h1>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const state = () => appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState())
  try {
    await appWindow.evaluate(async origin => {
      const api = window as unknown as { hronaut: HronautApi; hronautBookmarks: HronautBookmarksApi }
      await api.hronaut.newTab({ url: `${origin}/current`, active: true })
      await api.hronautBookmarks.add(`${origin}/background`, 'Background fixture')
    }, origin)
    await expect.poll(async () => (await state()).tabs.find(tab => tab.url === `${origin}/current`)?.loading).toBe(false)
    const before = await state()
    await appWindow.getByRole('button', { name: 'Bookmarks', exact: true }).click()
    const panel = appWindow.getByRole('dialog', { name: 'Bookmarks' })
    const search = panel.getByRole('searchbox')
    await search.fill('Background')
    const button = panel.getByRole('button', { name: 'Open Background fixture in background tab' })
    await button.focus()
    await button.press('Enter')
    await expect.poll(async () => (await state()).tabs.filter(tab => tab.url === `${origin}/background` && !tab.loading).length).toBe(1)
    const after = await state()
    expect(after.activeTabId).toBe(before.activeTabId)
    expect(after.tabs.find(tab => tab.id === before.activeTabId)?.url).toBe(`${origin}/current`)
    expect(after.tabs.length).toBe(before.tabs.length + 1)
    await expect(panel).toBeVisible()
    await expect(search).toHaveValue('Background')
    await expect(button).toBeFocused()
    await expect(button).toHaveAttribute('aria-disabled', 'false')
    // A second deliberate activation opens another background tab, not the foreground.
    await button.press('Space')
    await expect.poll(async () => (await state()).tabs.filter(tab => tab.url === `${origin}/background` && !tab.loading).length).toBe(2)
    expect((await state()).activeTabId).toBe(before.activeTabId)
    await expect(button).toBeFocused()
    await panel.getByRole('button', { name: 'Close bookmarks' }).click()
    await appWindow.getByRole('button', { name: 'Bookmarks', exact: true }).click()
    await expect(search).toHaveValue('Background')
    await testInfo.attach('bookmark-background', { body: await panel.screenshot(), contentType: 'image/png' })
    // Normal opening retains its established foreground behavior.
    await panel.getByRole('button', { name: `Background fixture ${origin}/background`, exact: true }).click()
    await expect(panel).toHaveCount(0)
    await expect.poll(async () => (await state()).activeTabId).not.toBe(before.activeTabId)
    await expect.poll(() => electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents().filter(page => page.getURL() === url).length, `${origin}/background`)).toBe(3)
  } finally {
    await closeFixtureServer(server)
  }
})
