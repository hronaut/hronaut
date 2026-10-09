import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import type { BrowserDownloadState } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

test('attributes similar report downloads to their retained origins without opening or changing them', async ({ appWindow, electronApp }) => {
  const contents = ['synthetic staging report', 'synthetic production report']
  const servers = contents.map((body, index) => createServer((request, response) => {
    if (request.url?.startsWith('/private/report')) {
      response.writeHead(200, {
        'content-disposition': 'attachment; filename="report.csv"',
        'content-type': 'text/csv',
        'content-length': String(Buffer.byteLength(body))
      })
      response.end(body)
      return
    }
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(`<title>Report origin ${index}</title><a href="/private/report?token=synthetic-secret" download>Download report</a>`)
  }))
  try {
    const origins: string[] = []
    for (const [index, server] of servers.entries()) {
      await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Fixture server has no port')
      const origin = `http://127.0.0.1:${address.port}`
      origins.push(origin)
      const url = `${origin}/`
      await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(url)}, active: true })`)
      await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then(state => state.tabs.find(tab => tab.active)?.title)')).toBe(`Report origin ${index}`)
      await electronApp.evaluate(async ({ webContents }, fixtureUrl) => {
        const page = webContents.getAllWebContents().find(contents => contents.getURL() === fixtureUrl)
        if (!page) throw new Error('Fixture page was not found')
        await page.executeJavaScript('document.querySelector("a").click()')
      }, url)
      await expect.poll(async () => {
        const downloads = await appWindow.evaluate('window.hronautDownloads.list()') as BrowserDownloadState[]
        return downloads.find(entry => new URL(entry.url).origin === origin)?.state
      }).toBe('completed')
    }
    const entries = await appWindow.evaluate('window.hronautDownloads.list()') as BrowserDownloadState[]
    const tabsBefore = await appWindow.evaluate('window.hronaut.getState().then(state => state.tabs.map(tab => ({ id: tab.id, active: tab.active })))')
    const panel = appWindow.getByRole('dialog', { name: 'Downloads' })
    await panel.getByRole('searchbox').fill('report')
    const status = panel.getByRole('combobox', { name: 'Filter download status' })
    await status.focus()
    await status.selectOption('completed')
    await expect(panel.getByRole('article')).toHaveCount(2)
    for (const [index, origin] of origins.entries()) {
      const entry = entries.find(item => new URL(item.url).origin === origin)
      expect(entry?.savePath).toBeTruthy()
      const row = panel.getByRole('article').filter({ hasText: entry!.filename })
      await expect(row.locator('.download-origin')).toHaveText(`Download origin: ${origin}`)
      await expect(row.locator('.download-origin')).toHaveAttribute('title', origin)
      expect(await row.innerHTML()).not.toMatch(/private\/report|token=|synthetic-secret/)
      await expect(row.getByRole('link')).toHaveCount(0)
      expect(await readFile(entry!.savePath!, 'utf8')).toBe(contents[index])
    }
    await expect(status).toBeFocused()
    await expect(panel.getByRole('searchbox')).toHaveValue('report')
    expect(await appWindow.evaluate('window.hronaut.getState().then(state => state.tabs.map(tab => ({ id: tab.id, active: tab.active })))')).toEqual(tabsBefore)
    expect(await appWindow.evaluate('window.hronautDownloads.list()')).toEqual(entries)
  } finally { await Promise.all(servers.map(server => closeFixtureServer(server))) }
})
