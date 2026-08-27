import { readFile } from 'node:fs/promises'
import { createServer, type ServerResponse } from 'node:http'
import { basename } from 'node:path'
import { expect, test } from './fixtures.js'

test('keeps simultaneous same-named website downloads in distinct files', async ({
  appWindow,
  electronApp
}) => {
  const pending: Array<{ body: string; response: ServerResponse }> = []
  const server = createServer((request, response) => {
    if (request.url === '/first' || request.url === '/second') {
      const body = request.url.slice(1)
      response.writeHead(200, {
        'content-disposition': 'attachment; filename="parallel.txt"',
        'content-length': String(body.length),
        'content-type': 'text/plain'
      })
      response.flushHeaders()
      pending.push({ body, response })
      if (pending.length === 2) {
        setTimeout(() => {
          for (const download of pending.splice(0)) download.response.end(download.body)
        }, 100)
      }
      return
    }
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(`<!doctype html>
      <title>Parallel download fixture</title>
      <a id="first" href="/first" download>First</a>
      <a id="second" href="/second" download>Second</a>`)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Parallel download fixture did not expose a port')
    const url = `http://127.0.0.1:${address.port}/`
    await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(url)}, active: true })`)
    await expect.poll(() => appWindow.evaluate(
      'window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.title)'
    )).toBe('Parallel download fixture')

    await electronApp.evaluate(async ({ webContents }, pageUrl) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL() === pageUrl)
      if (!page) throw new Error('Parallel download fixture web contents was not found')
      await page.executeJavaScript(`(() => {
        document.querySelector('#first').click();
        document.querySelector('#second').click();
      })()`)
    }, url)

    await expect.poll(async () => {
      const current = await appWindow.evaluate('window.hronautDownloads.list()') as Array<{
        filename: string
        savePath: string
        state: string
      }>
      return current.length === 2 && current.every((download) => download.state === 'completed') ? current : []
    }).toHaveLength(2)

    const completed = await appWindow.evaluate('window.hronautDownloads.list()') as Array<{
      filename: string
      savePath: string
      state: string
    }>
    expect(new Set(completed.map((download) => download.savePath))).toHaveProperty('size', 2)
    expect(completed.map((download) => basename(download.savePath)).sort()).toEqual([
      'parallel (1).txt',
      'parallel.txt'
    ])
    await expect(Promise.all(completed.map((download) => readFile(download.savePath, 'utf8'))))
      .resolves.toEqual(expect.arrayContaining(['first', 'second']))
  } finally {
    for (const download of pending.splice(0)) download.response.destroy()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
