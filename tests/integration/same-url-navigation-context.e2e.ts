import { createServer } from 'node:http'
import type { HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

test('closes stale site controls after a same-URL page navigation', async ({ appWindow, electronApp }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end('<!doctype html><title>Same URL context</title><main>Context fixture</main>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))

  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing fixture port')
    const url = `http://127.0.0.1:${address.port}/page`
    const initial = await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(url)}, active: true })`) as {
      activeTabId: string
    }
    const currentTab = () => appWindow.evaluate(async (id) => {
      const state = await (window as typeof window & { hronaut: HronautApi }).hronaut.getState()
      return state.tabs.find((tab) => tab.id === id)
    }, initial.activeTabId)
    await expect.poll(async () => (await currentTab())?.url).toBe(url)
    await appWindow.getByRole('button', { name: /Site controls for 127\.0\.0\.1/ }).click()
    const panel = appWindow.getByRole('dialog', { name: '127.0.0.1' })
    await expect(panel).toBeVisible()
    const before = (await currentTab())?.navigationGeneration ?? 0

    await electronApp.evaluate(async ({ webContents }, target) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL() === target)
      if (!page) throw new Error('Missing fixture page')
      await page.executeJavaScript("history.pushState({ version: 1 }, '', location.href)")
    }, url)

    await expect.poll(async () => (await currentTab())?.navigationGeneration ?? 0).toBeGreaterThan(before)
    await expect(panel).toBeHidden()
  } finally {
    await closeFixtureServer(server)
  }
})
