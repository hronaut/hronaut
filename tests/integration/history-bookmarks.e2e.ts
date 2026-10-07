import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { HronautBookmarksApi, HronautHistoryApi, HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

test('saves History bookmarks without navigating and preserves existing custom bookmarks', async ({ appWindow, electronApp, profileDirectory }, testInfo) => {
  const requests: string[] = []
  const server = createServer((request, response) => {
    requests.push(request.url ?? '')
    response.writeHead(200, { 'content-type': 'text/html' })
    const title = request.url === '/alpha' ? 'History alpha' : 'History beta'
    response.end(`<!doctype html><title>${title}</title><h1>${title}</h1>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const pageUrls = () => electronApp.evaluate(({ webContents }) => webContents.getAllWebContents().map(page => ({ id: page.id, url: page.getURL() })).sort((a, b) => a.id - b.id))
  try {
    await appWindow.evaluate(url => (window as unknown as { hronaut: HronautApi }).hronaut.newTab({ url, active: true }), `${origin}/alpha`)
    await expect.poll(() => appWindow.evaluate(() => (window as unknown as { hronautHistory: HronautHistoryApi }).hronautHistory.list())).toEqual([
      expect.objectContaining({ title: 'History alpha', url: `${origin}/alpha` })
    ])
    await appWindow.evaluate(url => (window as unknown as { hronaut: HronautApi }).hronaut.navigate({ url }), `${origin}/beta`)
    await expect.poll(() => appWindow.evaluate(() => (window as unknown as { hronautHistory: HronautHistoryApi }).hronautHistory.list())).toHaveLength(2)
    const original = await appWindow.evaluate(async url => {
      const api = (window as unknown as { hronautBookmarks: HronautBookmarksApi }).hronautBookmarks
      await api.add(url, 'My custom beta title')
      return (await api.list()).find(bookmark => bookmark.url === url)!
    }, `${origin}/beta`)
    await appWindow.getByRole('button', { name: 'Browsing history', exact: true }).click()
    const panel = appWindow.getByRole('dialog', { name: 'Browsing history' })
    const search = panel.getByRole('searchbox')
    const beforeUrls = await pageUrls()
    const beforeHistory = await appWindow.evaluate(() => (window as unknown as { hronautHistory: HronautHistoryApi }).hronautHistory.list())
    const alphaRequests = requests.filter(url => url === '/alpha').length
    const existing = panel.getByRole('button', { name: 'Already bookmarked: History beta', exact: true })
    await expect(existing).toHaveAttribute('aria-disabled', 'true')
    await existing.focus()
    await existing.press('Enter')
    await expect(existing).toBeFocused()
    await search.fill('alpha')
    const save = panel.getByRole('button', { name: 'Bookmark History alpha', exact: true })
    await save.focus()
    await save.press('Enter')
    const saved = panel.getByRole('button', { name: 'Already bookmarked: History alpha', exact: true })
    await expect(saved).toBeFocused()
    await saved.press('Enter')
    await saved.press('Space')
    await expect(panel).toBeVisible()
    const bookmarks = await appWindow.evaluate(() => (window as unknown as { hronautBookmarks: HronautBookmarksApi }).hronautBookmarks.list())
    expect(bookmarks).toHaveLength(2)
    expect(bookmarks).toContainEqual(original)
    expect(bookmarks).toContainEqual(expect.objectContaining({ url: `${origin}/alpha`, title: 'History alpha' }))
    expect(JSON.parse(await readFile(join(profileDirectory, 'bookmarks.json'), 'utf8')).bookmarks).toEqual(bookmarks)
    expect(await pageUrls()).toEqual(beforeUrls)
    expect(await appWindow.evaluate(() => (window as unknown as { hronautHistory: HronautHistoryApi }).hronautHistory.list())).toEqual(beforeHistory)
    expect(requests.filter(url => url === '/alpha')).toHaveLength(alphaRequests)
    await panel.getByRole('button', { name: 'Close browsing history' }).click()
    await appWindow.getByRole('button', { name: 'Browsing history', exact: true }).click()
    await expect(saved).toHaveAttribute('aria-disabled', 'true')
    await search.fill('not present')
    await expect(panel).toContainText('No matching visits')
    await search.fill('')
    await testInfo.attach('history-bookmarks', { body: await panel.screenshot(), contentType: 'image/png' })
  } finally {
    await closeFixtureServer(server)
  }
})
