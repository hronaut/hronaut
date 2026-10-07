import { createServer } from 'node:http'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { BrowserDownloadState, HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

const payload = Buffer.alloc(128 * 1024, 'synthetic-download-filter')
const offset = 32 * 1024

test('filters real resumable transfers and clears finished downloads across hidden rows', async ({ appWindow, electronApp, profileDirectory }, testInfo) => {
  const server = createServer((request, response) => {
    const start = Number(/^bytes=(\d+)-/.exec(request.headers.range ?? '')?.[1] ?? 0)
    response.writeHead(start ? 206 : 200, {
      'content-type': 'application/octet-stream',
      'content-length': payload.length - start,
      'content-disposition': 'attachment; filename="hidden-finished.bin"',
      'accept-ranges': 'bytes',
      etag: '"download-filters"',
      ...(start ? { 'content-range': `bytes ${start}-${payload.length - 1}/${payload.length}` } : {})
    })
    response.end(payload.subarray(start))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const pageUrl = 'data:text/html,<title>Download filter fixture</title>'
  try {
    await appWindow.evaluate(url => (window as unknown as { hronaut: HronautApi }).hronaut.newTab({ url, active: true }), pageUrl)
    await expect.poll(() => electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents().some(page => page.getURL() === url), pageUrl)).toBe(true)
    await electronApp.evaluate(({ webContents }, { pageUrl, origin }) => {
      webContents.getAllWebContents().find(page => page.getURL() === pageUrl)!.downloadURL(`${origin}/finished`)
    }, { pageUrl, origin })
    await expect.poll(() => appWindow.evaluate('window.hronautDownloads.list()')).toEqual([
      expect.objectContaining({ state: 'completed' })
    ])
    for (const filename of ['report-resume.bin', 'report-cancel.bin']) {
      const path = join(profileDirectory, filename)
      await writeFile(path, payload.subarray(0, offset))
      await electronApp.evaluate(({ webContents }, args) => {
        webContents.getAllWebContents().find(page => page.getURL() === args.pageUrl)!.session.createInterruptedDownload({
          path: args.path, urlChain: [args.url], offset: args.offset, length: args.length,
          mimeType: 'application/octet-stream', eTag: '"download-filters"'
        })
      }, { pageUrl, path, url: `${origin}/${filename}`, offset, length: payload.length })
    }
    const retained = await appWindow.evaluate('window.hronautDownloads.list()') as BrowserDownloadState[]
    const cancelEntry = retained.find(entry => entry.url.endsWith('/report-cancel.bin'))!
    const resumeEntry = retained.find(entry => entry.url.endsWith('/report-resume.bin'))!
    expect(cancelEntry).toMatchObject({ state: 'interrupted', canResume: true })
    expect(resumeEntry).toMatchObject({ state: 'interrupted', canResume: true })
    const panel = appWindow.getByRole('dialog', { name: 'Downloads', exact: true })
    await expect(panel).toBeVisible()
    const search = panel.getByRole('searchbox', { name: 'Search filenames' })
    const status = panel.getByRole('combobox', { name: 'Filter download status' })
    await search.fill('REPORT')
    await status.selectOption('active')
    await expect(panel.getByRole('status')).toHaveText('2 of 3 downloads')
    const cancel = panel.getByRole('button', { name: `Cancel ${cancelEntry.filename}`, exact: true })
    await cancel.focus()
    await cancel.press('Enter')
    await expect(panel.getByRole('status')).toHaveText('1 of 3 downloads')
    await expect(search).toBeFocused()
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(760, 520))
    expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await testInfo.attach('download-filters', { body: await panel.screenshot(), contentType: 'image/png' })
    const resume = panel.getByRole('button', { name: `Resume ${resumeEntry.filename}`, exact: true })
    await resume.focus()
    await resume.press('Enter')
    await expect(panel.getByText('No matching downloads')).toBeVisible()
    await expect(search).toBeFocused()
    await status.selectOption('finished')
    await expect(panel.getByRole('status')).toHaveText('2 of 3 downloads')
    await panel.getByRole('button', { name: 'Close downloads' }).click()
    await appWindow.getByRole('button', { name: 'Recent downloads', exact: true }).click()
    await expect(search).toHaveValue('')
    await expect(status).toHaveValue('all')
    await search.fill('hidden')
    await expect(panel.getByRole('status')).toHaveText('1 of 3 downloads')
    const clear = panel.getByRole('button', { name: 'Clear all finished', exact: true })
    await expect(clear).toHaveAttribute('aria-describedby', 'downloads-clear-hint')
    await expect(panel.getByText('Clears all finished downloads, including those hidden by filters.')).toBeVisible()
    await clear.focus()
    await clear.press('Enter')
    await expect(panel.getByText('No downloads yet')).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Close downloads' })).toBeFocused()
    expect(await appWindow.evaluate('window.hronautDownloads.list()') as BrowserDownloadState[]).toEqual([])
  } finally {
    await closeFixtureServer(server)
  }
})
