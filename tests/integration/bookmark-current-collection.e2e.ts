import { createServer } from 'node:http'
import type { HronautApi, HronautBookmarksApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

type TestWindow = { hronaut: HronautApi; hronautBookmarks: HronautBookmarksApi }

// Chrome's bookmark manager adds a page to the folder it shows. Hronaut put a page saved while the bookmarks panel
// showed a collection in Unfiled, so the list the panel showed did not have it.
test('saves the current page into the collection the bookmarks panel shows, from Add current and from Ctrl+D', async ({ appWindow, electronApp }) => {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
      .end(`<!doctype html><title>Page ${request.url!.slice(1)}</title><h1>Synthetic bookmark fixture</h1>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const openPage = async (name: string): Promise<void> => {
    await appWindow.evaluate(url => (window as unknown as TestWindow).hronaut.newTab({ url, active: true }), `${origin}/${name}`)
    await expect.poll(() => appWindow.evaluate(() => (window as unknown as TestWindow).hronaut.getState()
      .then(state => state.tabs.find(tab => tab.active)?.title))).toBe(`Page ${name}`)
  }
  try {
    // A bookmark in no collection, so the empty collection says so.
    const collectionId = await appWindow.evaluate(async origin => {
      const api = (window as unknown as TestWindow).hronautBookmarks
      await api.add(`${origin}/loose`, 'Page loose')
      const snapshot = await api.collections!.create('Reading')
      return snapshot.collections.find(collection => collection.name === 'Reading')!.id
    }, origin)
    await openPage('first')
    await appWindow.getByRole('button', { name: 'Bookmarks', exact: true }).click()
    const panel = appWindow.getByRole('dialog', { name: 'Bookmarks' })
    await panel.getByRole('combobox', { name: 'Filter bookmarks by collection' }).selectOption(`c:${collectionId}`)
    await expect(panel).toContainText('No bookmarks in this collection')
    await panel.getByRole('button', { name: 'Add current' }).click()
    await expect(panel.getByRole('button', { name: /^Page first/ })).toBeVisible()
    await expect(panel.getByRole('combobox', { name: 'Collection for Page first' })).toHaveValue(collectionId)
    await expect(panel.getByRole('button', { name: /^Page loose/ })).toHaveCount(0)
    await panel.getByRole('button', { name: 'Close bookmarks' }).click()
    await expect(panel).toBeHidden()

    // Ctrl+D in the next page, with the panel closed, saves it in the collection the panel still shows.
    await openPage('second')
    await electronApp.evaluate(({ webContents }, input: { url: string; modifier: 'meta' | 'control' }) => {
      const page = webContents.getAllWebContents().find(contents => contents.getURL() === input.url)
      if (!page) throw new Error('Page web contents was not found')
      page.focus()
      page.sendInputEvent({ type: 'keyDown', keyCode: 'D', modifiers: [input.modifier] })
      page.sendInputEvent({ type: 'keyUp', keyCode: 'D', modifiers: [input.modifier] })
    }, { url: `${origin}/second`, modifier: process.platform === 'darwin' ? 'meta' as const : 'control' as const })
    await expect(panel.getByRole('button', { name: /^Page second/ })).toBeVisible()
    await expect(panel.getByRole('button', { name: /^Page first/ })).toBeVisible()
    await expect(panel.getByRole('combobox', { name: 'Collection for Page second' })).toHaveValue(collectionId)
    const saved = await appWindow.evaluate(async () => {
      const api = (window as unknown as TestWindow).hronautBookmarks
      return { bookmarks: await api.list(), organization: await api.collections!.list() }
    })
    expect(saved.bookmarks.map(bookmark => bookmark.title).sort()).toEqual(['Page first', 'Page loose', 'Page second'])
    const ids = (title: string): string[] => saved.bookmarks.filter(bookmark => bookmark.title === title).map(bookmark => bookmark.id)
    expect(saved.organization.collections).toEqual([{ id: collectionId, name: 'Reading', bookmarkIds: expect.any(Array) }])
    expect([...saved.organization.collections[0]!.bookmarkIds].sort()).toEqual([...ids('Page first'), ...ids('Page second')].sort())
  } finally {
    await closeFixtureServer(server)
  }
})
