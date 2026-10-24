import { createServer } from 'node:http'
import { lstat, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'
import type { HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, closeHronaut, expect, launchHronaut, test } from './fixtures.js'

test('a restart keeps each site\'s zoom in its workspace, as Chrome', async ({ profileDirectory, mcpPort }) => {
  // Every site opened at 100% after a restart, as Electron keeps a site's zoom only while it runs.
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      .end(`<!doctype html><title>Zoom ${request.url?.slice(1)}</title><main>Site zoom fixture</main>`)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const site = `http://127.0.0.1:${address.port}`
  const otherSite = `http://localhost:${address.port}`
  const tabAt = async (window: Page, url: string) => (await window.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState()))
    .tabs.find((tab) => tab.url === url && !tab.loading)
  const open = async (window: Page, url: string) => {
    await window.evaluate((url) => (window as unknown as { hronaut: HronautApi }).hronaut.newTab({ url, active: true }), url)
    await expect.poll(() => tabAt(window, url)).toBeDefined()
    return (await tabAt(window, url))!
  }
  const zoom = (app: ElectronApplication, url: string) => app.evaluate(({ webContents }, url) => (
    webContents.getAllWebContents().find((page) => page.getURL() === url)?.getZoomFactor()
  ), url)
  const zoomPath = join(profileDirectory, 'site-zoom.json')
  let before: Awaited<ReturnType<typeof launchHronaut>> | undefined
  let after: Awaited<ReturnType<typeof launchHronaut>> | undefined
  try {
    before = await launchHronaut(profileDirectory, mcpPort)
    const zoomed = await open(before.window, `${site}/first`)
    await before.window.evaluate((tabId) => (window as unknown as { hronaut: HronautApi }).hronaut.setZoom({ tabId, action: 'set', percent: 150 }), zoomed.id)
    await expect.poll(() => zoom(before!.app, `${site}/first`)).toBeCloseTo(1.5, 8)
    // Saved within a second of the change, not only when Hronaut quits, and readable only by the person.
    await expect.poll(() => readFile(zoomPath, 'utf8').catch(() => ''), { timeout: 10_000 }).toContain('"host":"127.0.0.1","percent":150')
    expect((await lstat(zoomPath)).mode & 0o777).toBe(0o600)
    await closeHronaut(before.app)
    before = undefined

    after = await launchHronaut(profileDirectory, mcpPort)
    // The tab the restart brings back opens at its site's zoom, and so does a new tab of the site.
    await expect.poll(() => zoom(after!.app, `${site}/first`), { timeout: 15_000 }).toBeCloseTo(1.5, 8)
    expect((await tabAt(after.window, `${site}/first`))?.zoomPercent).toBe(150)
    const sibling = await open(after.window, `${site}/second`)
    await expect.poll(() => zoom(after!.app, `${site}/second`)).toBeCloseTo(1.5, 8)
    expect((await tabAt(after.window, `${site}/second`))?.zoomPercent).toBe(150)
    // Another site keeps 100%.
    await open(after.window, `${otherSite}/third`)
    expect(await zoom(after.app, `${otherSite}/third`)).toBe(1)

    // Back at 100%, the site's zoom is forgotten, also in the file.
    await after.window.evaluate((tabId) => (window as unknown as { hronaut: HronautApi }).hronaut.setZoom({ tabId, action: 'reset' }), sibling.id)
    await expect.poll(() => zoom(after!.app, `${site}/first`)).toBe(1)
    await expect.poll(() => readFile(zoomPath, 'utf8'), { timeout: 10_000 }).not.toContain('127.0.0.1')
  } finally {
    if (before) await closeHronaut(before.app)
    if (after) await closeHronaut(after.app)
    await closeFixtureServer(server)
  }
})
