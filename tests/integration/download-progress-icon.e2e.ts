import { createServer } from 'node:http'
import type { BrowserDownloadState } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

const payload = Buffer.alloc(2 * 1024 * 1024, 'download-progress-icon\n')
const offset = 256 * 1024

type IconCall = ['progress', number] | ['badge', number]

test('shows the downloads under way and how far they have come on the launcher icon, as Chrome', async ({ appWindow, electronApp }) => {
  // Hronaut's taskbar button, Dock icon and launcher icon showed nothing while a download was under way.
  let release = false
  const server = createServer((request, response) => {
    const known = request.url === '/known.bin'
    response.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-disposition': `attachment; filename="${known ? 'known' : 'unknown'}.bin"`,
      ...(known ? { 'content-length': payload.length } : {})
    })
    response.write(payload.subarray(0, offset))
    const timer = setInterval(() => {
      if (!release) return
      clearInterval(timer)
      response.end(payload.subarray(offset))
    }, 20)
    response.once('close', () => clearInterval(timer))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing download server')
    await electronApp.evaluate(({ app, BrowserWindow }) => {
      const main = BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'Hronaut')!
      const calls: IconCall[] = []
      Object.assign(globalThis, { downloadIconCalls: calls })
      const setProgressBar = main.setProgressBar.bind(main)
      main.setProgressBar = (progress, options) => { calls.push(['progress', progress]); setProgressBar(progress, options) }
      const setBadgeCount = app.setBadgeCount.bind(app)
      app.setBadgeCount = (count) => { calls.push(['badge', count ?? 0]); return setBadgeCount(count) }
    })
    const last = (kind: IconCall[0]) => electronApp.evaluate((_electron, kind) => (globalThis as unknown as { downloadIconCalls: IconCall[] })
      .downloadIconCalls.filter((call) => call[0] === kind).at(-1)?.[1], kind)
    const pageUrl = 'data:text/html,<title>Download progress fixture</title>'
    await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(pageUrl)}, active: true })`)
    await expect.poll(() => electronApp.evaluate(({ webContents }, url) =>
      webContents.getAllWebContents().some((contents) => contents.getURL() === url), pageUrl)).toBe(true)
    const download = (url: string) => electronApp.evaluate(({ webContents }, { pageUrl, url }) => {
      webContents.getAllWebContents().find((contents) => contents.getURL() === pageUrl)!.downloadURL(url)
    }, { pageUrl, url })

    await download(`http://127.0.0.1:${address.port}/known.bin`)
    await expect.poll(() => last('progress')).toBe(offset / payload.length)
    expect(await last('badge')).toBe(1)
    // A download of unknown size counts, but only those of known size tell how far they have come.
    await download(`http://127.0.0.1:${address.port}/unknown.bin`)
    await expect.poll(() => last('badge')).toBe(2)
    await expect.poll(async () => (await appWindow.evaluate('window.hronautDownloads.list()') as BrowserDownloadState[])
      .find((entry) => entry.filename === 'unknown.bin')?.receivedBytes).toBe(offset)
    expect(await last('progress')).toBe(offset / payload.length)

    release = true
    await expect.poll(async () => (await appWindow.evaluate('window.hronautDownloads.list()') as BrowserDownloadState[])
      .map((entry) => entry.state)).toEqual(['completed', 'completed'])
    await expect.poll(() => last('badge')).toBe(0)
    expect(await last('progress')).toBe(-1)
  } finally {
    release = true
    await closeFixtureServer(server)
  }
})
