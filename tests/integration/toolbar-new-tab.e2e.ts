import { createServer } from 'node:http'
import { closeFixtureServer } from './fixtures.js'
import { expect, test } from './capability-fixtures.js'

type TabState = { id: string; url: string; active: boolean; canGoBack: boolean; canGoForward: boolean; mcpGroupId?: string }

test('a middle-click or Ctrl+click on Back, Forward or Reload opens that page in a new tab beside the tab, as in Chrome', async ({ capabilities, appWindow }) => {
  const { tabId } = capabilities
  const reloads: Array<string | undefined> = []
  const server = createServer((request, response) => {
    if (request.url === '/two') reloads.push(request.headers['cache-control'])
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(`<!doctype html><title>Page ${request.url}</title><p>${request.url}</p>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const origin = `http://127.0.0.1:${address.port}`
  try {
    const tabs = async (): Promise<TabState[]> => (await appWindow.evaluate(`window.hronaut.getState()`) as { tabs: TabState[] }).tabs
    const path = (url: string): string => url.startsWith(origin) ? new URL(url).pathname : url
    const source = async (): Promise<TabState> => (await tabs()).find(tab => tab.id === tabId)!
    // The tabs beside the source, in the order the strip shows them.
    const besideSource = async (): Promise<Array<{ path: string; active: boolean; canGoBack: boolean; canGoForward: boolean }>> => {
      const all = await tabs()
      const index = all.findIndex(tab => tab.id === tabId)
      return all.slice(index + 1).filter(tab => tab.url.startsWith(origin))
        .map(tab => ({ path: path(tab.url), active: tab.active, canGoBack: tab.canGoBack, canGoForward: tab.canGoForward }))
    }
    for (const to of ['/one', '/two', '/three']) {
      await appWindow.evaluate(`window.hronaut.navigate({ url: ${JSON.stringify(origin + to)}, tabId: ${JSON.stringify(tabId)} })`)
      await expect.poll(async () => path((await source()).url)).toBe(to)
    }
    const back = appWindow.getByRole('button', { name: 'Back', exact: true })
    const forward = appWindow.getByRole('button', { name: 'Forward', exact: true })
    const reload = appWindow.getByRole('button', { name: 'Reload', exact: true })
    await expect(back).toBeEnabled()

    // A middle-click on Back opens the page before in a new tab behind, right after the tab and with its history.
    await back.click({ button: 'middle' })
    await expect.poll(besideSource).toEqual([{ path: '/two', active: false, canGoBack: true, canGoForward: true }])
    const sourceAfter = await source()
    expect(path(sourceAfter.url)).toBe('/three')
    expect(sourceAfter.active).toBe(true)
    const opened = (await tabs()).find(tab => tab.id !== tabId && path(tab.url) === '/two')!
    expect(opened.mcpGroupId).toBe(sourceAfter.mcpGroupId)

    // A plain click still goes back in the tab; Ctrl+click on Forward then opens the page after in a new tab behind.
    await back.click()
    await expect.poll(async () => path((await source()).url)).toBe('/two')
    await expect(forward).toBeEnabled()
    await forward.click({ modifiers: ['ControlOrMeta'] })
    await expect.poll(async () => (await besideSource()).map(tab => tab.path)).toEqual(['/two', '/three'])
    expect(path((await source()).url)).toBe('/two')

    // A middle-click on Reload opens the tab's own page in a new tab; Shift+click reloads it without the cache.
    await reload.click({ button: 'middle' })
    await expect.poll(async () => (await besideSource()).map(tab => tab.path)).toEqual(['/two', '/three', '/two'])
    const before = reloads.length
    await reload.click({ modifiers: ['Shift'] })
    // The new tab's own load of the page may still come in meanwhile.
    await expect.poll(() => reloads.slice(before)).toContain('no-cache')
    expect((await source()).active).toBe(true)
  } finally {
    await closeFixtureServer(server)
  }
})
