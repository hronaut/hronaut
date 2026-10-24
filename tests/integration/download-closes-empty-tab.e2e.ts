import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import type { BrowserDownloadState } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

type Press = { button: 'left' | 'middle' }

test('closes the tab a link opened when it turns out to be a download, as Chrome, and keeps a tab that showed a page', async ({ appWindow, electronApp }) => {
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://fixture').pathname
    if (path.startsWith('/report')) {
      response.writeHead(200, { 'content-type': 'text/csv', 'content-disposition': `attachment; filename="${path.slice(1)}.csv"` })
      response.end(`synthetic ${path.slice(1)}\n`)
      return
    }
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(`<!doctype html><title>Page ${path}</title><p><a id="front" href="/report-front" target="_blank">Front</a> <a id="behind" href="/report-behind">Behind</a> <a id="page" href="/second" target="_blank">Second</a> <a id="save" href="/report-saved" download>Save</a></p>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const origin = `http://127.0.0.1:${address.port}`
  try {
    const created = await appWindow.evaluate(`window.hronaut.createWorkspace({ name: 'Reports', storage: 'scratch' })`) as { mcpTabGroups: Array<{ id: string, name: string }> }
    const workspace = created.mcpTabGroups.find(group => group.name === 'Reports')!.id
    await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(`${origin}/app`)}, mcpGroupId: ${JSON.stringify(workspace)}, active: true })`)
    type State = { tabs: Array<{ url: string, title: string, active: boolean, mcpGroupId?: string }>, closedTabs: Array<{ url: string }> }
    const state = () => appWindow.evaluate(`window.hronaut.getState()`) as Promise<State>
    // The workspace's own first tab, about:blank, is left out.
    const order = async () => (await state()).tabs.filter(tab => tab.mcpGroupId === workspace && tab.url.startsWith(origin))
      .map(tab => `${new URL(tab.url).pathname}${tab.active ? '*' : ''}`)
    const downloaded = async (name: string) => {
      const downloads = await appWindow.evaluate('window.hronautDownloads.list()') as BrowserDownloadState[]
      const download = downloads.find(entry => entry.filename === `${name}.csv`)
      return download?.state === 'completed' ? readFile(download.savePath!, 'utf8') : download?.state
    }
    const press = (path: string, selector: string, input: Press) => electronApp.evaluate(async ({ webContents }, { url, selector, input }) => {
      const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)
      if (!page) throw new Error(`${url} web contents was not found`)
      const point = await page.executeJavaScript(`(() => {
        const bounds = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect()
        return { x: Math.round(bounds.x + bounds.width / 2), y: Math.round(bounds.y + bounds.height / 2) }
      })()`)
      page.focus()
      page.sendInputEvent({ type: 'mouseDown', clickCount: 1, ...input, ...point })
      page.sendInputEvent({ type: 'mouseUp', clickCount: 1, ...input, ...point })
    }, { url: `${origin}${path}`, selector, input })
    await expect.poll(async () => (await state()).tabs.find(tab => tab.active)?.title).toBe('Page /app')

    // A target="_blank" link to a file left an empty tab in front of the page.
    await press('/app', '#front', { button: 'left' })
    await expect.poll(() => downloaded('report-front')).toBe('synthetic report-front\n')
    await expect.poll(order).toEqual(['/app*'])
    // A tab opened behind with a middle-click closes too, and the page stays in front.
    await press('/app', '#behind', { button: 'middle' })
    await expect.poll(() => downloaded('report-behind')).toBe('synthetic report-behind\n')
    await expect.poll(order).toEqual(['/app*'])
    // Reopening them would only download the files again.
    expect((await state()).closedTabs.map(tab => new URL(tab.url).pathname)).not.toContain('/report-front')
    expect((await state()).closedTabs.map(tab => new URL(tab.url).pathname)).not.toContain('/report-behind')

    // A tab that showed a page keeps it when the page downloads a file.
    await press('/app', '#page', { button: 'left' })
    await expect.poll(async () => (await state()).tabs.find(tab => tab.active)?.title).toBe('Page /second')
    await press('/second', '#save', { button: 'left' })
    await expect.poll(() => downloaded('report-saved')).toBe('synthetic report-saved\n')
    await appWindow.waitForTimeout(500)
    expect(await order()).toEqual(['/app', '/second*'])
  } finally {
    await closeFixtureServer(server)
  }
})
