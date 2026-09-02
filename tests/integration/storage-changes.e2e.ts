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
  const client = new Client({ name: 'storage-changes-test', version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${token}` } }
  }))
  return client
}

test('compares bounded browser storage changes for people and grouped agents', async ({
  appWindow,
  mcpPort,
  mcpToken
}) => {
  const server = createServer((request, response) => {
    if (request.url === '/rotate') {
      response.writeHead(200, {
        'content-type': 'application/json',
        'set-cookie': 'server-auth=server-secret-new; HttpOnly; Path=/'
      })
      response.end('{"rotated":true}')
      return
    }
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'set-cookie': 'server-auth=server-secret-old; HttpOnly; Path=/'
    })
    response.end(`<!doctype html><html><head><title>Storage changes fixture</title></head><body>
      <h1>Storage changes fixture</h1>
      <script>
        localStorage.setItem('theme', 'dark');
        localStorage.setItem('remove-me', 'gone soon');
        sessionStorage.setItem('draft', 'first draft');
        document.cookie = 'client-pref=old-value; Path=/';
        window.mutateStorage = async () => {
          localStorage.setItem('theme', 'light');
          localStorage.setItem('feature-enabled', 'true');
          localStorage.removeItem('remove-me');
          sessionStorage.setItem('draft', 'second draft');
          document.cookie = 'client-pref=new-value; Path=/';
          document.cookie = 'new-cookie=created; Path=/';
          await fetch('/rotate');
          return true;
        };
      </script>
    </body></html>`)
  })
  await new Promise<void>((resolve) => server.listen(0, resolve))
  const address = server.address() as AddressInfo
  const client = await connectClient(mcpPort, mcpToken)
  try {
    const tools = await client.listTools()
    expect(tools.tools.find((tool) => tool.name === 'browser_storage_changes')?.description).toContain('Values are omitted by default')

    const groupResult = await client.callTool({
      name: 'browser_workspaces',
      arguments: { action: 'create', name: 'Storage changes' }
    }) as CallToolResult
    const workspaceId = (JSON.parse(text(groupResult)) as { id: string }).id
    const opened = await client.callTool({
      name: 'browser_new_tab',
      arguments: { workspaceId, url: `http://127.0.0.1:${address.port}/` }
    }) as CallToolResult
    const tabId = (JSON.parse(text(opened)) as { activeTabId: string }).activeTabId
    await client.callTool({ name: 'browser_wait', arguments: { workspaceId, tabId, text: 'Storage changes fixture' } })

    const baseline = await client.callTool({
      name: 'browser_storage_changes',
      arguments: { workspaceId, tabId, action: 'baseline' }
    }) as CallToolResult
    expect(baseline.isError, text(baseline)).not.toBe(true)
    expect(JSON.parse(text(baseline))).toMatchObject({
      tabId,
      status: 'baseline',
      changeCount: 0,
      baselineItemCounts: { 'local-storage': 2, 'session-storage': 1, cookies: 2 },
      valuesIncluded: false
    })
    expect(text(baseline)).not.toContain('server-secret-old')

    const mutated = await client.callTool({
      name: 'browser_evaluate',
      arguments: { workspaceId, tabId, script: 'window.mutateStorage()' }
    }) as CallToolResult
    expect(mutated.isError, text(mutated)).not.toBe(true)
    const compared = await client.callTool({
      name: 'browser_storage_changes',
      arguments: { workspaceId, tabId, action: 'compare' }
    }) as CallToolResult
    expect(compared.isError, text(compared)).not.toBe(true)
    const report = JSON.parse(text(compared)) as {
      changeCount: number
      counts: { added: number; updated: number; removed: number }
      changes: Array<{ kind: string; type: string; key: string; protected?: boolean; beforeValue?: string; afterValue?: string }>
    }
    expect(report).toMatchObject({ changeCount: 7, counts: { added: 2, updated: 4, removed: 1 } })
    expect(report.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'local-storage', type: 'updated', key: 'theme' }),
      expect.objectContaining({ kind: 'local-storage', type: 'added', key: 'feature-enabled' }),
      expect.objectContaining({ kind: 'local-storage', type: 'removed', key: 'remove-me' }),
      expect.objectContaining({ kind: 'session-storage', type: 'updated', key: 'draft' }),
      expect.objectContaining({ kind: 'cookies', type: 'updated', key: 'client-pref' }),
      expect.objectContaining({ kind: 'cookies', type: 'added', key: 'new-cookie' }),
      expect.objectContaining({ kind: 'cookies', type: 'updated', key: 'server-auth', protected: true })
    ]))
    expect(text(compared)).not.toContain('dark')
    expect(text(compared)).not.toContain('light')
    expect(text(compared)).not.toContain('server-secret')

    const values = await client.callTool({
      name: 'browser_storage_changes',
      arguments: { workspaceId, tabId, action: 'get', includeValues: true }
    }) as CallToolResult
    const valueReport = JSON.parse(text(values)) as typeof report
    expect(valueReport.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'theme', beforeValue: 'dark', afterValue: 'light' }),
      expect.objectContaining({ key: 'draft', beforeValue: 'first draft', afterValue: 'second draft' })
    ]))
    const protectedChange = valueReport.changes.find((change) => change.key === 'server-auth')
    expect(protectedChange).not.toHaveProperty('beforeValue')
    expect(protectedChange).not.toHaveProperty('afterValue')
    expect(text(values)).not.toContain('server-secret')

    await client.callTool({
      name: 'browser_storage_changes',
      arguments: { workspaceId, tabId, action: 'clear' }
    })
    await appWindow.getByRole('button', { name: 'Page tools' }).click()
    const pageTools = appWindow.getByRole('dialog', { name: 'Page tools' })
    await pageTools.getByRole('button', { name: 'Site storage for 127.0.0.1' }).click()
    const storagePanel = appWindow.getByRole('dialog', { name: /Site storage/ })
    await storagePanel.getByRole('button', { name: 'Changes' }).click()
    await expect(storagePanel).toContainText('See what browser state changes')
    await storagePanel.getByRole('button', { name: 'Set baseline' }).click()
    await expect(storagePanel).toContainText('Baseline ready')

    await client.callTool({
      name: 'browser_evaluate',
      arguments: { workspaceId, tabId, script: "localStorage.setItem('ui-change', 'ready')" }
    })
    await storagePanel.getByRole('button', { name: 'Compare now' }).click()
    await expect(storagePanel).toContainText('1 storage change')
    await expect(storagePanel).toContainText('ui-change')
    await storagePanel.getByRole('button', { name: 'Copy report' }).click()
    await expect(storagePanel.getByRole('button', { name: 'Copied' })).toBeVisible()
    await storagePanel.getByRole('button', { name: /ui-change/ }).click()
    await expect(storagePanel.getByRole('button', { name: 'Local', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(storagePanel.getByRole('searchbox', { name: 'Filter site storage' })).toHaveValue('ui-change')
    await expect(storagePanel).toContainText('ready')
    await storagePanel.getByRole('button', { name: 'Close site storage' }).click()

    await client.callTool({
      name: 'browser_navigate',
      arguments: { workspaceId, tabId, url: `http://localhost:${address.port}/other` }
    })
    await client.callTool({ name: 'browser_wait', arguments: { workspaceId, tabId, text: 'Storage changes fixture' } })
    const clearedAfterOriginChange = await client.callTool({
      name: 'browser_storage_changes',
      arguments: { workspaceId, tabId, action: 'get' }
    }) as CallToolResult
    expect(JSON.parse(text(clearedAfterOriginChange))).toMatchObject({
      origin: `http://localhost:${address.port}`,
      status: 'empty',
      changeCount: 0
    })
  } finally {
    await client.close()
    await closeFixtureServer(server)
  }
})
