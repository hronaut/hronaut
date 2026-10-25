import { createServer } from 'node:http'
import type { HronautApi, HronautBookmarksApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

// Every page notes the keys it gets; /keeps handles Ctrl+Shift+D itself, as a web editor shows its Run and Debug view.
function fixtureServer() {
  return createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(`<!doctype html><title>Page ${request.url!.slice(1)}</title><h1>Synthetic bookmark-all-tabs fixture</h1><script>window.keys = []; addEventListener('keydown', (event) => {
      window.keys.push(event.key)
      if (${request.url === '/keeps'} && event.ctrlKey && event.shiftKey && event.code === 'KeyD') event.preventDefault()
    })</script>`)
  })
}

test('bookmarks a workspace\'s tabs in a new collection from Ctrl+Shift+D, a tab\'s menu and the command palette, as Chrome\'s Bookmark all tabs', async ({ appWindow, electronApp }) => {
  const server = fixtureServer()
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const state = () => appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState())
  try {
    const ids = await appWindow.evaluate(async (origin) => {
      const api = window as unknown as { hronaut: HronautApi; hronautBookmarks: HronautBookmarksApi }
      // A tab of the workspace Hronaut starts with, opened while Home is in view, and a page already bookmarked in no
      // collection.
      const loose = (await api.hronaut.newTab({ url: `${origin}/loose`, active: true })).activeTabId!
      await api.hronautBookmarks.add(`${origin}/c`, 'Page c')
      const created = await api.hronaut.createWorkspace({ name: 'Client A', storage: 'scratch' })
      const workspace = created.mcpTabGroups.find(group => group.name === 'Client A')!.id
      const starting = created.tabs.filter(tab => tab.mcpGroupId === workspace).map(tab => tab.id)
      for (const path of ['a', 'b', 'c']) await api.hronaut.newTab({ url: `${origin}/${path}`, mcpGroupId: workspace, active: true })
      for (const id of starting) await api.hronaut.closeTab(id)
      return { loose, workspace }
    }, origin)
    const started = (await state()).tabs.find(tab => tab.id === ids.loose)!.mcpGroupId
    expect(started).not.toBe(ids.workspace)
    await expect.poll(async () => (await state()).tabs.filter(tab => tab.url.startsWith(origin)).map(tab => [tab.url.slice(origin.length), tab.mcpGroupId, tab.loading]))
      .toEqual([['/loose', started, false], ['/a', ids.workspace, false], ['/b', ids.workspace, false], ['/c', ids.workspace, false]])
    const startedName = (await state()).mcpTabGroups.find(group => group.id === started)?.name
    expect(startedName).toBeTruthy()

    // The person's key, sent to a page as the keyboard sends it, and the keys that page got.
    const press = (url: string, keyCode = 'D', modifiers: Electron.InputEvent['modifiers'] = ['control', 'shift']) => electronApp.evaluate(({ webContents }, { url, keyCode, modifiers }) => {
      const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)
      if (!page) throw new Error('Page web contents was not found')
      page.focus()
      page.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
      page.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
    }, { url, keyCode, modifiers })
    const keys = (url: string) => electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents()
      .find(contents => contents.getURL() === url)!.executeJavaScript('window.keys.slice()') as Promise<string[]>, url)

    // Ctrl+Shift+D in Client A's page in view, which leaves it alone: Hronaut's window takes the keyboard and asks for
    // the name.
    await press(`${origin}/c`)
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
    // The page had the key first.
    expect(await keys(`${origin}/c`)).toEqual([expect.stringMatching(/^d$/iu)])

    // A tab's menu asks for its workspace's tabs, by the workspace's name.
    await electronApp.evaluate(({ Menu }) => {
      Menu.prototype.popup = function (): void {
        ;(globalThis as typeof globalThis & { __hronautTabMenu?: Electron.Menu }).__hronautTabMenu = this
      }
    })
    await appWindow.locator('.tab', { hasText: 'Page b' }).first().click({ button: 'right' })
    await electronApp.evaluate(() => {
      const item = (globalThis as typeof globalThis & { __hronautTabMenu?: Electron.Menu }).__hronautTabMenu?.getMenuItemById('bookmark-all-tabs')
      if (!item?.click || !item.enabled) throw new Error('Enabled bookmark-all-tabs tab menu item was not found')
      ;(item.click as unknown as () => void)()
    })
    await expect(name).toBeFocused()
    await expect(name).toHaveValue('Client A')
    await name.press('Escape')
    await expect(question).toHaveCount(0)
    await expect(panel).toBeVisible()

    // The command palette, with the first workspace's tab in view: its one web page goes in a collection of its name.
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
    await expect(name).toHaveValue(startedName!)
    await appWindow.keyboard.press('Enter')
    await expect(panel.getByRole('status')).toHaveText(`Added 1 page to ${startedName!}.`)
    await expect(panel.locator('.bookmark-item .bookmark-copy strong')).toHaveText(['Page loose'])

    // A website that handles the key itself keeps it, as in Chrome: nothing is asked.
    await appWindow.evaluate((url) => (window as unknown as { hronaut: HronautApi }).hronaut.newTab({ url, active: true }), `${origin}/keeps`)
    await expect.poll(async () => (await state()).tabs.find(tab => tab.active)?.loading === false && (await state()).tabs.find(tab => tab.active)?.url).toBe(`${origin}/keeps`)
    await press(`${origin}/keeps`)
    // A key after it reaches the page once Hronaut is done with the first.
    await press(`${origin}/keeps`, 'X', [])
    await expect.poll(() => keys(`${origin}/keeps`)).toEqual([expect.stringMatching(/^d$/iu), 'x'])
    await state()
    await expect(question).toHaveCount(0)
    await expect(panel.getByRole('status')).toHaveText(`Added 1 page to ${startedName!}.`)
  } finally {
    await closeFixtureServer(server)
  }
})

test('asks for Bookmark all tabs\' name in the Bookmarks panel\'s own window, opening it when it is closed', async ({ appWindow, electronApp }) => {
  const server = fixtureServer()
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const bookmarksPage = () => electronApp.windows().find(page => page.url().includes('hronautPanel=bookmarks'))
  const windowCount = () => electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)
  const pressInPage = () => electronApp.evaluate(({ webContents }, url) => {
    const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)
    if (!page) throw new Error('Page web contents was not found')
    page.focus()
    page.sendInputEvent({ type: 'keyDown', keyCode: 'D', modifiers: ['control', 'shift'] })
    page.sendInputEvent({ type: 'keyUp', keyCode: 'D', modifiers: ['control', 'shift'] })
  }, `${origin}/b`)
  try {
    await appWindow.evaluate(async (origin) => {
      const api = (window as unknown as { hronaut: HronautApi }).hronaut
      const created = await api.createWorkspace({ name: 'Client B', storage: 'scratch' })
      const workspace = created.mcpTabGroups.find(group => group.name === 'Client B')!.id
      const starting = created.tabs.filter(tab => tab.mcpGroupId === workspace).map(tab => tab.id)
      for (const path of ['a', 'b']) await api.newTab({ url: `${origin}/${path}`, mcpGroupId: workspace, active: true })
      for (const id of starting) await api.closeTab(id)
    }, origin)
    await expect.poll(async () => (await appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState()))
      .tabs.filter(tab => tab.url.startsWith(origin) && !tab.loading).length).toBe(2)
    await appWindow.getByRole('button', { name: 'Bookmarks', exact: true }).click()
    await appWindow.getByRole('dialog', { name: 'Bookmarks' }).getByRole('combobox', { name: 'Dock Bookmarks' }).selectOption('window')
    await expect.poll(() => Boolean(bookmarksPage())).toBe(true)
    let detached = bookmarksPage()!
    await detached.waitForLoadState('domcontentloaded')
    await expect(detached.getByRole('dialog', { name: 'Bookmarks' })).toBeVisible()
    await expect.poll(windowCount).toBe(2)

    // From the page in the main window: the panel's window asks, and the main window's hidden panel does not.
    await pressInPage()
    let name = detached.getByRole('group', { name: /^Bookmark all tabs/u }).getByRole('textbox', { name: 'Collection name' })
    await expect(name).toBeFocused()
    await expect(name).toHaveValue('Client B')
    await expect(appWindow.locator('.bookmark-collection-editor')).toHaveCount(0)
    await detached.keyboard.type('Client B tabs')
    await detached.keyboard.press('Enter')
    const detachedPanel = detached.getByRole('dialog', { name: 'Bookmarks' })
    await expect(detachedPanel.getByRole('status')).toHaveText('Added 2 pages to Client B tabs.')
    await expect(detachedPanel.locator('.bookmark-item .bookmark-copy strong')).toHaveText(['Page a', 'Page b'])

    // With its window closed, the panel's window opens again to ask.
    await electronApp.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) if (window.webContents.getURL().includes('hronautPanel=')) window.close()
    })
    await expect.poll(windowCount).toBe(1)
    await expect.poll(() => bookmarksPage()?.isClosed() ?? true).toBe(true)
    await pressInPage()
    await expect.poll(() => Boolean(bookmarksPage() && !bookmarksPage()!.isClosed())).toBe(true)
    detached = bookmarksPage()!
    await detached.waitForLoadState('domcontentloaded')
    name = detached.getByRole('group', { name: /^Bookmark all tabs/u }).getByRole('textbox', { name: 'Collection name' })
    await expect(name).toBeFocused()
    await expect(name).toHaveValue('Client B')
    await expect(appWindow.locator('.bookmark-collection-editor')).toHaveCount(0)
  } finally {
    await electronApp.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) if (window.webContents.getURL().includes('hronautPanel=')) window.close()
    }).catch(() => undefined)
    await closeFixtureServer(server)
  }
})
