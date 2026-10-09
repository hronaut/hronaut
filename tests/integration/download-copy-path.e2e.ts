import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import type { BrowserDownloadState } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

test('copies a completed download saved path without changing the file, filters, or tabs', async ({ appWindow, electronApp }) => {
  const filename = 'copy path fixture.txt'
  const contents = 'synthetic saved-path clipboard fixture'
  const server = createServer((request, response) => {
    if (request.url === '/file') {
      response.writeHead(200, {
        'content-disposition': `attachment; filename="${filename}"`,
        'content-type': 'text/plain',
        'content-length': String(Buffer.byteLength(contents))
      })
      response.end(contents)
      return
    }
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<title>Saved path fixture</title><a href="/file" download>Download</a>')
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
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then(state => state.tabs.find(tab => tab.active)?.title)')).toBe('Saved path fixture')
    await electronApp.evaluate(async ({ webContents }, fixtureUrl) => {
      const page = webContents.getAllWebContents().find(contents => contents.getURL() === fixtureUrl)
      if (!page) throw new Error('Fixture page was not found')
      await page.executeJavaScript('document.querySelector("a").click()')
    }, url)
    const list = (): Promise<BrowserDownloadState[]> => appWindow.evaluate('window.hronautDownloads.list()')
    await expect.poll(async () => (await list()).find(entry => entry.filename === filename)?.state).toBe('completed')
    const savedPath = (await list()).find(entry => entry.filename === filename)?.savePath
    expect(savedPath).toBeTruthy()
    expect(await readFile(savedPath!, 'utf8')).toBe(contents)
    const panel = appWindow.getByRole('dialog', { name: 'Downloads' })
    const search = panel.getByRole('searchbox')
    const filter = panel.getByRole('combobox', { name: 'Filter download status' })
    await search.fill('copy path')
    await filter.selectOption('completed')
    const tabsBefore = await appWindow.evaluate('window.hronaut.getState().then(state => state.tabs.map(tab => ({ id: tab.id, active: tab.active })))')
    const copy = panel.getByRole('button', { name: `Copy saved path for ${filename}`, exact: true })
    await copy.focus()
    await appWindow.keyboard.press('Enter')
    await expect(panel.getByText('Saved path copied', { exact: true })).toBeVisible()
    expect(await electronApp.evaluate(({ clipboard }) => clipboard.readText())).toBe(savedPath)
    await expect(copy).toBeFocused()
    await expect(search).toHaveValue('copy path')
    await expect(filter).toHaveValue('completed')
    expect(await readFile(savedPath!, 'utf8')).toBe(contents)
    expect(await appWindow.evaluate('window.hronaut.getState().then(state => state.tabs.map(tab => ({ id: tab.id, active: tab.active })))')).toEqual(tabsBefore)
  } finally { await closeFixtureServer(server) }
})
