import { createServer } from 'node:http'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { closeFixtureServer } from './fixtures.js'
import { expect, test, text } from './capability-fixtures.js'

// The selected tabs of a Developer Tools window, found through the shadow roots of its front end, and the class of the
// element that has its keyboard.
const DEVTOOLS_VIEW = `(() => {
  const selected = []
  const walk = (root) => {
    for (const element of root.querySelectorAll('*')) {
      if (element.getAttribute('role') === 'tab' && element.getAttribute('aria-selected') === 'true') selected.push(element.id)
      if (element.shadowRoot) walk(element.shadowRoot)
    }
  }
  walk(document)
  let focused = document.activeElement
  while (focused && focused.shadowRoot && focused.shadowRoot.activeElement) focused = focused.shadowRoot.activeElement
  return { selected, focused: focused ? String(focused.className) : null }
})()`

test('Ctrl+Shift+J, or Cmd+Option+J on macOS, opens Developer Tools on the Console with the keyboard in its prompt, and turns open ones to it, as in Chrome', async ({ capabilities, appWindow, electronApp }) => {
  const { client, tabId } = capabilities
  const mac = process.platform === 'darwin'
  const modifiers: Array<'control' | 'shift' | 'meta' | 'alt'> = mac ? ['meta', 'alt'] : ['control', 'shift']
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(`<!doctype html><title>Console keys</title><script>window.keys = []; addEventListener('keydown', (event) => window.keys.push(event.key))</script>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const url = `http://127.0.0.1:${address.port}/page`
  const devToolsOpen = () => appWindow.evaluate(`window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.id === ${JSON.stringify(tabId)})?.devToolsOpen)`) as Promise<boolean | undefined>
  try {
    await appWindow.evaluate(`window.hronaut.navigate({ url: ${JSON.stringify(url)}, tabId: ${JSON.stringify(tabId)} })`)
    await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.id === ${JSON.stringify(tabId)})?.url)`)).toBe(url)
    const keys = () => electronApp.evaluate(({ webContents }, url) => {
      const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)
      if (!page) throw new Error('Page web contents was not found')
      return page.executeJavaScript('window.keys.slice()') as Promise<string[]>
    }, url)
    const inDevTools = (script: string) => electronApp.evaluate(({ webContents }, { url, script }) => {
      const devTools = webContents.getAllWebContents().find(contents => contents.getURL() === url)?.devToolsWebContents
      return devTools && !devTools.isDestroyed() ? devTools.executeJavaScript(script) as Promise<unknown> : null
    }, { url, script })
    const devToolsView = () => inDevTools(DEVTOOLS_VIEW) as Promise<{ selected: string[], focused: string | null } | null>
    // The person's key, as the keyboard sends it, on the page or in Hronaut's own window.
    const press = (target: 'page' | 'window') => electronApp.evaluate(({ BrowserWindow, webContents }, { url, shellUrl, target, modifiers }) => {
      const contents = target === 'page'
        ? webContents.getAllWebContents().find(candidate => candidate.getURL() === url)
        : BrowserWindow.getAllWindows().find(window => window.webContents.getURL() === shellUrl)?.webContents
      if (!contents) throw new Error(`The ${target} web contents was not found`)
      contents.focus()
      contents.sendInputEvent({ type: 'keyDown', keyCode: 'J', modifiers })
      contents.sendInputEvent({ type: 'keyUp', keyCode: 'J', modifiers })
    }, { url, shellUrl: appWindow.url(), target, modifiers })

    // An agent's Ctrl+Shift+J goes to its page and opens nothing.
    const pressed = await client.callTool({ name: 'browser_press', arguments: { tabId, key: mac ? 'Meta+Alt+J' : 'Control+Shift+J' } }) as CallToolResult
    expect(pressed.isError, text(pressed)).not.toBe(true)
    await expect.poll(async () => (await keys()).map(key => key.toLowerCase())).toEqual(['j'])
    await appWindow.waitForTimeout(500)
    expect(await devToolsOpen()).toBe(false)

    // The person's opens Developer Tools on the Console, with the keyboard in its prompt, and the page gets no key.
    await press('page')
    await expect.poll(devToolsOpen).toBe(true)
    await expect.poll(async () => (await devToolsView())?.selected).toContain('tab-console')
    await expect.poll(async () => (await devToolsView())?.focused).toContain('cm-content')
    expect((await keys()).length).toBe(1)

    // With Developer Tools open on another panel, the key from Hronaut's window turns them back to the Console.
    await inDevTools(`DevToolsAPI.showPanel('sources')`)
    await expect.poll(async () => (await devToolsView())?.selected).toContain('tab-sources')
    await press('window')
    await expect.poll(async () => (await devToolsView())?.selected).toContain('tab-console')
    await expect.poll(async () => (await devToolsView())?.focused).toContain('cm-content')
    expect(await devToolsOpen()).toBe(true)
    expect((await keys()).length).toBe(1)

    expect(await appWindow.evaluate(`window.hronaut.toggleDevTools(${JSON.stringify(tabId)})`)).toBe(false)
    await expect.poll(devToolsOpen).toBe(false)
  } finally {
    if (await devToolsOpen().catch(() => false)) await appWindow.evaluate(`window.hronaut.toggleDevTools(${JSON.stringify(tabId)})`).catch(() => undefined)
    await closeFixtureServer(server)
  }
})
