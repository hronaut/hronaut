import { createServer } from 'node:http'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { closeFixtureServer } from './fixtures.js'
import { expect, test, text } from './capability-fixtures.js'

type Arrow = 'Left' | 'Right'

test('Alt+Left, Alt+Right and the mouse\'s side buttons go back and forward, as in Chrome', async ({ capabilities, appWindow, electronApp }) => {
  const { client, tabId } = capabilities
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    // Every page notes the keys it gets; /keeps handles Alt with an arrow itself, as an editor or a slide deck can.
    const keeps = request.url === '/keeps'
    response.end(`<!doctype html><title>${request.url}</title><script>window.keys = []; addEventListener('keydown', (event) => {
      window.keys.push(event.key)
      if (${keeps} && event.altKey && event.key.startsWith('Arrow')) event.preventDefault()
    })</script>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const origin = `http://127.0.0.1:${address.port}`
  try {
    const path = async () => {
      const state = await appWindow.evaluate(`window.hronaut.getState()`) as { tabs: Array<{ id: string, url: string }> }
      const url = state.tabs.find(tab => tab.id === tabId)!.url
      return url.startsWith(origin) ? new URL(url).pathname : url
    }
    const visit = async (to: string) => {
      await appWindow.evaluate(`window.hronaut.navigate({ url: ${JSON.stringify(origin + to)}, tabId: ${JSON.stringify(tabId)} })`)
      await expect.poll(path).toBe(to)
    }
    const keys = (script = 'window.keys.slice()') => electronApp.evaluate(({ webContents }, { origin, script }) => {
      const contents = webContents.getAllWebContents().find(candidate => candidate.getURL().startsWith(origin))
      if (!contents) throw new Error('Page web contents was not found')
      return contents.executeJavaScript(script) as Promise<string[]>
    }, { origin, script })
    // The person's key, sent to the page or to Hronaut's own window as the keyboard sends it.
    const press = (where: 'page' | 'shell', arrow: Arrow) => electronApp.evaluate(({ webContents }, { origin, shellUrl, where, arrow }) => {
      const contents = webContents.getAllWebContents()
        .find(candidate => where === 'page' ? candidate.getURL().startsWith(origin) : candidate.getURL() === shellUrl)
      if (!contents) throw new Error(`No ${where} web contents`)
      if (where === 'page') contents.focus()
      contents.sendInputEvent({ type: 'keyDown', keyCode: arrow, modifiers: ['alt'] })
      contents.sendInputEvent({ type: 'keyUp', keyCode: arrow, modifiers: ['alt'] })
    }, { origin, shellUrl: appWindow.url(), where, arrow })
    const appCommand = (command: string) => electronApp.evaluate(({ BrowserWindow }, { shellUrl, command }) => {
      const window = BrowserWindow.getAllWindows().find(candidate => candidate.webContents.getURL() === shellUrl)
      if (!window) throw new Error('Main window was not found')
      window.emit('app-command', { preventDefault: () => undefined }, command)
    }, { shellUrl: appWindow.url(), command })

    await visit('/one')
    await visit('/two')
    await visit('/three')

    // From the website in focus.
    await press('page', 'Left')
    await expect.poll(path).toBe('/two')
    await press('page', 'Right')
    await expect.poll(path).toBe('/three')

    // A key an agent sends stays with the page, as in Chrome.
    await keys('window.keys = []')
    const pressed = await client.callTool({ name: 'browser_press', arguments: { tabId, key: 'Alt+ArrowLeft' } }) as CallToolResult
    expect(pressed.isError, text(pressed)).not.toBe(true)
    await expect.poll(() => keys()).toContain('ArrowLeft')
    await appWindow.waitForTimeout(500)
    expect(await path()).toBe('/three')

    // From the address bar.
    await appWindow.getByRole('combobox', { name: 'Address', exact: true }).focus()
    await press('shell', 'Left')
    await expect.poll(path).toBe('/two')
    await press('shell', 'Right')
    await expect.poll(path).toBe('/three')

    // A website that handles the key itself keeps it.
    await visit('/keeps')
    await press('page', 'Left')
    await expect.poll(() => keys()).toContain('ArrowLeft')
    await appWindow.waitForTimeout(500)
    expect(await path()).toBe('/keeps')

    // The mouse's side buttons, wherever the pointer is.
    await appCommand('browser-backward')
    await expect.poll(path).toBe('/three')
    await appCommand('browser-forward')
    await expect.poll(path).toBe('/keeps')

    // And View → Back and Forward.
    const clickViewItem = (label: string) => electronApp.evaluate(({ BrowserWindow, Menu }, label) => {
      const item = Menu.getApplicationMenu()?.items.find(candidate => candidate.label === 'View')
        ?.submenu?.items.find(candidate => candidate.label === label)
      if (!item?.click) throw new Error(`Missing View menu item: ${label}`)
      item.click(item, BrowserWindow.getAllWindows()[0], {} as Electron.KeyboardEvent)
    }, label)
    await clickViewItem('Back')
    await expect.poll(path).toBe('/three')
    await clickViewItem('Forward')
    await expect.poll(path).toBe('/keeps')
  } finally {
    await closeFixtureServer(server)
  }
})
