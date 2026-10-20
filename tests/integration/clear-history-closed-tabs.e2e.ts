import { createServer } from 'node:http'
import { closeFixtureServer, expect, test } from './fixtures.js'

interface ClosedTabsWindow {
  hronaut: {
    newTab(options: { url: string; active: boolean }): Promise<{ tabs: Array<{ id: string; url: string }> }>
    closeTab(tabId: string): Promise<unknown>
    getState(): Promise<{ tabs: Array<{ id: string; url: string; loading: boolean }>; closedTabs: Array<{ url: string }> }>
  }
  hronautHistory: {
    list(): Promise<Array<{ id: string; url: string }>>
    remove(id: string): Promise<unknown>
    clear(): Promise<unknown>
  }
}

test('clearing the history forgets the recently closed tabs it names', async ({ appWindow }) => {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
      .end(`<!doctype html><title>Closed ${request.url?.slice(1, 6)}</title><main>Closed tab fixture</main>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const alpha = `http://127.0.0.1:${address.port}/alpha#token=private`
  const beta = `http://127.0.0.1:${address.port}/beta`
  try {
    for (const url of [alpha, beta]) {
      await appWindow.evaluate(async (url) => {
        const api = (window as unknown as ClosedTabsWindow).hronaut
        await api.newTab({ url, active: true })
      }, url)
    }
    await expect.poll(() => appWindow.evaluate(async () => (await (window as unknown as ClosedTabsWindow).hronautHistory.list()).length)).toBe(2)
    await appWindow.evaluate(async (urls) => {
      const api = (window as unknown as ClosedTabsWindow).hronaut
      for (const tab of (await api.getState()).tabs) {
        if (urls.includes(tab.url)) await api.closeTab(tab.id)
      }
    }, [alpha, beta])
    const closedUrls = () => appWindow.evaluate(async () => (await (window as unknown as ClosedTabsWindow).hronaut.getState()).closedTabs.map(tab => tab.url))
    await expect.poll(closedUrls).toEqual([beta, alpha])

    // Removing a page from the history forgets the closed tab that showed it, fragment and all.
    await appWindow.evaluate(async () => {
      const history = (window as unknown as ClosedTabsWindow).hronautHistory
      const entry = (await history.list()).find(candidate => candidate.url.endsWith('/alpha'))
      if (!entry) throw new Error('Missing alpha history entry')
      await history.remove(entry.id)
    })
    await expect.poll(closedUrls).toEqual([beta])

    // Clear all left every closed tab listed in Recently closed and reopened by Ctrl/Cmd+Shift+T.
    await appWindow.evaluate(() => (window as unknown as ClosedTabsWindow).hronautHistory.clear())
    await expect.poll(closedUrls).toEqual([])
  } finally {
    await closeFixtureServer(server)
  }
})
