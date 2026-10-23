import { createServer } from 'node:http'
import type { ElectronApplication, Page } from '@playwright/test'
import { closeFixtureServer, expect, test } from './fixtures.js'

interface HistoryEntry { url: string; title: string; visitedAt: string; visitCount: number }

/** A local website whose pages are named by their path, and the address of one of its pages. */
async function website(): Promise<{ server: ReturnType<typeof createServer>; pageUrl: (path: string) => string }> {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    const name = request.url === '/' ? 'Home' : request.url?.slice(1) ?? 'Page'
    response.end(`<!doctype html><title>${name}</title><main>${name}</main>`)
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
    const inbox = pageUrl('/Inbox')
    await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(inbox)}, active: true })`)
    await expect.poll(async () => (await historyEntry(appWindow, inbox))?.title).toBe('Inbox')
    await inPage(electronApp, inbox, "document.title = 'Inbox - Mail'")
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
