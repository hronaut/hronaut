import { createServer } from 'node:http'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { closeFixtureServer } from './fixtures.js'
import { expect, test, text } from './capability-fixtures.js'

// F3, Shift+F3, Ctrl+G and Ctrl+Shift+G did nothing, where Chrome goes to the next or previous match of Find, from the
// page as from the Find field, and opens Find with its last text when it is closed.

test('F3 and Ctrl+G go to the next match of Find and Shift the previous one, as in Chrome, and a website keeps them', async ({ capabilities, appWindow, electronApp }) => {
  test.skip(process.platform === 'darwin', 'Cmd+G is the Edit menu\'s key on macOS, which the unit tests cover, and Chrome has no F3 there')
  const { client, tabId } = capabilities
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    // Every page notes the keys it gets; /editor runs F3 and Ctrl+G itself, as a web editor does to go to a line.
    const editor = request.url === '/editor'
    response.end(`<!doctype html><title>${request.url}</title><p>needle one</p><p>needle two</p><p>needle three</p>
<script>window.keys = []; addEventListener('keydown', (event) => {
  window.keys.push(event.key)
  if (${editor} && (event.key === 'F3' || (event.ctrlKey && event.key.toLowerCase() === 'g'))) event.preventDefault()
})</script>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const origin = `http://127.0.0.1:${address.port}`
  try {
    type State = { tabs: Array<{ id: string, url: string, loading: boolean }> }
    const tab = async () => ((await appWindow.evaluate(`window.hronaut.getState()`)) as State).tabs.find(candidate => candidate.id === tabId)!
    const keys = async (script = 'window.keys.slice()') => electronApp.evaluate(({ webContents }, { url, script }) => {
      const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)
      if (!page) throw new Error('Page web contents was not found')
      return page.executeJavaScript(script) as Promise<string[]>
    }, { url: (await tab()).url, script })
    // The person's key on the tab's page, as the keyboard sends it.
    const press = async (keyCode: string, modifiers: Array<'shift' | 'control'> = []) => electronApp.evaluate(({ webContents }, { url, keyCode, modifiers }) => {
      const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)
      if (!page) throw new Error('Page web contents was not found')
      page.focus()
      page.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
      page.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
    }, { url: (await tab()).url, keyCode, modifiers })
    const visit = async (to: string) => {
      await appWindow.evaluate(`window.hronaut.navigate({ url: ${JSON.stringify(origin + to)}, tabId: ${JSON.stringify(tabId)} })`)
      await expect.poll(async () => { const current = await tab(); return !current.loading && new URL(current.url).pathname }).toBe(to)
    }
    const focusedPage = () => electronApp.evaluate(({ webContents }) => webContents.getFocusedWebContents()?.getURL())
    const bar = appWindow.getByRole('search', { name: 'Find in page' })
    const search = bar.getByRole('searchbox', { name: 'Find text' })
    const count = bar.locator('.find-count')

    await visit('/page')
    await appWindow.getByRole('button', { name: 'Find in page', exact: true }).click()
    await search.fill('needle')
    await expect(count).toHaveText('1 / 3')

    // From the page, the key goes to the next match and takes the keyboard to the Find field, as in Chrome.
    await press('G', ['control'])
    await expect(count).toHaveText('2 / 3')
    await expect.poll(focusedPage).toBe(appWindow.url())
    await expect(search).toBeFocused()
    // In the Find field.
    await appWindow.keyboard.press('F3')
    await expect(count).toHaveText('3 / 3')
    await appWindow.keyboard.press('Shift+F3')
    await expect(count).toHaveText('2 / 3')
    await appWindow.keyboard.press('Control+Shift+G')
    await expect(count).toHaveText('1 / 3')
    await press('F3', ['shift'])
    await expect(count).toHaveText('3 / 3')

    // With Find closed, the key opens it and searches for its last text again.
    await search.press('Escape')
    await expect(bar).toBeHidden()
    await press('F3')
    await expect(bar).toBeVisible()
    await expect(search).toHaveValue('needle')
    await expect(count).toHaveText('1 / 3')
    await search.press('Escape')
    await expect(bar).toBeHidden()

    // An agent's key stays with the page, as in Chrome.
    await keys('window.keys = []')
    for (const key of ['F3', 'Control+g']) {
      const pressed = await client.callTool({ name: 'browser_press', arguments: { tabId, key } }) as CallToolResult
      expect(pressed.isError, text(pressed)).not.toBe(true)
    }
    await expect.poll(async () => (await keys()).map(key => key.toLowerCase()).filter(key => key !== 'control')).toEqual(['f3', 'g'])
    await appWindow.waitForTimeout(500)
    await expect(bar).toBeHidden()

    // A page that runs F3 and Ctrl+G itself keeps them.
    await visit('/editor')
    await press('F3')
    await press('G', ['control'])
    await expect.poll(async () => (await keys()).map(key => key.toLowerCase())).toEqual(['f3', 'g'])
    await appWindow.waitForTimeout(500)
    await expect(bar).toBeHidden()
    expect(await focusedPage()).toBe(`${origin}/editor`)
  } finally {
    await closeFixtureServer(server)
  }
})
