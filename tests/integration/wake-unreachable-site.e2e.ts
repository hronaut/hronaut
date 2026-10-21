import { createServer } from 'node:http'
import type { HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

// A sleeping tab whose website could not be reached, such as a local dev server that was stopped, could not be opened:
// selecting it failed with the connection error and left the other tab on screen, so the person could not reach its
// error page to reload it, and closing the tab beside it failed the same way.

test('opens a sleeping tab whose website cannot be reached on its error page, also when it replaces a closed tab', async ({ appWindow, electronApp }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' })
    response.end('<!doctype html><title>Dev server page</title><main>Dev server page</main>')
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  let serverOpen = true
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing fixture port')
    const url = `http://127.0.0.1:${address.port}/app`
    const ids = await appWindow.evaluate(async (url) => {
      const browser = (window as unknown as { hronaut: HronautApi }).hronaut
      const sleepy = (await browser.newTab({ url, active: true })).activeTabId!
      const shown = (await browser.newTab({ url: 'data:text/html,<title>Shown page</title>', active: true })).activeTabId!
      return { sleepy, shown }
    }, url)
    const tab = (id: string) => appWindow.evaluate(async (id) => {
      const state = await (window as unknown as { hronaut: HronautApi }).hronaut.getState()
      const found = state.tabs.find(candidate => candidate.id === id)
      return found && { sleeping: found.sleeping, loading: found.loading, active: state.activeTabId === id, problem: found.pageProblem?.kind }
    }, id)
    await expect.poll(async () => (await tab(ids.sleepy))?.loading).toBe(false)
    await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.setTabSleeping(id, true), ids.sleepy)
    await expect.poll(async () => (await tab(ids.sleepy))?.sleeping).toBe(true)
    await closeFixtureServer(server)
    serverOpen = false

    const selected = await appWindow.evaluate(async (id) => {
      try {
        await (window as unknown as { hronaut: HronautApi }).hronaut.selectTab(id)
        return null
      } catch (error) {
        return error instanceof Error ? error.message : String(error)
      }
    }, ids.sleepy)
    expect(selected).toBeNull()
    await expect.poll(() => tab(ids.sleepy)).toEqual({ sleeping: false, loading: false, active: true, problem: 'load-error' })
    // The tab's history holds its address once, and no longer the sleeping page.
    expect(await electronApp.evaluate(({ webContents }, url) => {
      const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)!
      return Array.from({ length: page.navigationHistory.length() }, (_, index) => page.navigationHistory.getEntryAtIndex(index).url)
        .filter(entry => entry === url || entry.includes('%3Ctitle%3ESleeping%20tab'))
    }, url)).toEqual([url])

    // Closing the tab on screen when that sleeping tab replaces it closes it too.
    await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.selectTab(id), ids.shown)
    await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.setTabSleeping(id, true), ids.sleepy)
    await expect.poll(async () => (await tab(ids.sleepy))?.sleeping).toBe(true)
    const closed = await appWindow.evaluate(async (id) => {
      try {
        await (window as unknown as { hronaut: HronautApi }).hronaut.closeTab(id)
        return null
      } catch (error) {
        return error instanceof Error ? error.message : String(error)
      }
    }, ids.shown)
    expect(closed).toBeNull()
    await expect.poll(async () => (await tab(ids.shown)) ?? 'closed').toBe('closed')
    await expect.poll(() => tab(ids.sleepy)).toEqual({ sleeping: false, loading: false, active: true, problem: 'load-error' })
  } finally {
    if (serverOpen) await closeFixtureServer(server)
  }
})
