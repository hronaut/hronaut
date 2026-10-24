import { createServer } from 'node:http'
import { closeFixtureServer, expect, test } from './fixtures.js'

interface ReopenWindow {
  hronaut: {
    newTab(options: { url: string; active: boolean }): Promise<unknown>
    navigate(options: { tabId?: string; url: string }): Promise<unknown>
    back(tabId?: string): Promise<unknown>
    closeTab(tabId: string): Promise<unknown>
    getState(): Promise<{ tabs: Array<{ id: string; url: string; loading: boolean; canGoBack: boolean }> }>
  }
  hronautHistory: {
    list(): Promise<Array<{ id: string; url: string; visitCount: number }>>
    remove(id: string): Promise<unknown>
  }
}

test('reopens a closed tab with its back history and scroll, as Chrome, without counting another visit', async ({ appWindow, electronApp }) => {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
      .end(`<!doctype html><title>History ${request.url?.slice(1)}</title><main style="height: 5000px">History fixture</main>`)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const [first, second, third] = ['first', 'second', 'third'].map((name) => `http://127.0.0.1:${address.port}/${name}`) as [string, string, string]
  const tab = () => appWindow.evaluate(async (urls) => (await (window as unknown as ReopenWindow).hronaut.getState()).tabs
    .find((candidate) => urls.includes(candidate.url)), [first, second, third])
  const showing = async (url: string) => { const shown = await tab(); return shown?.url === url && !shown.loading }
  const visits = (url: string) => appWindow.evaluate(async (url) => (await (window as unknown as ReopenWindow).hronautHistory.list())
    .find((entry) => entry.url === url)?.visitCount, url)
  const scrolled = (url: string) => electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents()
    .find((contents) => contents.getURL() === url)?.executeJavaScript('window.scrollY') as Promise<number> | undefined, url)
  const navigate = async (url: string) => {
    const { id } = (await tab())!
    await appWindow.evaluate(({ id, url }) => (window as unknown as ReopenWindow).hronaut.navigate({ tabId: id, url }), { id, url })
    await expect.poll(() => showing(url)).toBe(true)
  }
  const back = async () => {
    const { id } = (await tab())!
    await appWindow.evaluate((id) => (window as unknown as ReopenWindow).hronaut.back(id), id)
  }
  const close = async () => {
    const { id } = (await tab())!
    await appWindow.evaluate((id) => (window as unknown as ReopenWindow).hronaut.closeTab(id), id)
    await expect.poll(tab).toBeUndefined()
  }
  try {
    await appWindow.evaluate((url) => (window as unknown as ReopenWindow).hronaut.newTab({ url, active: true }), first)
    await expect.poll(() => showing(first)).toBe(true)
    await navigate(second)
    await expect.poll(() => visits(second)).toBe(1)
    // The page saves its state to its history entry a moment after it changes, as in Chrome: once it holds still, the
    // next change is the scroll's.
    const pageState = (url: string) => electronApp.evaluate(({ webContents }, url) => {
      const history = webContents.getAllWebContents().find((contents) => contents.getURL() === url)!.navigationHistory
      return history.getEntryAtIndex(history.getActiveIndex())?.pageState
    }, url)
    let unscrolled = await pageState(second)
    await expect.poll(async () => {
      await appWindow.waitForTimeout(1_500)
      const latest = await pageState(second)
      const still = latest === unscrolled
      unscrolled = latest
      return still
    }, { timeout: 15_000 }).toBe(true)
    await electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents()
      .find((contents) => contents.getURL() === url)!.executeJavaScript('window.scrollTo(0, 1500)'), second)
    await expect.poll(() => scrolled(second)).toBe(1500)
    await expect.poll(() => pageState(second), { timeout: 10_000 }).not.toBe(unscrolled)
    await close()

    // Ctrl/Cmd+Shift+T brought the tab back at its page with no Back, at the top, and counted another visit.
    await appWindow.keyboard.press('ControlOrMeta+Shift+T')
    await expect.poll(async () => (await tab())?.canGoBack).toBe(true)
    await expect.poll(() => showing(second)).toBe(true)
    await expect.poll(() => scrolled(second)).toBe(1500)
    await appWindow.waitForTimeout(500)
    expect(await visits(second)).toBe(1)
    await back()
    await expect.poll(() => showing(first)).toBe(true)

    // A page removed from the history does not come back with Back once the tab reopens.
    await navigate(second)
    await navigate(third)
    await close()
    await appWindow.evaluate(async (url) => {
      const history = (window as unknown as ReopenWindow).hronautHistory
      await history.remove((await history.list()).find((entry) => entry.url === url)!.id)
    }, first)
    await appWindow.keyboard.press('ControlOrMeta+Shift+T')
    await expect.poll(async () => (await tab())?.canGoBack).toBe(true)
    await expect.poll(() => showing(third)).toBe(true)
    await back()
    await expect.poll(() => showing(second)).toBe(true)
    await expect.poll(async () => (await tab())?.canGoBack).toBe(false)
  } finally {
    await closeFixtureServer(server)
  }
})
