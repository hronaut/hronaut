import { createServer } from 'node:http'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { closeFixtureServer } from './fixtures.js'
import { expect, test, text } from './capability-fixtures.js'

type State = { activeTabId?: string; tabs: Array<{ id: string; url: string; mcpGroupId?: string }> }

test('Ctrl+U and View → View Page Source open the page\'s source in a new tab beside it, as in Chrome', async ({ capabilities, appWindow, electronApp }) => {
  const { client, tabId } = capabilities
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    // Every page notes the keys it gets; /keeps handles Ctrl+U itself, as a web editor underlines with it.
    const keeps = request.url === '/keeps'
    response.end(`<!doctype html><title>Source fixture</title><p>hronaut-source-marker</p><script>window.keys = []; addEventListener('keydown', (event) => {
      window.keys.push(event.key)
      if (${keeps} && event.ctrlKey && event.key === 'u') event.preventDefault()
    })</script>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const origin = `http://127.0.0.1:${address.port}`
  try {
    const state = async () => await appWindow.evaluate(`window.hronaut.getState()`) as State
    const visit = async (to: string) => {
      await appWindow.evaluate(`window.hronaut.navigate({ url: ${JSON.stringify(origin + to)}, tabId: ${JSON.stringify(tabId)} })`)
      await expect.poll(async () => (await state()).tabs.find(tab => tab.id === tabId)?.url).toBe(origin + to)
    }
    const sourceTabs = async () => (await state()).tabs.filter(tab => tab.url.startsWith('view-source:'))
    const keys = (script = 'window.keys.slice()') => electronApp.evaluate(({ webContents }, { origin, script }) => {
      const contents = webContents.getAllWebContents().find(candidate => candidate.getURL().startsWith(origin))
      if (!contents) throw new Error('Page web contents was not found')
      return contents.executeJavaScript(script) as Promise<string[]>
    }, { origin, script })
    // The person's key, sent to the page or to Hronaut's own window as the keyboard sends it.
    const press = (where: 'page' | 'shell') => electronApp.evaluate(({ webContents }, { origin, shellUrl, where }) => {
      const contents = webContents.getAllWebContents()
        .find(candidate => where === 'page' ? candidate.getURL().startsWith(origin) : candidate.getURL() === shellUrl)
      if (!contents) throw new Error(`No ${where} web contents`)
      if (where === 'page') contents.focus()
      contents.sendInputEvent({ type: 'keyDown', keyCode: 'U', modifiers: ['control'] })
      contents.sendInputEvent({ type: 'keyUp', keyCode: 'U', modifiers: ['control'] })
    }, { origin, shellUrl: appWindow.url(), where })
    const closeSources = async () => {
      for (const tab of await sourceTabs()) await appWindow.evaluate(`window.hronaut.closeTab(${JSON.stringify(tab.id)})`)
      await appWindow.evaluate(`window.hronaut.selectTab(${JSON.stringify(tabId)})`)
      await expect.poll(sourceTabs).toEqual([])
    }

    await visit('/page')
    const workspace = (await state()).tabs.find(tab => tab.id === tabId)!.mcpGroupId
    await press('page')
    await expect.poll(async () => {
      const current = await state()
      const source = current.tabs.find(tab => tab.url === `view-source:${origin}/page`)
      return source && {
        shown: current.activeTabId === source.id,
        workspace: source.mcpGroupId,
        besidePage: current.tabs.indexOf(source) === current.tabs.findIndex(tab => tab.id === tabId) + 1
      }
    }).toEqual({ shown: true, workspace, besidePage: true })
    // It shows the page's own markup.
    await expect.poll(() => electronApp.evaluate(({ webContents }, address) => {
      const contents = webContents.getAllWebContents().find(candidate => candidate.getURL() === address)
      // The page's own executeJavaScript never settles on a source; its main frame's does.
      return contents?.mainFrame.executeJavaScript('document.body.innerText') as Promise<string> | undefined
    }, `view-source:${origin}/page`)).toContain('<p>hronaut-source-marker</p>')
    await closeSources()

    // From Hronaut's own window, as from the address bar, and from View → View Page Source.
    await appWindow.getByRole('combobox', { name: 'Address', exact: true }).focus()
    await press('shell')
    await expect.poll(async () => (await sourceTabs()).map(tab => tab.url)).toEqual([`view-source:${origin}/page`])
    await closeSources()
    await electronApp.evaluate(({ BrowserWindow, Menu }) => {
      const item = Menu.getApplicationMenu()?.items.find(candidate => candidate.label === 'View')
        ?.submenu?.items.find(candidate => candidate.label === 'View Page Source')
      if (!item?.click) throw new Error('Missing View → View Page Source')
      item.click(item, BrowserWindow.getAllWindows()[0], {} as Electron.KeyboardEvent)
    })
    await expect.poll(async () => (await sourceTabs()).map(tab => tab.url)).toEqual([`view-source:${origin}/page`])
    await closeSources()
    // And View Page Source in the page's context menu.
    await electronApp.evaluate(async ({ Menu, webContents }, origin) => {
      const popup = Menu.prototype.popup
      let menu: Electron.Menu | undefined
      Menu.prototype.popup = function (): void { menu = this }
      try {
        const page = webContents.getAllWebContents().find(candidate => candidate.getURL().startsWith(origin))
        if (!page) throw new Error('Page web contents was not found')
        page.focus()
        page.sendInputEvent({ type: 'mouseDown', button: 'right', clickCount: 1, x: 20, y: 20 })
        page.sendInputEvent({ type: 'mouseUp', button: 'right', clickCount: 1, x: 20, y: 20 })
        for (let waited = 0; !menu && waited < 5_000; waited += 50) await new Promise(resolve => setTimeout(resolve, 50))
      } finally {
        Menu.prototype.popup = popup
      }
      const item = menu?.getMenuItemById('view-page-source')
      if (!item?.click) throw new Error('Missing View Page Source in the page\'s context menu')
      ;(item.click as unknown as () => void)()
    }, origin)
    await expect.poll(async () => (await sourceTabs()).map(tab => tab.url)).toEqual([`view-source:${origin}/page`])
    await closeSources()

    // A key an agent sends stays with the page.
    await keys('window.keys = []')
    const pressed = await client.callTool({ name: 'browser_press', arguments: { tabId, key: 'Control+u' } }) as CallToolResult
    expect(pressed.isError, text(pressed)).not.toBe(true)
    await expect.poll(() => keys()).toContain('u')
    await appWindow.waitForTimeout(500)
    expect(await sourceTabs()).toEqual([])
    // A website that handles the key itself keeps it.
    await visit('/keeps')
    await press('page')
    await expect.poll(() => keys()).toContain('u')
    await appWindow.waitForTimeout(500)
    expect(await sourceTabs()).toEqual([])
    // Nor does it open behind a Hronaut dialog.
    await appWindow.keyboard.press('Control+Shift+P')
    const palette = appWindow.getByRole('dialog', { name: 'Commands' })
    await expect(palette).toBeVisible()
    await press('shell')
    await appWindow.waitForTimeout(500)
    expect(await sourceTabs()).toEqual([])
    await appWindow.keyboard.press('Escape')
    await expect(palette).toBeHidden()
  } finally {
    await closeFixtureServer(server)
  }
})
