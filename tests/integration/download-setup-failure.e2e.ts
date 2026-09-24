import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { basename } from 'node:path'
import type { BrowserDownloadState } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

test('contains native destination setup failures and permits a subsequent download', async ({ appWindow, electronApp }) => {
  const server = createServer((request, response) => {
    if (request.url === '/file') {
      response.writeHead(200, { 'content-type': 'text/plain', 'content-disposition': 'attachment; filename="recovery.txt"' })
      response.end('download recovery')
    } else {
      response.writeHead(200, { 'content-type': 'text/html' })
      response.end('<title>Download setup failure</title>')
    }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing fixture server')
    const url = `http://127.0.0.1:${address.port}/`
    await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(url)}, active: true })`)
    await expect.poll(() => electronApp.evaluate(({ webContents }, pageUrl) =>
      webContents.getAllWebContents().some(contents => contents.getURL() === pageUrl), url
    )).toBe(true)
    await electronApp.evaluate(({ webContents }, pageUrl) => {
      const page = webContents.getAllWebContents().find(contents => contents.getURL() === pageUrl)
      if (!page) throw new Error('Missing fixture page')
      page.session.prependOnceListener('will-download', (_event, item) => {
        item.setSavePath = () => { throw new Error('Injected native destination failure') }
      })
      page.downloadURL(`${pageUrl}file`)
    }, url)
    await expect.poll(() => appWindow.evaluate('window.hronautDownloads.list()')).toEqual([
      expect.objectContaining({ state: 'interrupted', failureReason: 'destination-unavailable', completedAt: expect.any(String), canResume: false })
    ])
    await expect(appWindow.getByText('Could not prepare download destination', { exact: true })).toBeVisible()
    expect(await appWindow.evaluate('window.hronautDownloads.clearFinished()')).toEqual([])
    await electronApp.evaluate(({ webContents }, pageUrl) => {
      const page = webContents.getAllWebContents().find(contents => contents.getURL() === pageUrl)
      if (!page) throw new Error('Missing fixture page')
      page.downloadURL(`${pageUrl}file`)
    }, url)
    await expect.poll(() => appWindow.evaluate('window.hronautDownloads.list()')).toEqual([
      expect.objectContaining({ state: 'completed', filename: 'recovery.txt' })
    ])
    const [entry] = await appWindow.evaluate('window.hronautDownloads.list()') as BrowserDownloadState[]
    expect(basename(entry!.savePath!)).toBe('recovery.txt')
    expect(await readFile(entry!.savePath!, 'utf8')).toBe('download recovery')
  } finally {
    await closeFixtureServer(server)
  }
})
