import { createServer } from 'node:http'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { BrowserNetworkHar, BrowserNetworkRequest } from '../../src/shared/types.js'
import { closeFixtureServer } from './fixtures.js'
import { expect, test, text } from './capability-fixtures.js'

test('filters status families consistently in MCP, Network and copied HAR', async ({ capabilities, appWindow, electronApp }) => {
  const { client, tabId, openPageTool } = capabilities
  const server = createServer((request, response) => {
    const status = Number(request.url?.split('/').at(-1))
    response.writeHead([200, 404, 429, 500, 503].includes(status) ? status : 404, {
      'content-type': 'text/plain', 'access-control-allow-origin': '*'
    })
    response.end('Status family fixture')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No fixture port')
  const origin = `http://127.0.0.1:${address.port}`
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: { tabId, ...args } }) as CallToolResult
    expect(result.isError, text(result)).not.toBe(true)
    return JSON.parse(text(result)) as unknown
  }
  const list = async (query: string) => await call('browser_network', { query }) as BrowserNetworkRequest[]
  const prefix = 'url:status-family-fixture'
  try {
    await list(prefix)
    await call('browser_evaluate', { script: `Promise.all([200,404,429,500,503].map(status => fetch(${JSON.stringify(origin)} + '/status-family-fixture/' + status).then(response => response.text()))).then(() => true)` })
    await expect.poll(async () => (await list(prefix)).filter(request => request.completedAt).length).toBe(5)
    const clients = await list(`${prefix} status-code:4xx`)
    expect(clients.map(request => request.status).sort()).toEqual([404, 429])
    expect((await list(`${prefix} -status-code:2xx -status-code:4xx`)).map(request => request.status).sort()).toEqual([500, 503])
    expect(await list(`${prefix} -status-code:6xx`)).toEqual([])
    const har = await call('browser_network_har', { query: `${prefix} status-code:5XX`, includeBodies: false }) as BrowserNetworkHar
    expect(har.log.entries.map(entry => entry.response.status).sort()).toEqual([500, 503])
    await openPageTool('Open network monitor')
    const panel = appWindow.getByRole('dialog', { name: 'Network', exact: true })
    await panel.getByRole('searchbox', { name: 'Filter network requests', exact: true }).fill(`${prefix} status-code:4xx`)
    const rows = panel.getByRole('listbox', { name: 'Network requests' }).getByRole('option')
    await expect(rows).toHaveCount(2)
    for (const request of clients) await expect(panel.locator(`[data-request-id="${request.id}"]`)).toBeVisible()
    await panel.getByRole('button', { name: 'Copy sanitized HAR', exact: true }).click()
    await expect.poll(async () => {
      const clipboard = await electronApp.evaluate(({ clipboard }) => clipboard.readText())
      try { return (JSON.parse(clipboard) as BrowserNetworkHar).log.entries.map(entry => entry.response.status).sort() } catch { return [] }
    }).toEqual([404, 429])
  } finally { await closeFixtureServer(server) }
})
