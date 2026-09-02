import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

function text(result: CallToolResult): string {
  const content = result.content.find((item) => item.type === 'text')
  return content?.type === 'text' ? content.text : ''
}

async function connectClient(port: number, token: string): Promise<Client> {
  await expect.poll(async () => {
    try {
      return (await fetch(`http://127.0.0.1:${port}/healthz`, {
        headers: { authorization: `Bearer ${token}` }
      })).ok
    } catch {
      return false
    }
  }).toBe(true)
  const client = new Client({ name: 'pwa-inspection-test', version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${token}` } }
  }))
  return client
}

test('inspects service workers and Cache Storage for people and grouped agents', async ({
  appWindow,
  mcpPort,
  mcpToken
}) => {
  const server = createServer((request, response) => {
    if (request.url?.startsWith('/app.webmanifest')) {
      response.writeHead(200, { 'content-type': 'application/manifest+json' })
      response.end(JSON.stringify({
        id: '/?session=private-id',
        name: 'Offline fixture app',
        short_name: 'Offline fixture',
        start_url: '/?token=private-start',
        scope: '/',
        display: 'standalone',
        icons: [{ src: '/icon.png?api_key=private-icon', sizes: '192x192', type: 'image/png' }]
      }))
      return
    }
    if (request.url?.startsWith('/icon.png')) {
      response.writeHead(200, { 'content-type': 'image/png' })
      response.end()
      return
    }
    if (request.url === '/sw.js') {
      response.writeHead(200, { 'content-type': 'text/javascript', 'service-worker-allowed': '/' })
      response.end("self.addEventListener('fetch', () => {});")
      return
    }
    if (request.url === '/asset.txt') {
      response.writeHead(200, { 'content-type': 'text/plain', 'x-cache-fixture': 'visible' })
      response.end('cached response body must stay private')
      return
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(`<!doctype html><html><head><title>Offline fixture</title><link rel="manifest" href="/app.webmanifest?token=private-manifest"></head><body>
      <h1>Preparing offline app</h1>
      <script>
        (async () => {
          await navigator.serviceWorker.register('/sw.js');
          await navigator.serviceWorker.ready;
          const cache = await caches.open('offline-v1');
          await cache.add('/asset.txt?token=secret-value');
          document.querySelector('h1').textContent = 'Offline app ready';
        })().catch((error) => { document.querySelector('h1').textContent = 'Offline failed: ' + error.message; });
      </script>
    </body></html>`)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address() as AddressInfo
  const client = await connectClient(mcpPort, mcpToken)
  try {
    const groupResult = await client.callTool({
      name: 'browser_workspaces',
      arguments: { action: 'create', name: 'Offline inspection' }
    }) as CallToolResult
    const workspaceId = (JSON.parse(text(groupResult)) as { id: string }).id
    const opened = await client.callTool({
      name: 'browser_new_tab',
      arguments: { workspaceId, url: `http://127.0.0.1:${address.port}/` }
    }) as CallToolResult
    const tabId = (JSON.parse(text(opened)) as { activeTabId: string }).activeTabId
    await client.callTool({ name: 'browser_wait', arguments: { workspaceId, tabId, text: 'Offline app ready' } })

    await appWindow.getByRole('button', { name: 'Lock page input in this tab' }).click()
    let usageReport: {
      usage: number
      quota: number
      available: number
      usagePercent: number
      source: string
      breakdown: Array<{ storageType: string; usage: number }>
      caveats: string[]
    } | undefined
    await expect.poll(async () => {
      const result = await client.callTool({
        name: 'browser_storage_usage',
        arguments: { workspaceId, tabId }
      }) as CallToolResult
      if (result.isError) return 0
      usageReport = JSON.parse(text(result)) as typeof usageReport
      return usageReport?.usage ?? 0
    }).toBeGreaterThan(0)
    expect(usageReport).toMatchObject({
      source: 'chromium-quota'
    })
    expect(usageReport!.quota).toBeGreaterThan(usageReport!.usage)
    expect(usageReport!.available).toBe(usageReport!.quota - usageReport!.usage)
    expect(usageReport!.usagePercent).toBeGreaterThan(0)
    expect(usageReport!.breakdown.some((item) => item.storageType === 'cache_storage')).toBe(true)
    expect(text(await client.callTool({
      name: 'browser_storage_usage',
      arguments: { workspaceId, tabId }
    }) as CallToolResult)).not.toContain('cached response body must stay private')

    const overviewResult = await client.callTool({
      name: 'browser_pwa',
      arguments: { workspaceId, tabId }
    }) as CallToolResult
    expect(overviewResult.isError, text(overviewResult)).not.toBe(true)
    const overview = JSON.parse(text(overviewResult)) as {
      registrations: Array<{ scope: string; active?: { scriptUrl: string } }>
      caches: Array<{ name: string }>
      cacheInspectionAvailable: boolean
      manifestInspectionAvailable: boolean
      manifest?: { name?: string; startUrl?: string; icons: Array<{ url: string }> }
    }
    expect(overview.cacheInspectionAvailable).toBe(true)
    expect(overview.manifestInspectionAvailable).toBe(true)
    expect(overview.manifest).toMatchObject({
      name: 'Offline fixture app',
      startUrl: `http://127.0.0.1:${address.port}/?token=%5BREDACTED%5D`,
      icons: [{ url: `http://127.0.0.1:${address.port}/icon.png?api_key=%5BREDACTED%5D` }]
    })
    expect(overview.registrations).toEqual(expect.arrayContaining([
      expect.objectContaining({ scope: `http://127.0.0.1:${address.port}/` })
    ]))
    expect(overview.caches).toContainEqual({ name: 'offline-v1' })

    const cacheResult = await client.callTool({
      name: 'browser_pwa',
      arguments: { workspaceId, tabId, cacheName: 'offline-v1', query: 'asset.txt' }
    }) as CallToolResult
    const report = JSON.parse(text(cacheResult)) as {
      selectedCache: { entries: Array<{ requestUrl: string; responseStatus: number; requestHeaders?: unknown }> }
    }
    expect(report.selectedCache.entries).toEqual([
      expect.objectContaining({ requestUrl: `http://127.0.0.1:${address.port}/asset.txt?token=%5BREDACTED%5D`, responseStatus: 200 })
    ])
    expect(report.selectedCache.entries[0]).not.toHaveProperty('requestHeaders')
    expect(text(cacheResult)).not.toContain('cached response body must stay private')
    expect(text(cacheResult)).not.toContain('secret-value')

    await appWindow.getByRole('button', { name: 'Page tools' }).click()
    const pageTools = appWindow.getByRole('dialog', { name: 'Page tools' })
    await pageTools.getByRole('button', { name: `Site storage for 127.0.0.1` }).click()
    const storagePanel = appWindow.getByRole('dialog', { name: /Site storage/ })
    await storagePanel.getByRole('button', { name: 'Offline' }).click()
    await expect(storagePanel).toContainText('Offline fixture app')
    await expect(storagePanel).toContainText('standalone')
    await expect(storagePanel).toContainText('offline-v1')
    await expect(storagePanel).toContainText('asset.txt?token=%5BREDACTED%5D')
    await storagePanel.getByRole('button', { name: 'Copy report' }).click()
    await expect(storagePanel.getByRole('button', { name: 'Copied' })).toBeVisible()
    await storagePanel.getByRole('button', { name: 'Overview' }).click()
    await expect(storagePanel).toContainText('Chromium quota detail')
    await expect(storagePanel).toContainText('Cache Storage')
    await expect(storagePanel).toContainText('% used')
    await storagePanel.getByRole('button', { name: 'Copy report' }).click()
    await expect(storagePanel.getByRole('button', { name: 'Copied' })).toBeVisible()
    await appWindow.getByRole('button', { name: 'Unlock page input in this tab' }).click()
    expect(await appWindow.evaluate(`window.hronaut.toggleDevTools(${JSON.stringify(tabId)})`)).toBe(true)
    let fallback: { source: string; usage: number; quota: number; caveats: string[] } | undefined
    await expect.poll(async () => {
      const fallbackResult = await client.callTool({
        name: 'browser_storage_usage',
        arguments: { workspaceId, tabId }
      }) as CallToolResult
      expect(fallbackResult.isError, text(fallbackResult)).not.toBe(true)
      fallback = JSON.parse(text(fallbackResult)) as typeof fallback
      return fallback?.source
    }).toBe('storage-manager')
    expect(fallback!.source).toBe('storage-manager')
    expect(fallback!.usage).toBeGreaterThan(0)
    expect(fallback!.quota).toBeGreaterThan(fallback!.usage)
    expect(fallback!.caveats.join(' ')).toContain('detailed quota breakdown was unavailable')
    expect(await appWindow.evaluate(`window.hronaut.toggleDevTools(${JSON.stringify(tabId)})`)).toBe(false)
  } finally {
    await client.close()
    await closeFixtureServer(server)
  }
})
