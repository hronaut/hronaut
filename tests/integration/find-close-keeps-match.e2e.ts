import { createServer } from 'node:http'
import { closeFixtureServer } from './fixtures.js'
import { expect, test } from './capability-fixtures.js'

// Closing Find cleared the page's selection, where Chrome leaves the match selected and gives the link it is in the
// page's focus, so the person can copy the match or follow the link with Enter, and finds that match again when Find
// opens again. Emptying the Find field clears the selection.

test('closing Find leaves the match selected and its link focused, reopening finds it, and emptying the field clears it, as in Chrome', async ({
  capabilities, appWindow, electronApp
}) => {
  const { tabId } = capabilities
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>Needles</title><p>needle one</p><p><a href="/next">needle two</a></p><p>needle three</p>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const url = `http://127.0.0.1:${address.port}/page`
  try {
    type State = { tabs: Array<{ id: string, url: string, loading: boolean }> }
    const tab = async () => ((await appWindow.evaluate(`window.hronaut.getState()`)) as State).tabs.find(candidate => candidate.id === tabId)!
    await appWindow.evaluate(`window.hronaut.navigate({ url: ${JSON.stringify(url)}, tabId: ${JSON.stringify(tabId)} })`)
    await expect.poll(async () => { const current = await tab(); return !current.loading && current.url }).toBe(url)
    // The page's selected text and the tag of its focused element.
    const pageState = () => electronApp.evaluate(({ webContents }, url) => {
      const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)
      if (!page) throw new Error('Page web contents was not found')
      return page.executeJavaScript('[String(getSelection()), document.activeElement?.tagName]') as Promise<[string, string]>
    }, url)
    const bar = appWindow.getByRole('search', { name: 'Find in page' })
    const search = bar.getByRole('searchbox', { name: 'Find text' })
    const count = bar.locator('.find-count')
    const openFind = () => appWindow.getByRole('button', { name: 'Find in page', exact: true }).click()

    // The options of each request to end the search that reached main.
    await electronApp.evaluate(({ ipcMain }) => {
      type Handler = (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown
      const original = (ipcMain as typeof ipcMain & { _invokeHandlers: Map<string, Handler> })._invokeHandlers.get('browser:stop-find-in-page')!
      const stops: unknown[] = []
      Reflect.set(globalThis, 'qaFindStops', stops)
      ipcMain.removeHandler('browser:stop-find-in-page')
      ipcMain.handle('browser:stop-find-in-page', async (event, ...args: unknown[]) => {
        const result = await original(event, ...args)
        stops.push(args[1] ?? null)
        return result
      })
    })
    const lastStop = () => electronApp.evaluate(() => (Reflect.get(globalThis, 'qaFindStops') as unknown[]).at(-1))

    await openFind()
    await search.fill('needle')
    await expect(count).toHaveText('1 / 3')
    await search.press('Escape')
    await expect(bar).toBeHidden()
    await expect.poll(pageState).toEqual(['needle', 'BODY'])

    // Find opens again on the match it closed on, and Enter goes on to the next one, in a link, which Close leaves focused.
    await openFind()
    await expect(search).toHaveValue('needle')
    await expect(count).toHaveText('1 / 3')
    await search.press('Enter')
    await expect(count).toHaveText('2 / 3')
    await bar.getByRole('button', { name: 'Close find in page' }).click()
    await expect(bar).toBeHidden()
    await expect.poll(pageState).toEqual(['needle', 'A'])

    await openFind()
    await expect(count).toHaveText('2 / 3')
    // The search took the page's selection, and ending it while keeping the selection would select the match again.
    await search.fill('')
    await expect(count).toHaveText('0 / 0')
    await expect.poll(lastStop).toEqual({ clearSelection: true })
    // Read after main ended the search, which Chromium does in order before this script.
    expect((await pageState())[0]).toBe('')
  } finally {
    await closeFixtureServer(server)
  }
})
