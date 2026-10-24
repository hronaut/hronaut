import { createServer } from 'node:http'
import type { HronautApi, HronautBookmarksApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

test('opens every listed bookmark in a background tab, asking first from 15, as Chrome\'s Open all', async ({ appWindow }) => {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(`<!doctype html><title>Fixture ${request.url}</title><h1>Synthetic open-all fixture</h1>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const state = () => appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState())
  const saved = Array.from({ length: 17 }, (_, index) => `${origin}/page-${index}`)
  try {
    await appWindow.evaluate(async ({ origin, saved }) => {
      const api = window as unknown as { hronaut: HronautApi; hronautBookmarks: HronautBookmarksApi }
      await api.hronaut.newTab({ url: `${origin}/current`, active: true })
      for (const [index, url] of saved.entries()) await api.hronautBookmarks.add(url, `Saved page ${index}`)
    }, { origin, saved })
    await expect.poll(async () => (await state()).tabs.find(tab => tab.url === `${origin}/current`)?.loading).toBe(false)
    const before = await state()
    await appWindow.getByRole('button', { name: 'Bookmarks', exact: true }).click()
    const panel = appWindow.getByRole('dialog', { name: 'Bookmarks' })

    // A few at once open without a question: page-1 and page-10 to page-16.
    await panel.getByRole('searchbox').fill('page-1')
    await panel.getByRole('button', { name: 'Open all (8)' }).click()
    await expect(panel.getByRole('status')).toHaveText('Opened 8 tabs.')
    expect((await state()).tabs).toHaveLength(before.tabs.length + 8)

    await panel.getByRole('searchbox').fill('')
    const openAll = panel.getByRole('button', { name: 'Open all (17)' })
    await openAll.click()
    const question = panel.getByRole('group', { name: 'Open 17 tabs?' })
    await expect(question).toBeVisible()
    await expect(question.getByRole('button', { name: 'Cancel' })).toBeFocused()
    expect((await state()).tabs).toHaveLength(before.tabs.length + 8)
    await question.getByRole('button', { name: 'Open 17 tabs' }).click()
    await expect(panel.getByRole('status')).toHaveText('Opened 17 tabs.')
    await expect(question).toHaveCount(0)
    // Each opened once more, the eight searched for twice, behind the page in view; the panel stays open.
    const tabsOf = (tabs: { url: string }[], url: string) => tabs.filter(tab => tab.url === url).length
    await expect.poll(async () => { const tabs = (await state()).tabs; return saved.map(url => tabsOf(tabs, url)) })
      .toEqual(saved.map(url => /\/page-1\d?$/u.test(url) ? 2 : 1))
    const after = await state()
    expect(after.tabs).toHaveLength(before.tabs.length + 25)
    expect(after.activeTabId).toBe(before.activeTabId)
    await expect(panel).toBeVisible()
  } finally {
    await closeFixtureServer(server)
  }
})
