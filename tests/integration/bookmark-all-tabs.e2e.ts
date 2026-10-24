import { createServer } from 'node:http'
import type { HronautApi, HronautBookmarksApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

test('bookmarks a workspace\'s tabs in a new collection from a page\'s Ctrl+Shift+D and the command palette, as Chrome\'s Bookmark all tabs', async ({ appWindow, electronApp }) => {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(`<!doctype html><title>Page ${request.url!.slice(1)}</title><h1>Synthetic bookmark-all-tabs fixture</h1>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const state = () => appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState())
  try {
    const ids = await appWindow.evaluate(async (origin) => {
      const api = window as unknown as { hronaut: HronautApi; hronautBookmarks: HronautBookmarksApi }
      // A tab in no workspace, opened while Home is in view, and a page already bookmarked in no collection.
      const loose = (await api.hronaut.newTab({ url: `${origin}/loose`, active: true })).activeTabId!
      await api.hronautBookmarks.add(`${origin}/c`, 'Page c')
      const created = await api.hronaut.createWorkspace({ name: 'Client A', storage: 'scratch' })
      const workspace = created.mcpTabGroups.find(group => group.name === 'Client A')!.id
      const starting = created.tabs.filter(tab => tab.mcpGroupId === workspace).map(tab => tab.id)
      for (const path of ['a', 'b', 'c']) await api.hronaut.newTab({ url: `${origin}/${path}`, mcpGroupId: workspace, active: true })
      for (const id of starting) await api.hronaut.closeTab(id)
      return { loose, workspace }
    }, origin)
    await expect.poll(async () => (await state()).tabs.filter(tab => tab.url.startsWith(origin)).map(tab => [tab.url.slice(origin.length), tab.mcpGroupId ?? null, tab.loading]))
      .toEqual([['/loose', null, false], ['/a', ids.workspace, false], ['/b', ids.workspace, false], ['/c', ids.workspace, false]])

    // Ctrl+Shift+D in Client A's page in view: Hronaut's window takes the keyboard and asks for the name.
    await electronApp.evaluate(({ webContents }, url) => {
      const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)
      if (!page) throw new Error('Page web contents was not found')
      page.focus()
      page.sendInputEvent({ type: 'keyDown', keyCode: 'D', modifiers: ['control', 'shift'] })
      page.sendInputEvent({ type: 'keyUp', keyCode: 'D', modifiers: ['control', 'shift'] })
    }, `${origin}/c`)
    const panel = appWindow.getByRole('dialog', { name: 'Bookmarks' })
    const question = panel.getByRole('group', { name: /^Bookmark all tabs/u })
    const name = question.getByRole('textbox', { name: 'Collection name' })
    await expect(name).toBeFocused()
    await expect(name).toHaveValue('Client A')
    await expect.poll(() => electronApp.evaluate(({ webContents }) => webContents.getFocusedWebContents()?.getURL())).toBe(appWindow.url())
    // The name is selected, so typing replaces it.
    await appWindow.keyboard.type('Client A tabs')
    await appWindow.keyboard.press('Enter')
    await expect(panel.getByRole('status')).toHaveText('Added 3 pages to Client A tabs.')
    await expect(question).toHaveCount(0)
    await expect(panel.getByRole('combobox', { name: 'Filter bookmarks by collection' })).toHaveText(/Client A tabs/u)
    // The new collection is shown: its pages in the tabs' order, the one bookmarked before last, and no other tab.
    await expect(panel.locator('.bookmark-item .bookmark-copy strong')).toHaveText(['Page a', 'Page b', 'Page c'])

    // The command palette, with the tab in no workspace in view: its one page goes in Open tabs.
    await appWindow.evaluate((id) => (window as unknown as { hronaut: HronautApi }).hronaut.selectTab(id), ids.loose)
    await expect.poll(async () => (await state()).activeTabId).toBe(ids.loose)
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.focus())
    await appWindow.keyboard.press('Control+Shift+P')
    const commandPalette = appWindow.getByRole('dialog', { name: 'Commands' })
    await commandPalette.getByLabel('Search commands, tabs and pages').fill('Bookmark all tabs')
    await expect(commandPalette.getByRole('option', { selected: true })).toContainText('Bookmark all tabs')
    await appWindow.keyboard.press('Enter')
    await expect(commandPalette).toHaveCount(0)
    await expect(name).toBeFocused()
    await expect(name).toHaveValue('Open tabs')
    await appWindow.keyboard.press('Enter')
    await expect(panel.getByRole('status')).toHaveText('Added 1 page to Open tabs.')
    await expect(panel.locator('.bookmark-item .bookmark-copy strong')).toHaveText(['Page loose'])
  } finally {
    await closeFixtureServer(server)
  }
})
