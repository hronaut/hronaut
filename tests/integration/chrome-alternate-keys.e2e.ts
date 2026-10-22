import { createServer } from 'node:http'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { closeFixtureServer } from './fixtures.js'
import { expect, test, text } from './capability-fixtures.js'

test('F5, Shift+F5, Ctrl+F5, Alt+D and Ctrl+Page Up and Down work as in Chrome, and a website keeps F5 and Alt+D', async ({ capabilities, appWindow, electronApp }) => {
  test.skip(process.platform === 'darwin', 'Chrome has none of these keys on macOS but the tab keys, which the unit tests cover')
  const { client, tabId } = capabilities
  const loads: Array<{ path: string, cacheControl: string | undefined }> = []
  const server = createServer((request, response) => {
    loads.push({ path: request.url ?? '', cacheControl: request.headers['cache-control'] })
    response.writeHead(200, { 'content-type': 'text/html' })
    // Every page notes the keys it gets; /editor runs F5 and Alt+D itself, as a web editor or terminal does.
    const editor = request.url === '/editor'
    response.end(`<!doctype html><title>${request.url}</title><script>window.keys = []; addEventListener('keydown', (event) => {
      window.keys.push(event.key)
      if (${editor} && (event.key === 'F5' || (event.altKey && event.key.toLowerCase() === 'd'))) event.preventDefault()
    })</script>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const origin = `http://127.0.0.1:${address.port}`
  try {
    type State = { activeTabId: string, tabs: Array<{ id: string, url: string, mcpGroupId?: string }> }
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
    await expect(addressBar).not.toBeFocused()
    await press(tabId, 'D', ['alt'])
    await expect(addressBar).toBeFocused()

    // An agent's F5 stays with the page, as in Chrome.
    await keys(tabId, 'window.keys = []')
    const pressed = await client.callTool({ name: 'browser_press', arguments: { tabId, key: 'F5' } }) as CallToolResult
    expect(pressed.isError, text(pressed)).not.toBe(true)
    await expect.poll(() => keys(tabId)).toContain('F5')
    await appWindow.waitForTimeout(500)
    expect(loadsOf('/page')).toHaveLength(4)

    // A page that runs F5 and Alt+D itself keeps them.
    await visit('/editor')
    await press(tabId, 'F5')
    await press(tabId, 'D', ['alt'])
    await expect.poll(async () => (await keys(tabId)).map(key => key.toLowerCase())).toEqual(['f5', 'd'])
    await appWindow.waitForTimeout(500)
    expect(loadsOf('/editor')).toHaveLength(1)
    await expect(addressBar).not.toBeFocused()

    // A locked page cannot have the key, so it reloads as Ctrl+R does.
    await appWindow.evaluate(`window.hronaut.setTabHumanInteractionLocked(${JSON.stringify(tabId)}, true)`)
    await press(tabId, 'F5')
    await expect.poll(() => loadsOf('/editor').length).toBe(2)
    await appWindow.evaluate(`window.hronaut.setTabHumanInteractionLocked(${JSON.stringify(tabId)}, false)`)

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
  } finally {
    await closeFixtureServer(server)
  }
})
