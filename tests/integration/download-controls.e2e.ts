import { createServer } from 'node:http'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { BrowserDownloadState } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

const payload = Buffer.alloc(2 * 1024 * 1024, 'download-control-fixture\n')
const offset = 256 * 1024
const validators = { etag: '"download-controls"', 'last-modified': 'Wed, 23 Sep 2026 12:00:00 GMT' }

function resultText(result: CallToolResult): string {
  const content = result.content.find(item => item.type === 'text')
  return content?.type === 'text' ? content.text : ''
}

for (const ranges of [true, false]) {
  test(`resumes an interrupted download when the server ${ranges ? 'supports' : 'ignores'} ranges`, async ({ appWindow, electronApp, profileDirectory }) => {
    const requests: string[] = []
    const server = createServer((request, response) => {
      requests.push(request.headers.range ?? '')
      const start = ranges ? Number(/^bytes=(\d+)-/.exec(request.headers.range ?? '')?.[1] ?? 0) : 0
      response.writeHead(start ? 206 : 200, {
        'content-type': 'application/octet-stream',
        'content-length': payload.length - start,
        ...(ranges ? { ...validators, 'accept-ranges': 'bytes' } : {}),
        ...(start ? { 'content-range': `bytes ${start}-${payload.length - 1}/${payload.length}` } : {})
      })
      response.end(payload.subarray(start))
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Missing download server')
      const url = `http://127.0.0.1:${address.port}/partial.bin`
      const pageUrl = 'data:text/html,<title>Resume fixture</title>'
      const path = join(profileDirectory, 'partial.bin')
      await writeFile(path, payload.subarray(0, offset))
      await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(pageUrl)}, active: true })`)
      await expect.poll(() => electronApp.evaluate(({ webContents }, url) =>
        webContents.getAllWebContents().some(contents => contents.getURL() === url), pageUrl
      )).toBe(true)
      await electronApp.evaluate(({ webContents }, args) => {
        const page = webContents.getAllWebContents().find(contents => contents.getURL() === args.pageUrl)
        if (!page) throw new Error('Missing fixture page')
        page.session.createInterruptedDownload({
          path: args.path, urlChain: [args.url], offset: args.offset, length: args.length,
          mimeType: 'application/octet-stream', eTag: args.etag, lastModified: args.lastModified
        })
      }, { pageUrl, path, url, offset, length: payload.length, etag: validators.etag, lastModified: validators['last-modified'] })
      const [entry] = await appWindow.evaluate('window.hronautDownloads.list()') as BrowserDownloadState[]
      expect(entry).toMatchObject({ state: 'interrupted', canResume: true })
      await appWindow.evaluate(`window.hronautDownloads.resume(${JSON.stringify(entry!.id)})`)
      await expect.poll(() => appWindow.evaluate('window.hronautDownloads.list()')).toEqual([
        expect.objectContaining({ state: 'completed', canResume: false, receivedBytes: payload.length })
      ])
      const [finished] = await appWindow.evaluate('window.hronautDownloads.list()') as BrowserDownloadState[]
      expect(await readFile(finished!.savePath!)).toEqual(payload)
      expect(requests).toContain(`bytes=${offset}-`)
    } finally {
      await closeFixtureServer(server)
    }
  })
}

test('pauses through the panel, resumes through MCP, isolates workspaces, and cancels a paused transfer', async ({ appWindow, electronApp, mcpPort, mcpToken }, testInfo) => {
  let release = false
  const server = createServer((request, response) => {
    if (request.url !== '/file.bin') {
      response.end('<title>Download controls</title><a id="download" href="/file.bin" download>Download</a>')
      return
    }
    response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="file.bin"', 'content-length': payload.length, ...validators, 'accept-ranges': 'bytes' })
    response.write(payload.subarray(0, offset))
    const timer = setInterval(() => {
      if (!release) return
      clearInterval(timer)
      response.end(payload.subarray(offset))
    }, 20)
    response.once('close', () => clearInterval(timer))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const client = new Client({ name: 'download-controls', version: '1.0.0' })
  async function call(name: string, args: Record<string, unknown>) {
    const result = await client.callTool({ name, arguments: args }) as CallToolResult
    expect(result.isError, resultText(result)).not.toBe(true)
    const text = resultText(result)
    return text.startsWith('{') || text.startsWith('[') ? JSON.parse(text) : text
  }
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), { requestInit: { headers: { authorization: `Bearer ${mcpToken}` } } }))
    const workspace = await call('browser_workspaces', { action: 'create', name: 'Download controls' })
    const other = await call('browser_workspaces', { action: 'create', name: 'Other downloads' })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing server')
    const opened = await call('browser_new_tab', { workspaceId: workspace.id, url: `http://127.0.0.1:${address.port}/`, active: true })
    const target = { workspaceId: workspace.id, tabId: opened.activeTabId, selector: '#download' }
    await call('browser_wait', target)
    await call('browser_click', target)
    await expect.poll(async () => (await appWindow.evaluate('window.hronautDownloads.list()') as BrowserDownloadState[])[0]?.receivedBytes).toBeGreaterThan(0)
    const [entry] = await appWindow.evaluate('window.hronautDownloads.list()') as BrowserDownloadState[]
    await appWindow.getByRole('button', { name: 'Pause file.bin', exact: true }).click()
    await expect(appWindow.getByRole('button', { name: 'Resume file.bin', exact: true })).toBeVisible()
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(760, 520))
    const panel = appWindow.getByRole('dialog', { name: 'Downloads', exact: true })
    await expect(panel).toBeVisible()
    expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await appWindow.screenshot({ path: testInfo.outputPath('paused-download.png') })
    expect(await call('browser_downloads', { workspaceId: workspace.id })).toEqual([expect.objectContaining({ id: entry!.id, paused: true, canResume: true })])
    for (const action of ['pause', 'resume']) {
      const denied = await client.callTool({ name: 'browser_downloads', arguments: { workspaceId: other.id, action, downloadId: entry!.id } }) as CallToolResult
      expect(denied.isError).toBe(true)
      expect(resultText(denied)).toContain('Active download not found')
    }
    expect(await call('browser_downloads', { workspaceId: workspace.id, action: 'clear' })).toHaveLength(1)
    await call('browser_downloads', { workspaceId: workspace.id, action: 'resume', downloadId: entry!.id })
    release = true
    await expect.poll(() => call('browser_downloads', { workspaceId: workspace.id })).toEqual([expect.objectContaining({ id: entry!.id, state: 'completed', paused: false, canResume: false })])
    release = false
    await call('browser_click', target)
    await expect.poll(async () => (await call('browser_downloads', { workspaceId: workspace.id }) as BrowserDownloadState[]).find(item => item.state === 'progressing')?.receivedBytes).toBeGreaterThan(0)
    const current = (await call('browser_downloads', { workspaceId: workspace.id }) as BrowserDownloadState[]).find(item => item.state === 'progressing')!
    await call('browser_downloads', { workspaceId: workspace.id, action: 'pause', downloadId: current.id })
    await appWindow.evaluate(`window.hronautDownloads.cancel(${JSON.stringify(current.id)})`)
    await expect.poll(() => call('browser_downloads', { workspaceId: workspace.id })).toEqual(expect.arrayContaining([expect.objectContaining({ id: current.id, state: 'cancelled', paused: false, canResume: false })]))
  } finally {
    await client.close()
    await closeFixtureServer(server)
  }
})
