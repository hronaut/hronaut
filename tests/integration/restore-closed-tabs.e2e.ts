import { createServer } from 'node:http'
import { lstat, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { closeFixtureServer, closeHronaut, expect, launchHronaut, test } from './fixtures.js'

interface RestartWindow {
  hronaut: {
    newTab(options: { url: string; active: boolean }): Promise<unknown>
    navigate(options: { tabId?: string; url: string }): Promise<unknown>
    back(tabId?: string): Promise<unknown>
    closeTab(tabId: string): Promise<unknown>
    reopenClosedTab(closedTabId?: string): Promise<unknown>
    getState(): Promise<{
      tabs: Array<{ id: string; url: string; loading: boolean; canGoBack: boolean }>
      closedTabs: Array<{ id: string; url: string; title: string }>
    }>
  }
  hronautHistory: { list(): Promise<Array<{ url: string; visitCount: number }>> }
}

test('a restart keeps Recently closed, and a closed tab reopens with its Back history, as Chrome', async ({ profileDirectory, mcpPort }) => {
  // Recently closed was empty after a restart, so a tab closed before quitting could not be reopened.
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      .end(`<!doctype html><title>Closed ${request.url?.slice(1)}</title><main>Closed tab fixture</main>`)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const [first, second] = ['first', 'second'].map((name) => `http://127.0.0.1:${address.port}/${name}`) as [string, string]
  const state = (window: Page) => window.evaluate(() => (window as unknown as RestartWindow).hronaut.getState())
  const tab = async (window: Page) => (await state(window)).tabs.find((candidate) => [first, second].includes(candidate.url))
  const showing = async (window: Page, url: string) => { const shown = await tab(window); return shown?.url === url && !shown.loading }
  const visits = (window: Page, url: string) => window.evaluate(async (url) => (await (window as unknown as RestartWindow).hronautHistory.list())
    .find((entry) => entry.url === url)?.visitCount, url)
  const closedTabsPath = join(profileDirectory, 'closed-tabs.json')
  let before: Awaited<ReturnType<typeof launchHronaut>> | undefined
  let after: Awaited<ReturnType<typeof launchHronaut>> | undefined
  try {
    before = await launchHronaut(profileDirectory, mcpPort)
    await before.window.evaluate((url) => (window as unknown as RestartWindow).hronaut.newTab({ url, active: true }), first)
    await expect.poll(() => showing(before!.window, first)).toBe(true)
    const { id } = (await tab(before.window))!
    await before.window.evaluate(({ id, url }) => (window as unknown as RestartWindow).hronaut.navigate({ tabId: id, url }), { id, url: second })
    await expect.poll(() => showing(before!.window, second)).toBe(true)
    await expect.poll(() => visits(before!.window, second)).toBe(1)
    await before.window.evaluate((id) => (window as unknown as RestartWindow).hronaut.closeTab(id), id)
    await expect.poll(() => tab(before!.window)).toBeUndefined()
    await expect.poll(async () => (await state(before!.window)).closedTabs.map((closed) => closed.url)).toEqual([second])
    await closeHronaut(before.app)
    before = undefined

    // Kept in the profile, readable only by the person.
    expect((await lstat(closedTabsPath)).mode & 0o777).toBe(0o600)
    expect(await readFile(closedTabsPath, 'utf8')).toContain(first)

    after = await launchHronaut(profileDirectory, mcpPort)
    await expect.poll(async () => (await state(after!.window)).closedTabs).toMatchObject([{ url: second, title: 'Closed second' }])
    await after.window.evaluate(() => (window as unknown as RestartWindow).hronaut.reopenClosedTab())
    await expect.poll(() => showing(after!.window, second)).toBe(true)
    expect(await tab(after.window)).toMatchObject({ canGoBack: true })
    // Reopening the page it showed is not another visit, as the visit counted before the restart.
    await after.window.waitForTimeout(500)
    expect(await visits(after.window, second)).toBe(1)
    expect((await state(after.window)).closedTabs).toEqual([])
    const reopened = (await tab(after.window))!
    await after.window.evaluate((id) => (window as unknown as RestartWindow).hronaut.back(id), reopened.id)
    await expect.poll(() => showing(after!.window, first)).toBe(true)
  } finally {
    if (before) await closeHronaut(before.app)
    if (after) await closeHronaut(after.app)
    await closeFixtureServer(server)
  }
})
