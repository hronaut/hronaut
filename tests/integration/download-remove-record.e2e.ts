import { createServer } from 'node:http'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { HronautApi, HronautDownloadsApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

test('removes one real finished download record without deleting files or disturbing live transfers', async ({ appWindow, electronApp, profileDirectory }, testInfo) => {
  const payload = Buffer.from('synthetic download record removal')
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': payload.length,
      'content-disposition': `attachment; filename="${request.url === '/target' ? 'target' : request.url === '/cleanup' ? 'cleanup' : 'keep'}.bin"` }).end(payload)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const pageUrl = 'data:text/html,<title>Download removal fixture</title>'
  const list = () => appWindow.evaluate(() => (window as unknown as { hronautDownloads: HronautDownloadsApi }).hronautDownloads.list())
  try {
    await appWindow.evaluate(url => (window as unknown as { hronaut: HronautApi }).hronaut.newTab({ url, active: true }), pageUrl)
    await expect.poll(() => electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents().some(page => page.getURL() === url), pageUrl)).toBe(true)
    // downloadURL returns before will-download establishes the displayed order.
    // Finish each fixture transfer before starting the next so keep is the neighbor.
    for (const path of ['/target', '/keep']) {
      await electronApp.evaluate(({ webContents }, args) => {
        webContents.getAllWebContents().find(page => page.getURL() === args.pageUrl)!.downloadURL(args.url)
      }, { pageUrl, url: origin + path })
      await expect.poll(async () => (await list()).some(item => item.url === origin + path && item.state === 'completed')).toBe(true)
    }
    await expect.poll(async () => (await list()).filter(item => item.state === 'completed').length).toBe(2)
    await electronApp.evaluate(({ webContents }, args) => {
      webContents.getAllWebContents().find(page => page.getURL() === args.pageUrl)!.downloadURL(args.url)
    }, { pageUrl, url: origin + '/cleanup' })
    await expect.poll(async () => (await list()).filter(item => item.state === 'completed').length).toBe(3)
    const cleanup = (await list()).find(item => item.filename === 'cleanup.bin')!
    await expect(appWindow.locator('.download-item strong')).toHaveText(['cleanup.bin', 'keep.bin', 'target.bin'])
    const cleanupButton = appWindow.getByRole('button', { name: 'Remove cleanup.bin from list' })
    await cleanupButton.focus()
    await cleanupButton.press('Enter')
    await expect(appWindow.getByRole('button', { name: 'Remove keep.bin from list' })).toBeFocused()
    expect(await readFile(cleanup.savePath!)).toEqual(payload)
    const partialPath = join(profileDirectory, 'live-partial.bin')
    await writeFile(partialPath, payload.subarray(0, 5))
    await electronApp.evaluate(({ webContents }, args) => {
      webContents.getAllWebContents().find(page => page.getURL() === args.pageUrl)!.session.createInterruptedDownload({
        path: args.path, urlChain: [args.url], offset: 5, length: args.length, mimeType: 'application/octet-stream'
      })
    }, { pageUrl, path: partialPath, url: origin + '/live', length: payload.length })
    const before = await list()
    const target = before.find(item => item.filename === 'target.bin')!
    const live = before.find(item => item.state === 'interrupted')!
    expect(live.completedAt).toBeUndefined()
    const rejection = await appWindow.evaluate(async id => {
      try { await (window as unknown as { hronautDownloads: HronautDownloadsApi }).hronautDownloads.removeFinished(id); return false }
      catch { return true }
    }, live.id)
    expect(rejection).toBe(true)
    const panel = appWindow.getByRole('dialog', { name: 'Downloads', exact: true })
    const search = panel.getByRole('searchbox')
    await search.fill('target')
    await panel.getByRole('combobox', { name: 'Filter download status' }).selectOption('finished')
    const remove = panel.getByRole('button', { name: 'Remove target.bin from list' })
    await remove.focus()
    await remove.press('Enter')
    await expect.poll(async () => (await list()).map(item => item.id).sort()).toEqual(before.filter(item => item.id !== target.id).map(item => item.id).sort())
    await expect(search).toBeFocused()
    await expect(search).toHaveValue('target')
    await expect(panel.getByRole('status')).toHaveText('0 of 2 downloads')
    for (const item of before.filter(item => item.state === 'completed')) expect(await readFile(item.savePath!)).toEqual(payload)
    expect(await readFile(partialPath)).toEqual(payload.subarray(0, 5))
    expect((await list()).find(item => item.id === live.id)).toMatchObject({ state: 'interrupted' })
    await search.fill('')
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(760, 520))
    await expect(panel.getByRole('button', { name: 'Remove keep.bin from list' })).toBeInViewport({ ratio: 1 })
    expect(await panel.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
    await testInfo.attach('download-remove-record', { body: await panel.screenshot(), contentType: 'image/png' })
  } finally { await closeFixtureServer(server) }
})
