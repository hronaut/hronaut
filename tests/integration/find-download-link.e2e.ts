import { createServer } from 'node:http'
import type { BrowserDownloadState, HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

// A link that starts a download, or that the server answers with no content, keeps the page, and Chrome keeps Find open
// over it. Hronaut closed Find as soon as such a link started loading, so the person lost the matches they were on.

const PAGE = `<!doctype html><title>Releases</title>
<p>needle one <a id="file" href="/release.csv">Download</a></p>
<p>needle two <a id="empty" href="/empty">Mark as read</a></p>`

test('keeps Find open over a page whose link starts a download or gets no content', async ({ appWindow, electronApp }) => {
  const requested: string[] = []
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://fixture').pathname
    requested.push(path)
    if (path === '/release.csv') {
      response.writeHead(200, { 'content-type': 'text/csv', 'content-disposition': 'attachment; filename="release.csv"' })
      response.end('synthetic release\n')
    } else if (path === '/empty') {
      response.writeHead(204).end()
    } else {
      response.writeHead(200, { 'content-type': 'text/html' }).end(PAGE)
    }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const url = `http://127.0.0.1:${address.port}/releases`
  const activeTab = async () => (
    (await appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState())).tabs.find(tab => tab.active)
  )
  const follow = (selector: string) => electronApp.evaluate(async ({ webContents }, { url, selector }) => {
    const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)
    if (!page) throw new Error(`${url} web contents was not found`)
    await page.executeJavaScript(`document.querySelector(${JSON.stringify(selector)}).click()`)
  }, { url, selector })
  try {
    await appWindow.evaluate(url => (window as unknown as { hronaut: HronautApi }).hronaut.newTab({ url, active: true }), url)
    await expect.poll(async () => (await activeTab())?.loading).toBe(false)
    await appWindow.getByRole('button', { name: 'Find in page', exact: true }).click()
    const bar = appWindow.getByRole('search', { name: 'Find in page' })
    const search = bar.getByRole('searchbox', { name: 'Find text' })
    await search.fill('needle')
    await expect(bar.locator('.find-count')).toHaveText('1 / 2')

    await follow('#file')
    await expect.poll(async () => {
      const downloads = await appWindow.evaluate('window.hronautDownloads.list()') as BrowserDownloadState[]
      return downloads.find(download => download.filename === 'release.csv')?.state
    }).toBe('completed')
    await expect(bar).toBeVisible()
    await expect(bar.locator('.find-count')).toHaveText('1 / 2')
    await search.press('Enter')
    await expect(bar.locator('.find-count')).toHaveText('2 / 2')

    await follow('#empty')
    await expect.poll(() => requested.includes('/empty')).toBe(true)
    await expect.poll(async () => (await activeTab())?.loading).toBe(false)
    await expect(bar).toBeVisible()
    await expect(bar.locator('.find-count')).toHaveText('2 / 2')
    await search.press('Enter')
    await expect(bar.locator('.find-count')).toHaveText('1 / 2')
    expect((await activeTab())?.url).toBe(url)
  } finally {
    await closeFixtureServer(server)
  }
})
