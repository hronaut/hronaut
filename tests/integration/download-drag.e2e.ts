import { rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { BrowserDownloadState } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

test('drags a finished download\'s file out of Downloads, as in Chrome, and says when the file is gone', async ({ electronApp: app, appWindow }) => {
  const server = createServer((request, response) => {
    if (request.url === '/report.txt') {
      response.writeHead(200, { 'content-disposition': 'attachment; filename="report.txt"', 'content-type': 'text/plain' }).end('report')
      return
    }
    response.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>Drag fixture</title><a id="report" href="/report.txt">Report</a>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing fixture port')
    const page = `http://127.0.0.1:${address.port}/`
    await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(page)}, active: true })`)
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.title)')).toBe('Drag fixture')
    // The operating system's drag loop cannot run here, so Hronaut's window notes the drag it is asked to start.
    await app.evaluate(({ webContents }, shellUrl) => {
      const scope = globalThis as typeof globalThis & { dragged: Array<{ file?: string; icon: boolean }> }
      scope.dragged = []
      const shell = webContents.getAllWebContents().find((candidate) => candidate.getURL() === shellUrl)
      if (!shell) throw new Error('Hronaut window was not found')
      shell.startDrag = (item) => { scope.dragged.push({ file: item.file, icon: typeof item.icon !== 'string' && !item.icon.isEmpty() }) }
    }, appWindow.url())
    const dragged = () => app.evaluate(() => (globalThis as typeof globalThis & { dragged: Array<{ file?: string; icon: boolean }> }).dragged)
    await app.evaluate(async ({ webContents }, url) => {
      const contents = webContents.getAllWebContents().find((candidate) => candidate.getURL() === url)
      if (!contents) throw new Error('Download fixture web contents was not found')
      await contents.executeJavaScript("document.querySelector('#report').click()")
    }, page)
    const downloads = () => appWindow.evaluate('window.hronautDownloads.list()') as Promise<BrowserDownloadState[]>
    await expect.poll(async () => (await downloads())[0]?.state).toBe('completed')
    const savePath = (await downloads())[0]!.savePath!

    const panel = appWindow.getByRole('dialog', { name: 'Downloads' })
    if (!await panel.isVisible()) await appWindow.locator('.downloads-button').click()
    const row = panel.getByRole('article').filter({ hasText: 'report.txt' })
    await expect(row).toContainText('Complete')
    // As on Chrome's downloads page, the file's name drags it, and the rest of the row still selects text.
    const name = row.getByText('report.txt', { exact: true })
    await expect(name).toHaveAttribute('draggable', 'true')
    await expect(row).not.toHaveAttribute('draggable')
    await name.dispatchEvent('dragstart')
    // The file itself, with an image under the pointer, which macOS needs.
    await expect.poll(dragged).toEqual([{ file: savePath, icon: true }])
    await expect(panel.getByRole('alert')).toHaveCount(0)
    // Dragging across the rest of the row still selects its text.
    const origin = await row.getByText(/127\.0\.0\.1/).boundingBox()
    if (!origin) throw new Error('Missing download origin')
    await appWindow.mouse.move(origin.x + 1, origin.y + origin.height / 2)
    await appWindow.mouse.down()
    await appWindow.mouse.move(origin.x + origin.width - 1, origin.y + origin.height / 2, { steps: 8 })
    await appWindow.mouse.up()
    expect(await appWindow.evaluate(() => getSelection()?.toString())).toContain('127.0.0.1')
    expect(await dragged()).toHaveLength(1)

    await rm(savePath)
    await name.dispatchEvent('dragstart')
    await expect(panel.getByRole('alert')).toHaveText('This file was moved or deleted, so it cannot be dragged.')
    await expect(row).toContainText('Moved or deleted')
    await expect(name).not.toHaveAttribute('draggable')
    expect(await dragged()).toHaveLength(1)
  } finally {
    await closeFixtureServer(server)
  }
})
