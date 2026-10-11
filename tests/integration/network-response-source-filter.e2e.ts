import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { BrowserNetworkHar, BrowserNetworkRequest } from '../../src/shared/types.js'
import { expect, test, text } from './capability-fixtures.js'

test('filters observed response sources consistently in MCP, Network and copied HAR', async ({ capabilities, appWindow, electronApp }) => {
  const { client, tabId, openPageTool } = capabilities
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: { tabId, ...args } }) as CallToolResult
    expect(result.isError, text(result)).not.toBe(true)
    return JSON.parse(text(result)) as unknown
  }
  const list = async (query: string) => await call('browser_network', { query }) as BrowserNetworkRequest[]
  await call('browser_evaluate', { script: `(async () => {
    await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    return true;
  })()` })
  await call('browser_history', { action: 'reload' })
  const waited = await client.callTool({ name: 'browser_wait', arguments: { tabId } }) as CallToolResult
  expect(waited.isError, text(waited)).not.toBe(true)
  await list('')
  expect(await call('browser_evaluate', { script: `(async () => {
    await fetch('/wait-probe?response-source:service-worker').then(response => response.text());
    await fetch('/sw-probe').then(response => response.text());
    return navigator.serviceWorker.controller !== null;
  })()` })).toBe(true)
  await expect.poll(async () => (await list('url:/sw-probe')).some(request => request.completedAt && request.responseSource === 'service-worker')).toBe(true)
  const network = await list('url:/wait-probe')
  expect(network).toHaveLength(1)
  expect(network[0]!.responseSource).toBe('network')
  const workers = await list('response-source:service-worker')
  expect(workers).toHaveLength(1)
  expect(workers[0]!.url).toContain('/sw-probe')
  expect((await list('url:/wait-probe RESPONSE-SOURCE:"NETWORK"')).map(request => request.id)).toEqual(network.map(request => request.id))
  expect((await list('-response-source:service-worker')).map(request => request.id)).not.toContain(workers[0]!.id)
  expect(await list('-response-source:unknown')).toEqual([])
  const har = await call('browser_network_har', { query: 'response-source:service-worker', includeBodies: false }) as BrowserNetworkHar
  expect(har.log.entries).toHaveLength(1)
  expect(har.log.entries[0]!.request.url).toBe(workers[0]!.url)
  await openPageTool('Open network monitor')
  const panel = appWindow.getByRole('dialog', { name: 'Network', exact: true })
  const filter = panel.getByRole('searchbox', { name: 'Filter network requests', exact: true })
  const rows = panel.getByRole('listbox', { name: 'Network requests' }).getByRole('option')
  await filter.fill('response-source:service-worker')
  await expect(rows).toHaveCount(1)
  await expect(panel.locator(`[data-request-id="${workers[0]!.id}"]`)).toBeVisible()
  await panel.getByRole('button', { name: 'Copy sanitized HAR', exact: true }).click()
  await expect.poll(async () => {
    try { return (JSON.parse(await electronApp.evaluate(({ clipboard }) => clipboard.readText())) as BrowserNetworkHar).log.entries.map(entry => entry.request.url) } catch { return [] }
  }).toEqual([workers[0]!.url])
  await filter.fill('url:/wait-probe -response-source:service-worker')
  await expect(rows).toHaveCount(1)
  await expect(panel.locator(`[data-request-id="${network[0]!.id}"]`)).toBeVisible()
  await filter.fill('-response-source:unknown')
  await expect(rows).toHaveCount(0)
})
