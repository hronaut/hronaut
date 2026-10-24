import { createServer } from 'node:http'
import { lstat, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import type { BrowserDownloadState, HronautApi, HronautDownloadsApi } from '../../src/shared/types.js'
import { closeFixtureServer, closeHronaut, expect, launchHronaut, test } from './fixtures.js'

test('a restart keeps the download history, as Chrome', async ({ profileDirectory, mcpPort }) => {
  // Downloads started empty after every restart, so a file downloaded before quitting could no longer be found there.
  const payload = Buffer.from('download history fixture')
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': payload.length, 'content-disposition': 'attachment; filename="kept.bin"' })
      .end(payload)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/kept`
  const pageUrl = 'data:text/html,<title>Download history fixture</title>'
  const list = (window: Page) => window.evaluate(() => (window as unknown as { hronautDownloads: HronautDownloadsApi }).hronautDownloads.list())
  const historyPath = join(profileDirectory, 'download-history.json')
  let before: Awaited<ReturnType<typeof launchHronaut>> | undefined
  let after: Awaited<ReturnType<typeof launchHronaut>> | undefined
  try {
    before = await launchHronaut(profileDirectory, mcpPort)
    await before.window.evaluate((url) => (window as unknown as { hronaut: HronautApi }).hronaut.newTab({ url, active: true }), pageUrl)
    await expect.poll(() => before!.app.evaluate(({ webContents }, url) => webContents.getAllWebContents().some((page) => page.getURL() === url), pageUrl)).toBe(true)
    await before.app.evaluate(({ webContents }, args) => {
      webContents.getAllWebContents().find((page) => page.getURL() === args.pageUrl)!.downloadURL(args.url)
    }, { pageUrl, url })
    await expect.poll(async () => (await list(before!.window)).find((download) => download.url === url)?.state).toBe('completed')
    const [kept] = await list(before.window) as [BrowserDownloadState]
    // Saved within a second of the change, not only when Hronaut quits, and readable only by the person.
    await expect.poll(() => readFile(historyPath, 'utf8').catch(() => ''), { timeout: 10_000 }).toContain('kept.bin')
    expect((await lstat(historyPath)).mode & 0o777).toBe(0o600)
    await closeHronaut(before.app)
    before = undefined

    after = await launchHronaut(profileDirectory, mcpPort)
    expect(await list(after.window)).toMatchObject([{ id: kept.id, url, filename: 'kept.bin', savePath: kept.savePath, state: 'completed', receivedBytes: payload.length }])
    expect(await readFile(kept.savePath!)).toEqual(payload)
    // A kept download is not a new one, so the Downloads panel stays closed.
    await after.window.waitForTimeout(500)
    await expect(after.window.getByRole('dialog', { name: 'Downloads', exact: true })).toBeHidden()
    // Nor does the toolbar show it as just downloaded, or count it: the button shows only this run's downloads.
    const downloadsButton = after.window.locator('.downloads-button')
    await expect(downloadsButton).toHaveAttribute('aria-label', 'Downloads')
    await expect(downloadsButton).not.toHaveClass(/\bcomplete\b/)
    await expect(downloadsButton.locator('.downloads-badge')).toHaveCount(0)

    // Removing it from the list also takes it out of the file.
    await after.window.evaluate((id) => (window as unknown as { hronautDownloads: HronautDownloadsApi }).hronautDownloads.removeFinished(id), kept.id)
    await expect.poll(() => readFile(historyPath, 'utf8'), { timeout: 10_000 }).not.toContain('kept.bin')
    expect(await readFile(kept.savePath!)).toEqual(payload)
  } finally {
    if (before) await closeHronaut(before.app)
    if (after) await closeHronaut(after.app)
    await closeFixtureServer(server)
  }
})
