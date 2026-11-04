import { createServer } from 'node:http'
import { closeFixtureServer } from './fixtures.js'
import { expect, test } from './capability-fixtures.js'

// Switching tabs closed Find and ended the page's search, so coming back to a tab meant searching it again. As in Chrome,
// Find belongs to its tab: another tab, or Home, hides it, and the tab shown again brings it back where it was.

test('Find stays with its tab, comes back with its text and match, and ends when the hidden tab goes to another page', async ({
  capabilities, appWindow, electronApp
}) => {
  const { tabId } = capabilities
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(request.url === '/second'
      ? '<!doctype html><title>Second</title><p>other one</p><p>other two</p>'
      : `<!doctype html><title>${request.url === '/next' ? 'Next' : 'First'}</title><p>needle one</p><p>needle two</p><p>needle three</p>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const origin = `http://127.0.0.1:${address.port}`
  try {
    type State = { activeTabId: string, tabs: Array<{ id: string, url: string, loading: boolean }> }
    const state = async () => (await appWindow.evaluate(`window.hronaut.getState()`)) as State
    const loaded = async (id: string, url: string) => {
      await expect.poll(async () => { const tab = (await state()).tabs.find(candidate => candidate.id === id); return !tab?.loading && tab?.url }).toBe(url)
    }
    await appWindow.evaluate(`window.hronaut.navigate({ url: ${JSON.stringify(`${origin}/first`)}, tabId: ${JSON.stringify(tabId)} })`)
    await loaded(tabId, `${origin}/first`)

    // The requests to end a page's search that reached main.
    await electronApp.evaluate(({ ipcMain }) => {
      type Handler = (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown
      const original = (ipcMain as typeof ipcMain & { _invokeHandlers: Map<string, Handler> })._invokeHandlers.get('browser:stop-find-in-page')!
      const stops: unknown[] = []
      Reflect.set(globalThis, 'qaFindStops', stops)
      ipcMain.removeHandler('browser:stop-find-in-page')
      ipcMain.handle('browser:stop-find-in-page', async (event, ...args: unknown[]) => {
        stops.push([args[0], args[1] ?? null])
        return original(event, ...args)
      })
    })
    const stops = () => electronApp.evaluate(() => Reflect.get(globalThis, 'qaFindStops') as unknown[])
    const bar = appWindow.getByRole('search', { name: 'Find in page' })
    const search = bar.getByRole('searchbox', { name: 'Find text' })
    const count = bar.locator('.find-count')
    const openFind = () => appWindow.getByRole('button', { name: 'Find in page', exact: true }).click()
    const select = (id: string) => appWindow.evaluate(`window.hronaut.selectTab(${JSON.stringify(id)})`)

    await openFind()
    await search.fill('needle')
    await expect(count).toHaveText('1 / 3')
    await search.press('Enter')
    await expect(count).toHaveText('2 / 3')

    const secondId = await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(`${origin}/second`)}, active: true }).then(state => state.activeTabId)`) as string
    await loaded(secondId, `${origin}/second`)
    await expect(bar).toBeHidden()
    await openFind()
    await search.fill('other')
    await expect(count).toHaveText('1 / 2')

    await select(tabId)
    await expect(search).toHaveValue('needle')
    await expect(count).toHaveText('2 / 3')
    // The page kept its search: Enter goes on to the third match rather than starting again.
    await search.press('Enter')
    await expect(count).toHaveText('3 / 3')
    await select(secondId)
    await expect(search).toHaveValue('other')
    await expect(count).toHaveText('1 / 2')
    expect(await stops()).toEqual([])

    // Home hides it too.
    await select(tabId)
    await expect(count).toHaveText('3 / 3')
    await appWindow.getByRole('button', { name: 'Open Hronaut Home', exact: true }).click()
    await expect(bar).toBeHidden()
    await select(tabId)
    await expect(search).toHaveValue('needle')
    await expect(count).toHaveText('3 / 3')
    expect(await stops()).toEqual([])

    // The hidden tab goes to another page, which ends its Find.
    await select(secondId)
    await expect(search).toHaveValue('other')
    await appWindow.evaluate(`window.hronaut.navigate({ url: ${JSON.stringify(`${origin}/next`)}, tabId: ${JSON.stringify(tabId)} })`)
    await loaded(tabId, `${origin}/next`)
    await expect.poll(stops).toEqual([[tabId, { clearSelection: true }]])
    await select(tabId)
    await expect.poll(async () => (await state()).activeTabId).toBe(tabId)
    await expect(bar).toBeHidden()
  } finally {
    await closeFixtureServer(server)
  }
})
