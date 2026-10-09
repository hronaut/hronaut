import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import type { BrowserDownloadState } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

test('sorts real downloads by filename while preserving filters, saved files and action targets', async ({ appWindow, electronApp }) => {
  const names = ['report1.txt', 'report2.txt', 'report10.txt']
  const server = createServer((request, response) => {
    const filename = request.url?.slice(1)
    if (filename && names.includes(filename)) {
      response.writeHead(200, {
        'content-disposition': `attachment; filename="${filename}"`,
        'content-type': 'text/plain',
        'content-length': String(Buffer.byteLength(filename))
      })
      response.end(filename)
      return
    }
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<title>Download sorting fixture</title>Download sorting fixture')
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Fixture server has no port')
    const url = `http://127.0.0.1:${address.port}/`
    await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(url)}, active: true })`)
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then(state => state.tabs.find(tab => tab.active)?.title)')).toBe('Download sorting fixture')
    const list = (): Promise<BrowserDownloadState[]> => appWindow.evaluate('window.hronautDownloads.list()')
    for (const filename of names) {
      await electronApp.evaluate(({ webContents }, { url, filename }) => {
        const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)
        if (!page) throw new Error('Fixture page was not found')
        page.downloadURL(`${url}${filename}`)
      }, { url, filename })
      // Establish retained order before starting the next native download.
      await expect.poll(async () => (await list()).find(entry => entry.filename === filename)?.state).toBe('completed')
    }
    const before = await list()
    const panel = appWindow.getByRole('dialog', { name: 'Downloads' })
    const filenames = panel.locator('.download-item strong')
    await expect(filenames).toHaveText([...names].reverse())
    const sort = panel.getByRole('combobox', { name: 'Sort downloads' })
    await sort.focus()
    await sort.selectOption('filename')
    await expect(filenames).toHaveText(names)
    await expect(sort).toBeFocused()
    await panel.getByRole('searchbox').fill('127.0.0.1 report')
    await panel.getByRole('combobox', { name: 'Filter download status' }).selectOption('completed')
    await expect(filenames).toHaveText(names)
    const second = before.find(entry => entry.filename === names[1])!
    await panel.getByRole('button', { name: `Copy saved path for ${names[1]}`, exact: true }).click()
    await expect(panel.getByText('Saved path copied', { exact: true })).toBeVisible()
    expect(await electronApp.evaluate(({ clipboard }) => clipboard.readText())).toBe(second.savePath)
    await sort.selectOption('recent')
    await expect(filenames).toHaveText([...names].reverse())
    expect(await list()).toEqual(before)
    for (const entry of before) expect(await readFile(entry.savePath!, 'utf8')).toBe(entry.filename)
    const bounds = await panel.locator('.downloads-filters').evaluate(element => ({
      width: element.clientWidth, scrollWidth: element.scrollWidth
    }))
    expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.width)
  } finally { await closeFixtureServer(server) }
})
