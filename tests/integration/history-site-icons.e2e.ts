import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import type { Page } from '@playwright/test'
import type { HronautApi, HronautBookmarksApi, HronautHistoryApi } from '../../src/shared/types.js'
import { closeFixtureServer, closeHronaut, expect, launchHronaut, test } from './fixtures.js'

interface ShellApis {
  hronaut: HronautApi
  hronautBookmarks: HronautBookmarksApi
  hronautHistory: HronautHistoryApi
}

// History and Bookmarks showed a globe beside every page. As in Chrome, each page now shows its website's icon, as a tab
// last showed it, also after a restart, and the icon goes once neither of them holds a page of the website.
test('History and Bookmarks show each page by its website\'s icon, kept as long as they hold a page of it', async ({ profileDirectory, mcpPort }) => {
  const png = await readFile(new URL('../../build/icons/64x64.png', import.meta.url))
  const server = createServer((request, response) => {
    if (request.url === '/icon.png') {
      response.writeHead(200, { 'content-type': 'image/png', 'content-length': String(png.length) })
      response.end(png)
      return
    }
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>Icon page</title><link rel="icon" href="/icon.png"><main>Icon page</main>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const url = `${origin}/page`
  const historyIcon = (page: Page) => page.getByRole('dialog', { name: 'Browsing history' })
    .locator('.history-item', { hasText: 'Icon page' }).locator('.history-site-icon img')
  const bookmarkIcon = (page: Page) => page.getByRole('dialog', { name: 'Bookmarks' })
    .locator('.bookmark-item', { hasText: 'Icon page' }).locator('.bookmark-site-icon img')
  let instance = await launchHronaut(profileDirectory, mcpPort)
  try {
    const page = instance.window
    await page.evaluate((address) => (window as unknown as ShellApis).hronaut.newTab({ url: address, active: true }), url)
    const shown = () => page.evaluate(() => (window as unknown as ShellApis).hronaut.getState()
      .then((state) => state.tabs.find((tab) => tab.active)?.faviconDataUrl))
    await expect.poll(shown).toMatch(/^data:image\/png;base64,/)
    const icon = (await shown())!

    await page.getByRole('button', { name: 'Browsing history', exact: true }).click()
    await expect(historyIcon(page)).toHaveAttribute('src', icon)
    await page.getByRole('dialog', { name: 'Browsing history' }).getByRole('button', { name: 'Close browsing history' }).click()
    await page.evaluate((address) => (window as unknown as ShellApis).hronautBookmarks.add(address, 'Icon page'), url)
    await page.getByRole('button', { name: 'Bookmarks', exact: true }).click()
    await expect(bookmarkIcon(page)).toHaveAttribute('src', icon)

    // After a restart, with no tab of the website left to show its icon again.
    const tabId = await page.evaluate(() => (window as unknown as ShellApis).hronaut.getState().then((state) => state.activeTabId))
    await page.evaluate((id) => (window as unknown as ShellApis).hronaut.closeTab(id!), tabId)
    await closeHronaut(instance.app)
    instance = await launchHronaut(profileDirectory, mcpPort)
    const restarted = instance.window
    await restarted.getByRole('button', { name: 'Browsing history', exact: true }).click()
    await expect(historyIcon(restarted)).toHaveAttribute('src', icon)

    // Clearing the history keeps the icon of a website bookmarked; removing the bookmark then lets it go.
    await restarted.evaluate(() => (window as unknown as ShellApis).hronautHistory.clear())
    expect(await restarted.evaluate(() => (window as unknown as ShellApis).hronautHistory.siteIcons())).toEqual({ [origin]: icon })
    const [bookmark] = await restarted.evaluate(() => (window as unknown as ShellApis).hronautBookmarks.list())
    await restarted.evaluate((id) => (window as unknown as ShellApis).hronautBookmarks.remove(id), bookmark!.id)
    expect(await restarted.evaluate(() => (window as unknown as ShellApis).hronautHistory.siteIcons())).toEqual({})
    await expect.poll(async () => (await readFile(`${profileDirectory}/site-icons.json`, 'utf8')).includes(icon.split(',')[1]!)).toBe(false)
  } finally {
    await closeHronaut(instance.app)
    await closeFixtureServer(server)
  }
})
