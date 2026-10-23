import { createServer } from 'node:http'
import type { HronautApi, HronautBookmarksApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

test('a middle-click or Ctrl+click on a bookmark or a visit opens it in a new tab behind and keeps the panel open, as in Chrome', async ({ appWindow }) => {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(`<!doctype html><title>Fixture ${request.url}</title><h1>${request.url}</h1>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const state = () => appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState())
  const opened = async (path: string): Promise<number> => (await state()).tabs.filter(tab => tab.url === `${origin}${path}` && !tab.loading).length
  try {
    await appWindow.evaluate(async origin => {
      const api = window as unknown as { hronaut: HronautApi; hronautBookmarks: HronautBookmarksApi }
      await api.hronaut.newTab({ url: `${origin}/visited`, active: true })
      await api.hronautBookmarks.add(`${origin}/saved`, 'Saved fixture')
    }, origin)
    await expect.poll(() => opened('/visited')).toBe(1)
    await appWindow.evaluate(origin => (window as unknown as { hronaut: HronautApi }).hronaut.newTab({ url: `${origin}/current`, active: true }), origin)
    await expect.poll(() => opened('/current')).toBe(1)
    const before = await state()

    // A middle-click on a bookmark opens it behind, and the panel stays open.
    await appWindow.getByRole('button', { name: 'Bookmarks', exact: true }).click()
    const bookmarks = appWindow.getByRole('dialog', { name: 'Bookmarks' })
    await bookmarks.getByRole('button', { name: `Saved fixture ${origin}/saved`, exact: true }).click({ button: 'middle' })
    await expect.poll(() => opened('/saved')).toBe(1)
    expect((await state()).activeTabId).toBe(before.activeTabId)
    await expect(bookmarks).toBeVisible()

    // Ctrl+click on a visit in History does the same.
    await appWindow.getByRole('button', { name: 'Browsing history', exact: true }).click()
    const history = appWindow.getByRole('dialog', { name: 'Browsing history' })
    await history.getByRole('searchbox').fill('visited')
    await history.getByRole('button', { name: /^Fixture \/visited/ }).click({ modifiers: ['ControlOrMeta'] })
    await expect.poll(() => opened('/visited')).toBe(2)
    expect((await state()).activeTabId).toBe(before.activeTabId)
    await expect(history).toBeVisible()
    expect((await state()).tabs.length).toBe(before.tabs.length + 2)
  } finally {
    await closeFixtureServer(server)
  }
})
