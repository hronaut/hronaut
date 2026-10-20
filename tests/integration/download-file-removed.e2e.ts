import { rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { BrowserDownloadState } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

test('shows a finished download whose file was moved or deleted as gone, and as finished again once it is back', async ({ electronApp: app, appWindow }) => {
  const server = createServer((request, response) => {
    if (request.url === '/report.txt') {
      response.writeHead(200, { 'content-disposition': 'attachment; filename="report.txt"', 'content-type': 'text/plain' }).end('report')
      return
    }
    response.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>Report fixture</title><a id="report" href="/report.txt">Report</a>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing fixture port')
    const page = `http://127.0.0.1:${address.port}/`
    await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(page)}, active: true })`)
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.title)')).toBe('Report fixture')
    await app.evaluate(({ shell }) => {
      const scope = globalThis as typeof globalThis & { revealed: string[] }
      scope.revealed = []
      shell.showItemInFolder = (path) => { scope.revealed.push(path) }
    })
    await app.evaluate(async ({ webContents }, url) => {
      const contents = webContents.getAllWebContents().find((candidate) => candidate.getURL() === url)
      if (!contents) throw new Error('Download fixture web contents was not found')
      await contents.executeJavaScript("document.querySelector('#report').click()")
    }, page)
    const downloads = () => appWindow.evaluate('window.hronautDownloads.list()') as Promise<BrowserDownloadState[]>
    await expect.poll(async () => (await downloads())[0]?.state).toBe('completed')
    const savePath = (await downloads())[0]!.savePath!
    const revealed = () => app.evaluate(() => (globalThis as typeof globalThis & { revealed: string[] }).revealed)

    const panel = appWindow.getByRole('dialog', { name: 'Downloads' })
    // Its name counts the downloads.
    const downloadsButton = appWindow.locator('.downloads-button')
    if (!await panel.isVisible()) await downloadsButton.click()
    const row = panel.getByRole('article').filter({ hasText: 'report.txt' })
    const show = panel.getByRole('button', { name: 'Show report.txt in folder' })
    await expect(row).toContainText('Complete')
    await show.click()
    await expect.poll(revealed).toEqual([savePath])

    // The panel kept calling the file complete and offering Show in folder, which then failed in English.
    await rm(savePath)
    await show.click()
    await expect(panel.getByRole('alert')).toHaveText('This file was moved or deleted, so it cannot be shown in its folder.')
    await expect(row).toContainText('Moved or deleted')
    await expect(show).toBeHidden()
    await expect(panel.getByRole('button', { name: 'Copy saved path for report.txt' })).toBeHidden()
    expect(await revealed()).toEqual([savePath])

    // Opening the panel checks again, so a file put back is shown as finished.
    await panel.getByRole('button', { name: 'Close downloads' }).click()
    await writeFile(savePath, 'report')
    await downloadsButton.click()
    await expect(row).toContainText('Complete')
    await expect(show).toBeVisible()

    await panel.getByRole('button', { name: 'Close downloads' }).click()
    await rm(savePath)
    await downloadsButton.click()
    await expect(row).toContainText('Moved or deleted')
    await expect(show).toBeHidden()
  } finally {
    await closeFixtureServer(server)
  }
})
