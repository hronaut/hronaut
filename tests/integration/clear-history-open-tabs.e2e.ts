import { createServer } from 'node:http'
import { closeFixtureServer, expect, test } from './fixtures.js'

interface HistoryWindow {
  hronaut: {
    newTab(options: { url: string; active: boolean }): Promise<unknown>
    navigate(options: { tabId?: string; url: string }): Promise<unknown>
    getState(): Promise<{ tabs: Array<{ id: string; url: string; loading: boolean; canGoBack: boolean; canGoForward: boolean }> }>
  }
  hronautHistory: {
    list(): Promise<Array<{ id: string; url: string }>>
    remove(id: string): Promise<unknown>
    clear(): Promise<unknown>
  }
}

test('removing a page from the history or clearing it takes it out of open tabs\' Back list, as Chrome', async ({ appWindow }) => {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' }).end(`<!doctype html><title>Page ${request.url?.slice(1)}</title>`)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const [first, second, third] = ['first', 'second', 'third'].map((name) => `http://127.0.0.1:${address.port}/${name}`) as [string, string, string]
  const tab = () => appWindow.evaluate(async (urls) => (await (window as unknown as HistoryWindow).hronaut.getState()).tabs
    .find((candidate) => urls.includes(candidate.url)), [first, second, third])
  const showing = async (url: string) => { const shown = await tab(); return shown?.url === url && !shown.loading }
  const navigate = async (url: string) => {
    const { id } = (await tab())!
    await appWindow.evaluate(({ id, url }) => (window as unknown as HistoryWindow).hronaut.navigate({ tabId: id, url }), { id, url })
    await expect.poll(() => showing(url)).toBe(true)
  }
  const recorded = (url: string) => appWindow.evaluate(async (url) => (await (window as unknown as HistoryWindow).hronautHistory.list())
    .find((entry) => entry.url === url)?.id, url)
  try {
    await appWindow.evaluate((url) => (window as unknown as HistoryWindow).hronaut.newTab({ url, active: true }), first)
    await expect.poll(() => showing(first)).toBe(true)
    await navigate(second)
    await expect.poll(async () => (await tab())?.canGoBack).toBe(true)
    await expect.poll(() => recorded(first)).toBeTruthy()

    // Back still led to the page the person had just removed from the history.
    const removed = (await recorded(first))!
    await appWindow.evaluate((id) => (window as unknown as HistoryWindow).hronautHistory.remove(id), removed)
    await expect.poll(async () => (await tab())?.canGoBack).toBe(false)

    await navigate(third)
    await expect.poll(async () => (await tab())?.canGoBack).toBe(true)
    await appWindow.evaluate(() => (window as unknown as HistoryWindow).hronautHistory.clear())
    await expect.poll(async () => (await tab())?.canGoBack).toBe(false)
    expect(await showing(third)).toBe(true)
  } finally {
    await closeFixtureServer(server)
  }
})
