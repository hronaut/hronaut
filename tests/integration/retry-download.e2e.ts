import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { Page } from '@playwright/test'
import type { BrowserDownloadState, HronautApi, HronautDownloadsApi } from '../../src/shared/types.js'
import { closeFixtureServer, closeHronaut, expect, launchHronaut, test } from './fixtures.js'

const payload = Buffer.alloc(512 * 1024, 'retry-download-fixture\n')

function resultText(result: CallToolResult): string {
  const content = result.content.find(item => item.type === 'text')
  return content?.type === 'text' ? content.text : ''
}

/**
 * A site whose page sets a sign-in cookie and whose `/file.bin` stalls on its first request, so it can be cancelled,
 * and answers every later one in full. Each download request's cookie header is recorded.
 */
async function retryServer() {
  const fileCookies: string[] = []
  const handler = (request: IncomingMessage, response: ServerResponse) => {
    if (!request.url?.startsWith('/file.bin')) {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'set-cookie': 'retry-sign-in=kept; Max-Age=3600; Path=/' })
        .end('<title>Retry downloads</title><a id="download" href="/file.bin?part=1" download>Download</a>')
      return
    }
    fileCookies.push(request.headers.cookie ?? '')
    response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="file.bin"', 'content-length': payload.length })
    if (fileCookies.length === 1) response.write(payload.subarray(0, 1024))
    else response.end(payload)
  }
  const server = createServer(handler)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  return { server, fileCookies, origin: `http://127.0.0.1:${address.port}` }
}

test('Retry downloads a cancelled download again in its workspace, from the panel and through MCP, as Chrome', async ({ appWindow, mcpPort, mcpToken }) => {
  const { server, fileCookies, origin } = await retryServer()
  const client = new Client({ name: 'retry-download', version: '1.0.0' })
  async function call(name: string, args: Record<string, unknown>) {
    const result = await client.callTool({ name, arguments: args }) as CallToolResult
    expect(result.isError, resultText(result)).not.toBe(true)
    const text = resultText(result)
    return text.startsWith('{') || text.startsWith('[') ? JSON.parse(text) : text
  }
  try {
    // The shell and token file can be ready before the HTTP listener starts.
    await expect.poll(async () => {
      try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`)).ok } catch { return false }
    }).toBe(true)
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), { requestInit: { headers: { authorization: `Bearer ${mcpToken}` } } }))
    const workspace = await call('browser_workspaces', { action: 'create', name: 'Retry downloads' })
    const other = await call('browser_workspaces', { action: 'create', name: 'Other downloads' })
    const opened = await call('browser_new_tab', { workspaceId: workspace.id, url: `${origin}/`, active: true })
    const target = { workspaceId: workspace.id, tabId: opened.activeTabId, selector: '#download' }
    await call('browser_wait', target)
    await call('browser_click', target)
    const list = async () => await call('browser_downloads', { workspaceId: workspace.id }) as BrowserDownloadState[]
    await expect.poll(async () => (await list())[0]?.receivedBytes).toBeGreaterThan(0)
    const [first] = await list()
    const panel = appWindow.getByRole('dialog', { name: 'Downloads', exact: true })
    await expect(panel).toBeVisible()
    await panel.getByRole('button', { name: 'Cancel file.bin', exact: true }).click()
    await expect.poll(list).toEqual([expect.objectContaining({ id: first!.id, state: 'cancelled', canRetry: true })])

    await panel.getByRole('button', { name: 'Retry file.bin', exact: true }).click()
    await expect.poll(async () => (await list()).filter(({ state }) => state === 'completed').length, { timeout: 15_000 }).toBe(1)
    const downloads = await list()
    const again = downloads.find(({ id }) => id !== first!.id)!
    // A new row with the whole file, downloaded with the workspace's own cookies; the cancelled row stays.
    expect(downloads).toHaveLength(2)
    expect(downloads.find(({ id }) => id === first!.id)).toMatchObject({ state: 'cancelled', canRetry: true })
    expect(again).toMatchObject({ url: `${origin}/file.bin?part=1`, state: 'completed', receivedBytes: payload.length })
    expect(again.canRetry).toBeUndefined()
    expect(await readFile(again.savePath!)).toEqual(payload)
    expect(fileCookies).toEqual(['retry-sign-in=kept', 'retry-sign-in=kept'])

    // An agent of another workspace cannot retry it; its own agent can.
    const denied = await client.callTool({ name: 'browser_downloads', arguments: { workspaceId: other.id, action: 'retry', downloadId: first!.id } }) as CallToolResult
    expect(denied.isError).toBe(true)
    expect(resultText(denied)).toContain('Download cannot be retried')
    await call('browser_downloads', { workspaceId: workspace.id, action: 'retry', downloadId: first!.id })
    await expect.poll(async () => (await list()).filter(({ state }) => state === 'completed').length, { timeout: 15_000 }).toBe(2)
    expect(await call('browser_downloads', { workspaceId: other.id })).toEqual([])
    expect(fileCookies).toHaveLength(3)
  } finally {
    await client.close()
    await closeFixtureServer(server)
  }
})

test('a download cancelled before a restart can still be retried after it, as Chrome', async ({ profileDirectory, mcpPort }) => {
  const { server, fileCookies, origin } = await retryServer()
  const list = (window: Page) => window.evaluate(() => (window as unknown as { hronautDownloads: HronautDownloadsApi }).hronautDownloads.list())
  let before: Awaited<ReturnType<typeof launchHronaut>> | undefined
  let after: Awaited<ReturnType<typeof launchHronaut>> | undefined
  try {
    before = await launchHronaut(profileDirectory, mcpPort)
    await before.window.evaluate((url) => (window as unknown as { hronaut: HronautApi }).hronaut.newTab({ url, active: true }), `${origin}/`)
    await expect.poll(() => before!.app.evaluate(({ webContents }, url) => webContents.getAllWebContents().some((page) => page.getURL() === url), `${origin}/`)).toBe(true)
    await before.app.evaluate(({ webContents }, args) => {
      webContents.getAllWebContents().find((page) => page.getURL() === args.page)!.downloadURL(args.url)
    }, { page: `${origin}/`, url: `${origin}/file.bin?part=1` })
    await expect.poll(async () => (await list(before!.window))[0]?.receivedBytes).toBeGreaterThan(0)
    const [first] = await list(before.window) as [BrowserDownloadState]
    await before.window.evaluate((id) => (window as unknown as { hronautDownloads: HronautDownloadsApi }).hronautDownloads.cancel(id), first.id)
    await expect.poll(async () => (await list(before!.window))[0]).toMatchObject({ id: first.id, state: 'cancelled', canRetry: true })
    await closeHronaut(before.app)
    before = undefined

    after = await launchHronaut(profileDirectory, mcpPort)
    expect(await list(after.window)).toEqual([expect.objectContaining({ id: first.id, state: 'cancelled', fromEarlierRun: true, canRetry: true })])
    await after.window.locator('.downloads-button').click()
    const panel = after.window.getByRole('dialog', { name: 'Downloads', exact: true })
    await panel.getByRole('button', { name: 'Retry file.bin', exact: true }).click()
    await expect.poll(async () => (await list(after!.window)).find(({ id }) => id !== first.id)?.state, { timeout: 15_000 }).toBe('completed')
    const again = (await list(after.window)).find(({ id }) => id !== first.id)!
    expect(await readFile(again.savePath!)).toEqual(payload)
    // The workspace's cookie, kept on disk across the restart, went with it.
    expect(fileCookies).toEqual(['retry-sign-in=kept', 'retry-sign-in=kept'])
  } finally {
    if (before) await closeHronaut(before.app)
    if (after) await closeHronaut(after.app)
    await closeFixtureServer(server)
  }
})
