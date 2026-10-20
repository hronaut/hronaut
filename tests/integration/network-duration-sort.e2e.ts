import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { BrowserNetworkRequest } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

function text(result: CallToolResult): string {
  const content = result.content.find((item) => item.type === 'text')
  return content?.type === 'text' ? content.text : ''
}

test('sorts a request that failed after a while by how long it took, for agents and in the Network panel', async ({
  appWindow,
  mcpPort,
  mcpToken
}) => {
  // A request that failed has no resource timing, so sorting by duration put it after every other request, while its
  // row showed how long it took.
  const server = createServer((request, response) => {
    if (request.url === '/slow-failure') {
      setTimeout(() => request.socket.destroy(), 1_200)
      return
    }
    if (request.url === '/slow') {
      setTimeout(() => response.end('slow'), 400)
      return
    }
    if (request.url === '/fast') {
      response.end('fast')
      return
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end('<!doctype html><title>Duration sort fixture</title><h1>Duration sort fixture</h1>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  await expect.poll(async () => {
    try {
      return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`, { headers: { authorization: `Bearer ${mcpToken}` } })).ok
    } catch {
      return false
    }
  }).toBe(true)
  const client = new Client({ name: 'network-duration-sort-test', version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${mcpToken}` } }
  }))
  try {
    const call = async (name: string, args: Record<string, unknown>): Promise<unknown> => {
      const result = await client.callTool({ name, arguments: args }) as CallToolResult
      expect(result.isError, text(result)).not.toBe(true)
      return JSON.parse(text(result)) as unknown
    }
    const { id: workspaceId } = await call('browser_workspaces', { action: 'create', name: 'Duration sort' }) as { id: string }
    const { activeTabId: tabId } = await call('browser_new_tab', { workspaceId, url: `http://127.0.0.1:${address.port}/` }) as { activeTabId: string }
    const waited = await client.callTool({ name: 'browser_wait', arguments: { workspaceId, tabId } }) as CallToolResult
    expect(waited.isError, text(waited)).not.toBe(true)
    await appWindow.evaluate(`window.hronaut.selectTab(${JSON.stringify(tabId)})`)
    await call('browser_network', { workspaceId, tabId })
    await call('browser_evaluate', {
      workspaceId,
      tabId,
      script: "Promise.allSettled(['/slow-failure', '/slow', '/fast'].map((path) => fetch(path).then((response) => response.text()))).then(() => true)"
    })
    const byDuration = async (): Promise<BrowserNetworkRequest[]> => (await call('browser_network', {
      workspaceId, tabId, query: 'resource-type:fetch', sortBy: 'duration', sortDirection: 'desc'
    }) as BrowserNetworkRequest[])
    await expect.poll(async () => (await byDuration()).filter((request) => request.completedAt).length).toBe(3)
    const sorted = await byDuration()
    const failure = sorted.find((request) => request.url.endsWith('/slow-failure'))
    expect(failure?.error).toBeTruthy()
    expect(failure?.durationMs).toBeUndefined()
    expect(sorted.map((request) => new URL(request.url).pathname)).toEqual(['/slow-failure', '/slow', '/fast'])

    await appWindow.getByRole('button', { name: 'Page tools' }).click()
    await appWindow.getByRole('dialog', { name: 'Page tools' }).getByRole('button', { name: 'Open network monitor' }).click()
    const panel = appWindow.getByRole('dialog', { name: 'Network', exact: true })
    await panel.getByRole('searchbox', { name: 'Filter network requests', exact: true }).fill('resource-type:fetch')
    await panel.getByRole('combobox', { name: 'Sort network requests', exact: true }).selectOption('duration')
    // Sorting by duration starts with the longest.
    await expect(panel.getByRole('button', { name: 'Sort network requests descending', exact: true })).toBeVisible()
    const rows = panel.getByRole('listbox', { name: 'Network requests' }).getByRole('option')
    await expect(rows).toHaveCount(3)
    await expect(rows.first()).toHaveAttribute('data-request-id', failure!.id)
  } finally {
    await client.close()
    await closeFixtureServer(server)
  }
})
