import { createServer } from 'node:http'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { closeFixtureServer } from './fixtures.js'
import { expect, test, text } from './capability-fixtures.js'

// Chrome reserves none of Ctrl/Cmd+F, L, R and the zoom keys from websites, so a web editor finds with Ctrl+F, selects a
// line with Ctrl+L and opens its recent folders with Ctrl+R, and a design tool zooms its canvas with Ctrl/Cmd with = and
// -. Hronaut found, went to the address bar, reloaded or zoomed before the page saw the key.
test('a website that handles Ctrl/Cmd+F, L, R or a zoom key keeps it, as in Chrome, and elsewhere a held key acts once', async ({
  capabilities,
  appWindow,
  electronApp
}) => {
  const { client, tabId } = capabilities
  const mac = process.platform === 'darwin'
  const loads = new Map<string, number>()
  const server = createServer((request, response) => {
    loads.set(request.url!, (loads.get(request.url!) ?? 0) + 1)
    response.writeHead(200, { 'content-type': 'text/html' })
    // Every page notes the keys it gets; /keeps handles them itself, as a web editor does.
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
    type State = { tabs: Array<{ id: string, url: string, loading: boolean, zoomPercent?: number }> }
    const tab = async () => ((await appWindow.evaluate(`window.hronaut.getState()`)) as State).tabs.find(candidate => candidate.id === tabId)!
    const visit = async (to: string) => {
      await appWindow.evaluate(`window.hronaut.navigate({ url: ${JSON.stringify(origin + to)}, tabId: ${JSON.stringify(tabId)} })`)
      await expect.poll(async () => { const current = await tab(); return !current.loading && current.url }).toBe(origin + to)
    }
    const keys = (script = 'window.keys.slice()') => electronApp.evaluate(({ webContents }, { origin, script }) => {
      const contents = webContents.getAllWebContents().find(candidate => candidate.getURL().startsWith(origin))
      if (!contents) throw new Error('Page web contents was not found')
      return contents.executeJavaScript(script) as Promise<string[]>
    }, { origin, script })
    // The person's key, sent to the page in focus as the keyboard sends it, held down for its repeats.
    const press = (keyCode: string, repeats = 0) => electronApp.evaluate(({ webContents }, { origin, keyCode, modifier, repeats }) => {
      const contents = webContents.getAllWebContents().find(candidate => candidate.getURL().startsWith(origin))
      if (!contents) throw new Error('Page web contents was not found')
      contents.focus()
      contents.sendInputEvent({ type: 'keyDown', keyCode, modifiers: [modifier] })
      for (let repeat = 0; repeat < repeats; repeat += 1) contents.sendInputEvent({ type: 'keyDown', keyCode, modifiers: [modifier, 'isautorepeat'] })
      contents.sendInputEvent({ type: 'keyUp', keyCode, modifiers: [modifier] })
    }, { origin, keyCode, modifier: mac ? 'meta' as const : 'control' as const, repeats })
    const focusedUrl = () => electronApp.evaluate(({ webContents }) => webContents.getFocusedWebContents()?.getURL())
    const zoom = async () => (await tab()).zoomPercent
    const findBar = appWindow.getByRole('search', { name: 'Find in page' })
    const addressField = appWindow.getByRole('combobox', { name: 'Address', exact: true })
    const pageKeys = ['f', 'l', 'r', '=', '-', '0']

    // A website that handles the keys itself keeps them: no Find, no address bar, no reload and no zoom.
    await visit('/keeps')
    for (const key of ['F', 'L', 'R', '=', '-', '0']) await press(key)
    await expect.poll(() => keys()).toEqual(pageKeys)
    await appWindow.waitForTimeout(500)
    await expect(findBar).toHaveCount(0)
    expect(await focusedUrl()).toBe(`${origin}/keeps`)
    expect(loads.get('/keeps')).toBe(1)
    expect(await zoom()).toBe(100)

    // A key an agent sends stays with the page, also where the website leaves it alone.
    await visit('/plain')
    for (const key of pageKeys) {
      const pressed = await client.callTool({ name: 'browser_press', arguments: { tabId, key: `${mac ? 'Meta' : 'Control'}+${key}` } }) as CallToolResult
      expect(pressed.isError, text(pressed)).not.toBe(true)
    }
    await expect.poll(() => keys()).toEqual(pageKeys)
    await appWindow.waitForTimeout(500)
    await expect(findBar).toHaveCount(0)
    expect(loads.get('/plain')).toBe(1)
    expect(await zoom()).toBe(100)

    // The person's keys there act as before. Held down, each acts once, as in Chrome: the repeats reach the page alone.
    await keys('window.keys = []')
    await press('=', 3)
    await expect.poll(zoom).toBe(110)
    await press('-', 3)
    await expect.poll(zoom).toBe(100)
    await press('=')
    await expect.poll(zoom).toBe(110)
    await press('0', 3)
    await expect.poll(zoom).toBe(100)
    await expect.poll(() => keys()).toEqual([...Array(4).fill('='), ...Array(4).fill('-'), '=', ...Array(4).fill('0')])
    await appWindow.waitForTimeout(500)
    expect(await zoom()).toBe(100)
    await press('R', 3)
    await expect.poll(() => loads.get('/plain')).toBe(2)
    await expect.poll(async () => { const current = await tab(); return !current.loading && current.url }).toBe(`${origin}/plain`)
    await press('F', 3)
    await expect(findBar).toBeVisible()
    await press('L', 3)
    await expect(addressField).toBeFocused()
    await appWindow.waitForTimeout(500)
    expect(loads.get('/plain')).toBe(2)
  } finally {
    await closeFixtureServer(server)
  }
})
