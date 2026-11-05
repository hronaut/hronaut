import { createServer } from 'node:http'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { HronautBookmarksApi } from '../../src/shared/types.js'
import { closeFixtureServer } from './fixtures.js'
import { expect, test, text } from './capability-fixtures.js'

type TestWindow = { hronautBookmarks: HronautBookmarksApi }

// Chrome reserves neither Ctrl/Cmd+D nor Ctrl+H (Cmd+Y on macOS) from websites, so a web editor adds the next match with
// Ctrl+D and opens Replace with Ctrl+H. Hronaut bookmarked the page or opened history before the page saw either key.
test('a website that handles Ctrl/Cmd+D or the history key keeps it, as in Chrome, and elsewhere they bookmark and open history', async ({
  capabilities,
  appWindow,
  electronApp
}) => {
  const { client, tabId } = capabilities
  const mac = process.platform === 'darwin'
  const historyKey = mac ? 'Y' : 'H'
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    // Every page notes the keys it gets; /keeps handles both keys itself, as a web editor does.
    const keeps = request.url === '/keeps'
    response.end(`<!doctype html><title>Page ${request.url!.slice(1)}</title><script>window.keys = []; addEventListener('keydown', (event) => {
      window.keys.push(event.key)
      if (${keeps} && (event.ctrlKey || event.metaKey)) event.preventDefault()
    })</script>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const origin = `http://127.0.0.1:${address.port}`
  try {
    const historyPanel = appWindow.getByRole('dialog', { name: 'Browsing history' })
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
    // The person's key, sent to the page in focus as the keyboard sends it.
    const press = (keyCode: string) => electronApp.evaluate(({ webContents }, { origin, keyCode, modifier }) => {
      const contents = webContents.getAllWebContents().find(candidate => candidate.getURL().startsWith(origin))
      if (!contents) throw new Error('Page web contents was not found')
      contents.focus()
      contents.sendInputEvent({ type: 'keyDown', keyCode, modifiers: [modifier] })
      contents.sendInputEvent({ type: 'keyUp', keyCode, modifiers: [modifier] })
    }, { origin, keyCode, modifier: mac ? 'meta' as const : 'control' as const })
    const bookmarks = () => appWindow.evaluate(async () => (await (window as unknown as TestWindow).hronautBookmarks.list())
      .map(bookmark => bookmark.title))

    // A website that handles the keys itself keeps them.
    await visit('/keeps')
    await press('D')
    await press(historyKey)
    await expect.poll(() => keys()).toEqual(['d', historyKey.toLowerCase()])
    await appWindow.waitForTimeout(500)
    expect(await bookmarks()).toEqual([])
    await expect(historyPanel).toHaveCount(0)

    // A key an agent sends stays with the page, also where the website leaves it alone.
    await visit('/plain')
    for (const key of ['d', historyKey.toLowerCase()]) {
      const pressed = await client.callTool({
        name: 'browser_press',
        arguments: { tabId, key: `${mac ? 'Meta' : 'Control'}+${key}` }
      }) as CallToolResult
      expect(pressed.isError, text(pressed)).not.toBe(true)
    }
    await expect.poll(() => keys()).toEqual(['d', historyKey.toLowerCase()])
    await appWindow.waitForTimeout(500)
    expect(await bookmarks()).toEqual([])
    await expect(historyPanel).toHaveCount(0)

    // The person's keys there bookmark the page and open history, as before.
    await press('D')
    await expect.poll(bookmarks).toEqual(['Page plain'])
    await press(historyKey)
    await expect(historyPanel).toBeVisible()
  } finally {
    await closeFixtureServer(server)
  }
})
