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

// History and Bookmarks showed a globe beside every page. As in Chrome, each page now shows the icon a tab showed for
// it, also after a restart, and the icon goes once neither of them holds the page.
test('History and Bookmarks show each page by its icon, kept as long as they hold the page', async ({ profileDirectory, mcpPort }) => {
  const icons: Record<string, Buffer> = {
    '/document.png': await readFile(new URL('../../build/icons/64x64.png', import.meta.url)),
    '/sheet.png': await readFile(new URL('../../build/icons/tray-attention.png', import.meta.url))
  }
  const server = createServer((request, response) => {
    const icon = icons[request.url ?? '']
    if (icon) {
      response.writeHead(200, { 'content-type': 'image/png', 'content-length': String(icon.length) })
      response.end(icon)
      return
    }
    // Two pages of one website, each with an icon of its own, as a website's documents and spreadsheets have.
    const name = request.url === '/sheet' ? 'Sheet' : 'Document'
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(`<!doctype html><title>${name} page</title><link rel="icon" href="/${name.toLowerCase()}.png"><main>${name}</main>`)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const historyIcon = (page: Page, title: string) => page.getByRole('dialog', { name: 'Browsing history' })
    .locator('.history-item', { hasText: title }).locator('.history-site-icon img')
  const bookmarkIcon = (page: Page, title: string) => page.getByRole('dialog', { name: 'Bookmarks' })
    .locator('.bookmark-item', { hasText: title }).locator('.bookmark-site-icon img')
  try {
    let instance = await launchHronaut(profileDirectory, mcpPort)
    try {
      const page = instance.window
      const open = async (path: string): Promise<string> => {
        const tab = await page.evaluate((address) => (window as unknown as ShellApis).hronaut.newTab({ url: address, active: true }), `${origin}${path}`)
        const shown = () => page.evaluate((id) => (window as unknown as ShellApis).hronaut.getState()
          .then((state) => state.tabs.find((candidate) => candidate.id === id)?.faviconDataUrl), tab.activeTabId)
        await expect.poll(shown).toMatch(/^data:image\/png;base64,/)
        return (await shown())!
      }
      const documentIcon = await open('/document')
      const sheetIcon = await open('/sheet')
      expect(sheetIcon).not.toBe(documentIcon)

      await page.getByRole('button', { name: 'Browsing history', exact: true }).click()
      await expect(historyIcon(page, 'Document page')).toHaveAttribute('src', documentIcon)
      await expect(historyIcon(page, 'Sheet page')).toHaveAttribute('src', sheetIcon)
      await page.getByRole('dialog', { name: 'Browsing history' }).getByRole('button', { name: 'Close browsing history' }).click()
      // A page no tab has shown shows the icon its website showed last.
      await page.evaluate((address) => (window as unknown as ShellApis).hronautBookmarks.add(`${address}/document`, 'Document page'), origin)
      await page.evaluate((address) => (window as unknown as ShellApis).hronautBookmarks.add(`${address}/unvisited`, 'Unvisited page'), origin)
      await page.getByRole('button', { name: 'Bookmarks', exact: true }).click()
      await expect(bookmarkIcon(page, 'Document page')).toHaveAttribute('src', documentIcon)
      await expect(bookmarkIcon(page, 'Unvisited page')).toHaveAttribute('src', sheetIcon)

      // After a restart, with no tab of the website left to show its icons again.
      const state = await page.evaluate(() => (window as unknown as ShellApis).hronaut.getState())
      for (const tab of state.tabs.filter((candidate) => candidate.url.startsWith(origin))) {
        await page.evaluate((id) => (window as unknown as ShellApis).hronaut.closeTab(id), tab.id)
      }
      await closeHronaut(instance.app)
      instance = await launchHronaut(profileDirectory, mcpPort)
      const restarted = instance.window
      await restarted.getByRole('button', { name: 'Browsing history', exact: true }).click()
      await expect(historyIcon(restarted, 'Document page')).toHaveAttribute('src', documentIcon)
      await expect(historyIcon(restarted, 'Sheet page')).toHaveAttribute('src', sheetIcon)

      // Clearing the history keeps the icon of the page bookmarked; removing the bookmark then lets it go.
      const kept = () => restarted.evaluate(() => (window as unknown as ShellApis).hronautHistory.siteIcons()).then(({ pages, icons: byId }) => (
        Object.fromEntries(Object.entries(pages).map(([url, id]) => [url, byId[id]]))
      ))
      await restarted.evaluate(() => (window as unknown as ShellApis).hronautHistory.clear())
      expect(await kept()).toEqual({ [`${origin}/document`]: documentIcon })
      const bookmarks = await restarted.evaluate(() => (window as unknown as ShellApis).hronautBookmarks.list())
      for (const bookmark of bookmarks) await restarted.evaluate((id) => (window as unknown as ShellApis).hronautBookmarks.remove(id), bookmark.id)
      expect(await kept()).toEqual({})
      await expect.poll(async () => (await readFile(`${profileDirectory}/site-icons.json`, 'utf8')).includes(documentIcon.split(',')[1]!)).toBe(false)
    } finally {
      await closeHronaut(instance.app)
    }
  } finally {
    await closeFixtureServer(server)
  }
})
