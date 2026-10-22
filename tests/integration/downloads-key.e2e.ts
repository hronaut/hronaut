import { createServer } from 'node:http'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { closeFixtureServer } from './fixtures.js'
import { expect, test, text } from './capability-fixtures.js'

test('Ctrl+J and View → Downloads open and close the downloads panel, as in Chrome', async ({ capabilities, appWindow, electronApp }) => {
  const { client, tabId } = capabilities
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    // Every page notes the keys it gets; /keeps handles Ctrl+J itself, as a web editor shows its own panel with it.
    const keeps = request.url === '/keeps'
    response.end(`<!doctype html><title>Downloads key fixture</title><script>window.keys = []; addEventListener('keydown', (event) => {
      window.keys.push(event.key)
      if (${keeps} && event.ctrlKey && event.key === 'j') event.preventDefault()
    })</script>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const origin = `http://127.0.0.1:${address.port}`
  try {
    const panel = appWindow.getByRole('dialog', { name: 'Downloads' })
    const visit = async (to: string) => {
      await appWindow.evaluate(`window.hronaut.navigate({ url: ${JSON.stringify(origin + to)}, tabId: ${JSON.stringify(tabId)} })`)
      await expect.poll(async () => {
        const state = await appWindow.evaluate(`window.hronaut.getState()`) as { tabs: Array<{ id: string, url: string }> }
        return state.tabs.find(tab => tab.id === tabId)?.url
      }).toBe(origin + to)
    }
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
      contents.sendInputEvent({ type: 'keyDown', keyCode: 'J', modifiers: ['control'] })
      contents.sendInputEvent({ type: 'keyUp', keyCode: 'J', modifiers: ['control'] })
    }, { origin, shellUrl: appWindow.url(), where })

    await visit('/page')
    // From the website in focus, and again to close it.
    await press('page')
    await expect(panel).toBeVisible()
    await press('page')
    await expect(panel).toBeHidden()

    // From Hronaut's own window, as from the address bar.
    await appWindow.getByRole('combobox', { name: 'Address', exact: true }).focus()
    await press('shell')
    await expect(panel).toBeVisible()
    await press('shell')
    await expect(panel).toBeHidden()

    // And View → Downloads.
    const chooseDownloads = () => electronApp.evaluate(({ BrowserWindow, Menu }) => {
      const item = Menu.getApplicationMenu()?.items.find(candidate => candidate.label === 'View')
        ?.submenu?.items.find(candidate => candidate.label === 'Downloads')
      if (!item?.click) throw new Error('Missing View → Downloads')
      item.click(item, BrowserWindow.getAllWindows()[0], {} as Electron.KeyboardEvent)
    })
    await chooseDownloads()
    await expect(panel).toBeVisible()
    await chooseDownloads()
    await expect(panel).toBeHidden()

    // A key an agent sends stays with the page: the menu then opens the panel rather than closing it.
    await keys('window.keys = []')
    const pressed = await client.callTool({ name: 'browser_press', arguments: { tabId, key: 'Control+j' } }) as CallToolResult
    expect(pressed.isError, text(pressed)).not.toBe(true)
    await expect.poll(() => keys()).toContain('j')
    await chooseDownloads()
    await expect(panel).toBeVisible()
    await chooseDownloads()
    await expect(panel).toBeHidden()
    // A website that handles the key itself keeps it.
    await visit('/keeps')
    await keys('window.keys = []')
    await press('page')
    await expect.poll(() => keys()).toContain('j')
    await chooseDownloads()
    await expect(panel).toBeVisible()
    await chooseDownloads()
    await expect(panel).toBeHidden()
    // Nor does it open behind a Hronaut dialog.
    await appWindow.keyboard.press('Control+Shift+P')
    const palette = appWindow.getByRole('dialog', { name: 'Commands' })
    await expect(palette).toBeVisible()
    await press('shell')
    // Closing the palette would close a panel opened behind it, so look while it is open.
    await appWindow.waitForTimeout(500)
    await expect(panel).toHaveCount(0)
    await appWindow.keyboard.press('Escape')
    await expect(palette).toBeHidden()
  } finally {
    await closeFixtureServer(server)
  }
})
