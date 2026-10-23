import { createServer } from 'node:http'
import type { ElectronApplication, Page } from '@playwright/test'
import { closeFixtureServer, closeHronaut, expect, launchHronaut, test } from './fixtures.js'

interface HistoryEntry { url: string; title: string; visitedAt: string; visitCount: number }

/** A local website whose pages are named by their path, and the address of one of its pages. */
async function website(): Promise<{ server: ReturnType<typeof createServer>; pageUrl: (path: string) => string }> {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    const [path, retitle] = (request.url ?? '/').split('?retitle=')
    const name = path === '/' ? 'Home' : path?.slice(1) ?? 'Page'
    // A page can give itself another title once it has loaded.
    const script = retitle ? `<script>addEventListener('load', () => setTimeout(() => { document.title = decodeURIComponent(${JSON.stringify(retitle)}) }, 500))</script>` : ''
    response.end(`<!doctype html><title>${name}</title><main>${name}</main>${script}`)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('History fixture port is unavailable')
  return { server, pageUrl: (path) => `http://127.0.0.1:${address.port}${path}` }
}

function historyEntry(appWindow: Page, url: string): Promise<HistoryEntry | undefined> {
  return appWindow.evaluate(async (target) => {
    const history = (window as unknown as { hronautHistory: { list(): Promise<HistoryEntry[]> } }).hronautHistory
    return (await history.list()).find((entry) => entry.url === target)
  }, url)
}

/** Runs a script in the page at this address, which is the active tab's. */
async function inPage(electronApp: ElectronApplication, url: string, script: string): Promise<void> {
  await electronApp.evaluate(async ({ webContents }, { target, script }) => {
    const page = webContents.getAllWebContents().find((contents) => contents.getURL() === target)
    if (!page) throw new Error('History fixture page is unavailable')
    await page.executeJavaScript(script)
  }, { target: url, script })
}

test('a reload moves the page to the top of the history without counting another visit, and going back to it counts one', async ({ appWindow, electronApp }) => {
  const { server, pageUrl } = await website()
  try {
    const home = pageUrl('/')
    await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(home)}, active: true })`)
    await expect.poll(async () => (await historyEntry(appWindow, home))?.visitCount).toBe(1)

    // The toolbar's Reload, then the page's own.
    for (const reload of ['shell', 'page'] as const) {
      const before = (await historyEntry(appWindow, home))!.visitedAt
      if (reload === 'shell') await appWindow.evaluate('window.hronaut.reload()')
      else await inPage(electronApp, home, 'setTimeout(() => location.reload(), 0)')
      await expect.poll(async () => (await historyEntry(appWindow, home))?.visitedAt).not.toBe(before)
      expect(await historyEntry(appWindow, home)).toMatchObject({ title: 'Home', visitCount: 1 })
    }

    const story = pageUrl('/Story')
    await appWindow.evaluate(`window.hronaut.navigate({ url: ${JSON.stringify(story)} })`)
    await expect.poll(async () => (await historyEntry(appWindow, story))?.visitCount).toBe(1)
    await appWindow.evaluate('window.hronaut.back()')
    await expect.poll(async () => (await historyEntry(appWindow, home))?.visitCount).toBe(2)
  } finally {
    await closeFixtureServer(server)
  }
})

test('the history keeps the title a page sets as it loads, and not one it sets long after to get attention', async ({ appWindow, electronApp }) => {
  const { server, pageUrl } = await website()
  try {
    const inbox = pageUrl('/Inbox?retitle=Inbox%20-%20Mail')
    await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(inbox)}, active: true })`)
    // The title it gives itself half a second after it loaded.
    await expect.poll(async () => (await historyEntry(appWindow, inbox))?.title).toBe('Inbox - Mail')

    await appWindow.waitForTimeout(5_500)
    await inPage(electronApp, inbox, "document.title = '(1) New message from Bob'")
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.title)'))
      .toBe('(1) New message from Bob')
    // The tab shows the new title, which the history does not take: the history saves its changes in order, so a
    // title change it took would be saved by the time it holds the next visit.
    const other = pageUrl('/Other')
    await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(other)}, active: true })`)
    await expect.poll(async () => (await historyEntry(appWindow, other))?.visitCount).toBe(1)
    expect(await historyEntry(appWindow, inbox)).toMatchObject({ title: 'Inbox - Mail', visitCount: 1 })
  } finally {
    await closeFixtureServer(server)
  }
})

test('a restored tab counts the page a link opens while the page it restored is still loading', async ({ profileDirectory, mcpPort }) => {
  // A restored, duplicated or waking tab loads its page again, which is not another visit. While that page went on
  // loading, such as for an image its server is slow to send, the tab recorded no page a link in it opened.
  let imageRequests = 0
  const images: Array<import('node:http').ServerResponse> = []
  const server = createServer((request, response) => {
    if (request.url === '/slow.png') {
      imageRequests += 1
      images.push(response)
      return
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    response.end(request.url === '/Cart'
      ? '<!doctype html><title>Cart</title><main>Cart</main>'
      : '<!doctype html><title>Shop</title><main><a href="/Cart">Cart</a><img src="/slow.png" alt=""></main>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  let first: Awaited<ReturnType<typeof launchHronaut>> | undefined
  let second: Awaited<ReturnType<typeof launchHronaut>> | undefined
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('History fixture port is unavailable')
    const shop = `http://127.0.0.1:${address.port}/Shop`
    const cart = `http://127.0.0.1:${address.port}/Cart`
    first = await launchHronaut(profileDirectory, mcpPort)
    await first.window.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(shop)}, active: true })`)
    await expect.poll(async () => (await historyEntry(first!.window, shop))?.visitCount).toBe(1)
    await closeHronaut(first.app)
    first = undefined

    second = await launchHronaut(profileDirectory, mcpPort)
    await expect.poll(() => imageRequests).toBe(2)
    expect(await second.window.evaluate(`window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.url === ${JSON.stringify(shop)}))`)).toMatchObject({
      loading: true
    })
    await inPage(second.app, shop, "document.querySelector('a').click()")
    await expect.poll(async () => (await historyEntry(second!.window, cart))?.visitCount).toBe(1)
    expect(await historyEntry(second.window, shop)).toMatchObject({ visitCount: 1 })
  } finally {
    for (const image of images) image.destroy()
    if (first) await closeHronaut(first.app)
    if (second) await closeHronaut(second.app)
    await closeFixtureServer(server)
  }
})
