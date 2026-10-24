import { createServer } from 'node:http'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { closeFixtureServer } from './fixtures.js'
import { expect, test, text } from './capability-fixtures.js'

test('F5, Shift+F5, Ctrl+F5, Alt+D, F6, Ctrl+F4 and Ctrl+Page Up and Down, with Shift to move the tab, work as in Chrome, and a website keeps F5, Alt+D, F6 and the move keys', async ({ capabilities, appWindow, electronApp }) => {
  test.skip(process.platform === 'darwin', 'Chrome has none of these keys on macOS but the tab keys, which the unit tests cover')
  const { client, tabId } = capabilities
  const loads: Array<{ path: string, cacheControl: string | undefined }> = []
  const server = createServer((request, response) => {
    loads.push({ path: request.url ?? '', cacheControl: request.headers['cache-control'] })
    response.writeHead(200, { 'content-type': 'text/html' })
    // Every page notes the keys it gets; /editor runs F5, Alt+D, F6, Ctrl+Shift+Page Up and Ctrl+F4 itself, as a web
    // editor or terminal does.
    const editor = request.url?.startsWith('/editor') === true
    response.end(`<!doctype html><title>${request.url}</title><script>window.keys = []; addEventListener('keydown', (event) => {
      window.keys.push(event.key)
      if (${editor} && (event.key === 'F5' || event.key === 'F6' || (event.altKey && event.key.toLowerCase() === 'd') || (event.ctrlKey && event.shiftKey && event.key === 'PageUp') || (event.ctrlKey && event.key === 'F4'))) event.preventDefault()
    })</script>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const origin = `http://127.0.0.1:${address.port}`
  try {
    type State = { activeTabId: string, tabs: Array<{ id: string, url: string, mcpGroupId?: string, zoomPercent: number }> }
    const state = () => appWindow.evaluate(`window.hronaut.getState()`) as Promise<State>
    const path = async (id: string) => new URL((await state()).tabs.find(tab => tab.id === id)!.url).pathname
    const loadsOf = (path: string) => loads.filter(load => load.path === path)
    const pageOf = async (id: string) => (await state()).tabs.find(tab => tab.id === id)!.url
    const keys = async (id: string, script = 'window.keys.slice()') => electronApp.evaluate(({ webContents }, { url, script }) => {
      const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)
      if (!page) throw new Error('Page web contents was not found')
      return page.executeJavaScript(script) as Promise<string[]>
    }, { url: await pageOf(id), script })
    // The person's key on the tab's page, as the keyboard sends it.
    const press = async (id: string, keyCode: string, modifiers: Array<'shift' | 'control' | 'alt'> = []) => electronApp.evaluate(({ webContents }, { url, keyCode, modifiers }) => {
      const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)
      if (!page) throw new Error('Page web contents was not found')
      page.focus()
      page.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
      page.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
    }, { url: await pageOf(id), keyCode, modifiers })
    const visit = async (to: string) => {
      await appWindow.evaluate(`window.hronaut.navigate({ url: ${JSON.stringify(origin + to)}, tabId: ${JSON.stringify(tabId)} })`)
      await expect.poll(() => path(tabId)).toBe(to)
    }
    const addressBar = appWindow.getByRole('combobox', { name: 'Address', exact: true })
    const focusedPage = () => electronApp.evaluate(({ webContents }) => webContents.getFocusedWebContents()?.getURL())
    // The person's key in Hronaut's own window, as the keyboard sends it.
    const pressInWindow = (keyCode: string, modifiers: Array<'shift' | 'control' | 'alt'> = []) => electronApp.evaluate(({ BrowserWindow }, { url, keyCode, modifiers }) => {
      const shell = BrowserWindow.getAllWindows().find((window) => window.webContents.getURL() === url)!.webContents
      shell.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
      shell.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
    }, { url: appWindow.url(), keyCode, modifiers })

    await visit('/page')
    await expect.poll(() => loadsOf('/page').length).toBe(1)
    await press(tabId, 'F5')
    await expect.poll(() => loadsOf('/page').length).toBe(2)
    expect(loadsOf('/page')[1]!.cacheControl).not.toBe('no-cache')
    await press(tabId, 'F5', ['shift'])
    await expect.poll(() => loadsOf('/page').length).toBe(3)
    expect(loadsOf('/page')[2]!.cacheControl).toBe('no-cache')
    await press(tabId, 'F5', ['control'])
    await expect.poll(() => loadsOf('/page').length).toBe(4)
    expect(loadsOf('/page')[3]!.cacheControl).toBe('no-cache')
    await press(tabId, 'D', ['alt'])
    await expect.poll(focusedPage).toBe(appWindow.url())
    await expect(addressBar).toBeFocused()

    // F6 and Shift+F6 go from Hronaut's window back to the page, and from the page to the address bar.
    await pressInWindow('F6')
    await expect.poll(focusedPage).toBe(`${origin}/page`)
    await press(tabId, 'F6', ['shift'])
    await expect.poll(focusedPage).toBe(appWindow.url())
    await expect(addressBar).toBeFocused()
    await pressInWindow('F6', ['shift'])
    await expect.poll(focusedPage).toBe(`${origin}/page`)
    await press(tabId, 'F6')
    await expect.poll(focusedPage).toBe(appWindow.url())
    await expect(addressBar).toBeFocused()
    // Over a Hronaut dialog F6, Alt+D, F5 and the application menu's keys leave the keyboard where it is in the dialog,
    // and the tab where it is: Ctrl+R reloaded the page behind it, Ctrl+Plus and Ctrl+Minus zoomed it, and
    // Ctrl+Shift+P and Ctrl+Shift+/ put the command palette and Keyboard shortcuts in the dialog's place.
    await electronApp.evaluate(({ BrowserWindow }, url) => {
      BrowserWindow.getAllWindows().find((window) => window.webContents.getURL() === url)!.webContents.send('help:open', 'about')
    }, appWindow.url())
    const aboutDialog = appWindow.getByRole('dialog', { name: 'About Hronaut' })
    await expect(aboutDialog).toBeVisible()
    // Not its first control, which a dialog's focus trap would go back to.
    const contribute = aboutDialog.getByRole('button', { name: 'Contribute' })
    await contribute.focus()
    await expect(contribute).toBeFocused()
    const tabsBefore = (await state()).tabs.length
    const zoom = async () => (await state()).tabs.find(tab => tab.id === tabId)!.zoomPercent
    const zoomBefore = await zoom()
    await pressInWindow('F6')
    await pressInWindow('D', ['alt'])
    await pressInWindow('F5')
    await pressInWindow('R', ['control'])
    await pressInWindow('R', ['control', 'shift'])
    await pressInWindow('=', ['control', 'shift'])
    await pressInWindow('-', ['control'])
    await pressInWindow('P', ['control', 'shift'])
    await pressInWindow('/', ['control', 'shift'])
    await appWindow.waitForTimeout(500)
    expect(await focusedPage()).toBe(appWindow.url())
    await expect(contribute).toBeFocused()
    expect((await state()).activeTabId).toBe(tabId)
    expect((await state()).tabs).toHaveLength(tabsBefore)
    expect(await zoom()).toBe(zoomBefore)
    expect(loadsOf('/page')).toHaveLength(4)
    const shortcutsDialog = appWindow.getByRole('dialog', { name: 'Keyboard shortcuts' })
    await expect(shortcutsDialog).toBeHidden()
    await appWindow.keyboard.press('Escape')
    await expect(aboutDialog).toBeHidden()
    // Nor over the command palette.
    await electronApp.evaluate(({ BrowserWindow }, url) => {
      BrowserWindow.getAllWindows().find((window) => window.webContents.getURL() === url)!.webContents.send('browser:shortcut-requested', 'command-palette')
    }, appWindow.url())
    const palette = appWindow.getByRole('dialog', { name: 'Commands' })
    await expect(palette).toBeVisible()
    await pressInWindow('R', ['control'])
    await pressInWindow('=', ['control', 'shift'])
    await pressInWindow('/', ['control', 'shift'])
    await appWindow.waitForTimeout(500)
    await expect(palette).toBeVisible()
    await expect(shortcutsDialog).toBeHidden()
    expect(await zoom()).toBe(zoomBefore)
    expect(loadsOf('/page')).toHaveLength(4)
    await appWindow.keyboard.press('Escape')
    await expect(palette).toBeHidden()
    // With neither open, the same keys act at once, and nothing pressed before comes in late.
    await pressInWindow('R', ['control'])
    await expect.poll(() => loadsOf('/page').length).toBe(5)
    await pressInWindow('=', ['control', 'shift'])
    await expect.poll(zoom).toBeGreaterThan(zoomBefore)
    await pressInWindow('0', ['control'])
    await expect.poll(zoom).toBe(zoomBefore)
    await appWindow.waitForTimeout(500)
    expect(loadsOf('/page')).toHaveLength(5)
    expect(await zoom()).toBe(zoomBefore)

    // Home has no address bar, so F6 there goes to Hronaut's window without leaving Home, and back.
    await appWindow.evaluate(`window.hronaut.openHome()`)
    const home = (await state()).activeTabId
    expect(home).not.toBe(tabId)
    await expect.poll(async () => (await focusedPage())?.startsWith('hronaut://home')).toBe(true)
    const homePage = (await focusedPage())!
    const tabsWithHome = (await state()).tabs.length
    await electronApp.evaluate(({ webContents }) => {
      const focused = webContents.getFocusedWebContents()!
      focused.sendInputEvent({ type: 'keyDown', keyCode: 'F6' })
      focused.sendInputEvent({ type: 'keyUp', keyCode: 'F6' })
    })
    await expect.poll(focusedPage).toBe(appWindow.url())
    await appWindow.waitForTimeout(500)
    expect((await state()).activeTabId).toBe(home)
    expect((await state()).tabs).toHaveLength(tabsWithHome)
    await pressInWindow('F6')
    await expect.poll(focusedPage).toBe(homePage)
    await appWindow.evaluate(`window.hronaut.selectTab(${JSON.stringify(tabId)})`)
    await expect.poll(async () => (await state()).activeTabId).toBe(tabId)

    // An agent's F5 stays with the page, as in Chrome.
    await keys(tabId, 'window.keys = []')
    const pressed = await client.callTool({ name: 'browser_press', arguments: { tabId, key: 'F5' } }) as CallToolResult
    expect(pressed.isError, text(pressed)).not.toBe(true)
    await expect.poll(() => keys(tabId)).toContain('F5')
    await appWindow.waitForTimeout(500)
    expect(loadsOf('/page')).toHaveLength(5)

    // A page that runs F5 and Alt+D itself keeps them.
    await visit('/editor')
    await press(tabId, 'F5')
    await press(tabId, 'D', ['alt'])
    await press(tabId, 'F6')
    await expect.poll(async () => (await keys(tabId)).map(key => key.toLowerCase())).toEqual(['f5', 'd', 'f6'])
    await appWindow.waitForTimeout(500)
    expect(loadsOf('/editor')).toHaveLength(1)
    expect(await focusedPage()).toBe(`${origin}/editor`)

    // Ctrl+Page Up and Ctrl+Page Down, from the page and from Hronaut's own window.
    const workspace = (await state()).tabs.find(tab => tab.id === tabId)!.mcpGroupId
    await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(`${origin}/next`)}, mcpGroupId: ${JSON.stringify(workspace)}, active: true })`)
    const next = (await state()).tabs.find(tab => tab.url === `${origin}/next`)!.id
    await expect.poll(async () => (await state()).activeTabId).toBe(next)
    await expect.poll(() => loadsOf('/next').length).toBe(1)
    await press(next, 'PageUp', ['control'])
    await expect.poll(async () => (await state()).activeTabId).toBe(tabId)
    await press(tabId, 'PageDown', ['control'])
    await expect.poll(async () => (await state()).activeTabId).toBe(next)
    await addressBar.focus()
    await appWindow.keyboard.press('Control+PageUp')
    await expect.poll(async () => (await state()).activeTabId).toBe(tabId)

    // Ctrl+Shift+Page Down and Page Up move the tab in view among its workspace's tabs once the page leaves them alone,
    // as in Chrome, and from Hronaut's own window, and it stays in view with the keyboard where it was.
    const order = async () => (await state()).tabs.filter(tab => tab.mcpGroupId === workspace).map(tab => tab.id)
    // The workspace's own first tab comes before them.
    const before = (await order()).slice(0, -2)
    expect(await order()).toEqual([...before, tabId, next])
    await keys(tabId, 'window.keys = []')
    await press(tabId, 'PageDown', ['control', 'shift'])
    await expect.poll(order).toEqual([...before, next, tabId])
    expect((await state()).activeTabId).toBe(tabId)
    await expect.poll(focusedPage).toBe(`${origin}/editor`)
    expect(await keys(tabId)).toEqual(['PageDown'])
    // At the end it stays.
    await press(tabId, 'PageDown', ['control', 'shift'])
    await appWindow.waitForTimeout(500)
    expect(await order()).toEqual([...before, next, tabId])
    // The page runs Ctrl+Shift+Page Up itself, so it keeps the key and the tab stays.
    await press(tabId, 'PageUp', ['control', 'shift'])
    await expect.poll(() => keys(tabId)).toEqual(['PageDown', 'PageDown', 'PageUp'])
    await appWindow.waitForTimeout(500)
    expect(await order()).toEqual([...before, next, tabId])
    await addressBar.focus()
    await appWindow.keyboard.press('Control+Shift+PageUp')
    await expect.poll(order).toEqual([...before, tabId, next])
    expect((await state()).activeTabId).toBe(tabId)

    // Ctrl+F4 closes the tab in view, as Ctrl+W does, from the page and from Hronaut's own window, and a website that
    // runs the key itself cannot keep it, as in Chrome.
    const openTab = async (path: string) => {
      await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(origin + path)}, mcpGroupId: ${JSON.stringify(workspace)}, active: true })`)
      const id = (await state()).tabs.find(tab => tab.url === origin + path)!.id
      await expect.poll(async () => (await state()).activeTabId).toBe(id)
      await expect.poll(() => loads.some(load => load.path === path)).toBe(true)
      return id
    }
    const isOpen = async (id: string) => (await state()).tabs.some(tab => tab.id === id)
    const closedFromPage = await openTab('/editor?page')
    await press(closedFromPage, 'F4', ['control'])
    await expect.poll(() => isOpen(closedFromPage)).toBe(false)
    const closedFromWindow = await openTab('/editor?window')
    await addressBar.focus()
    await pressInWindow('F4', ['control'])
    await expect.poll(() => isOpen(closedFromWindow)).toBe(false)
    expect(await isOpen(tabId)).toBe(true)
  } finally {
    await closeFixtureServer(server)
  }
})
