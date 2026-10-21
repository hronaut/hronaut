import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { ElectronApplication, Page } from '@playwright/test'
import type { HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

/**
 * Serves a page per path, titled after it, and counts the requests for each. A path made unreachable has its
 * connection dropped; with `noStore`, the browser keeps no copy of a page, so it always asks for it again.
 */
async function pages(options: { noStore?: boolean } = {}) {
  const requests = new Map<string, number>()
  const unreachable = new Set<string>()
  const server = createServer((request, response) => {
    const path = request.url ?? '/'
    requests.set(path, (requests.get(path) ?? 0) + 1)
    if (unreachable.has(path)) {
      request.socket.destroy()
      return
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...options.noStore ? { 'cache-control': 'no-store' } : {} })
    response.end(`<!doctype html><title>Page ${path.slice(1)}</title><main>${path}</main>`)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  return { server, origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, requests, unreachable }
}

/** The addresses in the tab's history and the index of the one it shows. */
function history(electronApp: ElectronApplication, pageId: number) {
  return electronApp.evaluate(({ webContents }, id) => {
    const page = webContents.fromId(id)!
    return { urls: page.navigationHistory.getAllEntries().map(entry => entry.url), index: page.navigationHistory.getActiveIndex() }
  }, pageId)
}

function tabState(appWindow: Page, tabId: string) {
  return appWindow.evaluate((tabId) => (window as unknown as { hronaut: HronautApi }).hronaut.getState()
    .then(state => state.tabs.find(tab => tab.id === tabId)), tabId)
}

/**
 * Opens a tab on the first path and goes on to the others, each once the page before it has loaded, then shows another
 * tab so this one may sleep. Going on while a page still loads replaces it, so it would not be in the history.
 */
async function tabThrough(appWindow: Page, electronApp: ElectronApplication, origin: string, paths: string[]) {
  const tabId = await appWindow.evaluate((url) => (window as unknown as { hronaut: HronautApi }).hronaut.newTab({ url, active: true })
    .then(state => state.activeTabId!), `${origin}${paths[0]}`)
  await expect.poll(() => tabState(appWindow, tabId)).toMatchObject({ url: `${origin}${paths[0]}`, title: `Page ${paths[0]!.slice(1)}`, loading: false })
  for (const path of paths.slice(1)) {
    await appWindow.evaluate(({ url, tabId }) => (window as unknown as { hronaut: HronautApi }).hronaut.navigate({ url, tabId }), { url: `${origin}${path}`, tabId })
    await expect.poll(() => tabState(appWindow, tabId)).toMatchObject({ url: `${origin}${path}`, title: `Page ${path.slice(1)}`, loading: false })
  }
  const pageId = await electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(page => page.getURL() === url)?.id, `${origin}${paths.at(-1)}`)
  if (!pageId) throw new Error('Missing the tab page')
  await appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.newTab({ url: 'about:blank', active: true }))
  return { tabId, pageId }
}

async function sleepAndWake(appWindow: Page, tabId: string) {
  await appWindow.evaluate((tabId) => (window as unknown as { hronaut: HronautApi }).hronaut.setTabSleeping(tabId, true), tabId)
  expect(await tabState(appWindow, tabId)).toMatchObject({ sleeping: true })
  await appWindow.evaluate((tabId) => (window as unknown as { hronaut: HronautApi }).hronaut.setTabSleeping(tabId, false), tabId)
  await expect.poll(() => tabState(appWindow, tabId)).toMatchObject({ sleeping: false, loading: false })
}

test('a woken tab keeps its history, and Back goes to the page before it', async ({ appWindow, electronApp }) => {
  const { server, origin } = await pages()
  try {
    const { tabId, pageId } = await tabThrough(appWindow, electronApp, origin, ['/one', '/two', '/three'])
    await sleepAndWake(appWindow, tabId)

    // Waking loaded the page again after Hronaut's own sleeping page, so Back opened that internal page.
    expect(await history(electronApp, pageId)).toEqual({ urls: [`${origin}/one`, `${origin}/two`, `${origin}/three`], index: 2 })
    await appWindow.evaluate((tabId) => (window as unknown as { hronaut: HronautApi }).hronaut.back(tabId), tabId)
    await expect.poll(() => tabState(appWindow, tabId)).toMatchObject({ url: `${origin}/two`, title: 'Page two', loading: false })
  } finally {
    await closeFixtureServer(server)
  }
})

test('a tab that slept after going back wakes on that page with the pages before it', async ({ appWindow, electronApp }) => {
  const { server, origin } = await pages()
  try {
    const { tabId, pageId } = await tabThrough(appWindow, electronApp, origin, ['/one', '/two', '/three'])
    await appWindow.evaluate((tabId) => (window as unknown as { hronaut: HronautApi }).hronaut.back(tabId), tabId)
    await expect.poll(() => tabState(appWindow, tabId)).toMatchObject({ url: `${origin}/two`, loading: false })
    await sleepAndWake(appWindow, tabId)

    const woken = await history(electronApp, pageId)
    expect(woken.urls.slice(0, woken.index + 1)).toEqual([`${origin}/one`, `${origin}/two`])
    expect(woken.urls.some(url => url.startsWith('data:'))).toBe(false)
    expect(await tabState(appWindow, tabId)).toMatchObject({ url: `${origin}/two`, title: 'Page two' })
    await appWindow.evaluate((tabId) => (window as unknown as { hronaut: HronautApi }).hronaut.back(tabId), tabId)
    await expect.poll(() => tabState(appWindow, tabId)).toMatchObject({ url: `${origin}/one`, title: 'Page one', loading: false })
  } finally {
    await closeFixtureServer(server)
  }
})

test('a wake onto a page that cannot be reached opens its error page, with the pages before it', async ({ appWindow, electronApp }) => {
  const { server, origin, unreachable } = await pages({ noStore: true })
  try {
    const { tabId, pageId } = await tabThrough(appWindow, electronApp, origin, ['/one', '/two'])
    await appWindow.evaluate((tabId) => (window as unknown as { hronaut: HronautApi }).hronaut.setTabSleeping(tabId, true), tabId)
    unreachable.add('/two')

    // Going back fails and shows the error page at the tab's address, as Chrome shows a discarded tab whose site is
    // down, so the tab is awake there and Reload tries again. The wake used to fail and send the tab back to sleep, so
    // the person could not open the tab at all.
    await appWindow.evaluate((tabId) => (window as unknown as { hronaut: HronautApi }).hronaut.setTabSleeping(tabId, false), tabId)
    await expect.poll(() => tabState(appWindow, tabId)).toMatchObject({
      url: `${origin}/two`, sleeping: false, loading: false, pageProblem: { kind: 'load-error' }
    })
    expect(await history(electronApp, pageId)).toEqual({ urls: [`${origin}/one`, `${origin}/two`], index: 1 })
  } finally {
    await closeFixtureServer(server)
  }
})

test('Reload on a sleeping tab asks the site for its page again', async ({ appWindow, electronApp }) => {
  const { server, origin, requests } = await pages()
  try {
    const { tabId } = await tabThrough(appWindow, electronApp, origin, ['/one', '/two'])
    await appWindow.evaluate((tabId) => (window as unknown as { hronaut: HronautApi }).hronaut.setTabSleeping(tabId, true), tabId)
    const before = requests.get('/two') ?? 0

    // Waking, like Back, can show the page the browser kept; Reload used to stop there.
    await appWindow.evaluate((tabId) => (window as unknown as { hronaut: HronautApi }).hronaut.reload(tabId), tabId)
    expect(requests.get('/two') ?? 0).toBeGreaterThan(before)
    await expect.poll(() => tabState(appWindow, tabId)).toMatchObject({ url: `${origin}/two`, sleeping: false, loading: false })
  } finally {
    await closeFixtureServer(server)
  }
})
