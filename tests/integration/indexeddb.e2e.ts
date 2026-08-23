import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, test } from './fixtures.js'

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
  const client = new Client({ name: 'indexeddb-test', version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${token}` } }
  }))
  return client
}

test('inspects bounded IndexedDB schema and records for people and grouped agents', async ({
  appWindow,
  mcpPort,
  mcpToken
}) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(`<!doctype html><html><head><title>IndexedDB fixture</title></head><body>
      <h1>Preparing IndexedDB</h1>
      <script>
        const request = indexedDB.open('app-cache', 3);
        request.onupgradeneeded = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains('settings')) {
            const settings = database.createObjectStore('settings', { keyPath: 'id' });
            settings.createIndex('by-category', 'category');
          }
          if (!database.objectStoreNames.contains('events')) database.createObjectStore('events', { autoIncrement: true });
        };
        request.onerror = () => { document.querySelector('h1').textContent = 'IndexedDB failed'; };
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction(['settings', 'events'], 'readwrite');
          const settings = transaction.objectStore('settings');
          settings.put({ id: 'language', category: 'display', value: 'en-CA' });
          settings.put({ id: 'theme', category: 'display', value: 'dark' });
          settings.put({ id: 'token', category: 'private', value: 'private-token-value' });
          const events = transaction.objectStore('events');
          events.add({ type: 'opened', at: 1 });
          events.add({ type: 'clicked', at: 2 });
          transaction.oncomplete = () => {
            document.querySelector('h1').textContent = 'IndexedDB ready';
            database.close();
          };
        };
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
      arguments: { action: 'create', name: 'IndexedDB inspection' }
    }) as CallToolResult
    const workspaceId = (JSON.parse(text(groupResult)) as { id: string }).id
    const opened = await client.callTool({
      name: 'browser_new_tab',
      arguments: { workspaceId, url: `http://127.0.0.1:${address.port}/` }
    }) as CallToolResult
    const tabId = (JSON.parse(text(opened)) as { activeTabId: string }).activeTabId
    await client.callTool({ name: 'browser_wait', arguments: { workspaceId, tabId, text: 'IndexedDB ready' } })

    const databasesResult = await client.callTool({
      name: 'browser_indexeddb',
      arguments: { workspaceId, tabId }
    }) as CallToolResult
    expect(databasesResult.isError, text(databasesResult)).not.toBe(true)
    expect(JSON.parse(text(databasesResult))).toMatchObject({
      tabId,
      databases: [{ name: 'app-cache', version: 3 }],
      entries: [],
      valuesIncluded: false
    })

    const schemaResult = await client.callTool({
      name: 'browser_indexeddb',
      arguments: { workspaceId, tabId, database: 'app-cache' }
    }) as CallToolResult
    const schema = JSON.parse(text(schemaResult)) as {
      selectedDatabase: { objectStores: Array<{ name: string; entryCount: number; indexes: Array<{ name: string }> }> }
    }
    expect(schema.selectedDatabase.objectStores).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'events', entryCount: 2 }),
      expect.objectContaining({ name: 'settings', entryCount: 3, indexes: [expect.objectContaining({ name: 'by-category' })] })
    ]))

    await appWindow.getByRole('button', { name: 'Lock page input in this tab' }).click()
    const recordsResult = await client.callTool({
      name: 'browser_indexeddb',
      arguments: { workspaceId, tabId, database: 'app-cache', objectStore: 'settings', limit: 1 }
    }) as CallToolResult
    const records = JSON.parse(text(recordsResult)) as {
      entries: Array<{ key: string; valueType: string; valuePreview?: string }>
      hasMore: boolean
    }
    expect(records.entries).toHaveLength(1)
    expect(records.entries[0]).not.toHaveProperty('valuePreview')
    expect(records.hasMore).toBe(true)
    expect(text(recordsResult)).not.toContain('private-token-value')

    const valuesResult = await client.callTool({
      name: 'browser_indexeddb',
      arguments: { workspaceId, tabId, database: 'app-cache', objectStore: 'settings', limit: 3, includeValues: true }
    }) as CallToolResult
    const values = JSON.parse(text(valuesResult)) as {
      entries: Array<{ key: string; valuePreview: string }>
      caveats: string[]
    }
    expect(values.entries.some((entry) => entry.key.includes('theme') && entry.valuePreview.includes('dark'))).toBe(true)
    expect(text(valuesResult)).toContain('private-token-value')
    expect(values.caveats.join(' ')).toContain('private application data')

    await appWindow.getByRole('button', { name: 'Page tools' }).click()
    const pageTools = appWindow.getByRole('dialog', { name: 'Page tools' })
    await pageTools.getByRole('button', { name: 'Site storage for 127.0.0.1' }).click()
    const storagePanel = appWindow.getByRole('dialog', { name: /Site storage/ })
    await storagePanel.getByRole('button', { name: 'IndexedDB' }).click()
    await expect(storagePanel.getByRole('combobox', { name: 'IndexedDB database' })).toHaveValue('app-cache')
    await storagePanel.getByRole('combobox', { name: 'IndexedDB object store' }).selectOption('settings')
    await expect(storagePanel).toContainText('3 records')
    await expect(storagePanel).toContainText('theme')
    await storagePanel.getByRole('searchbox', { name: 'Filter IndexedDB records' }).fill('theme')
    await expect(storagePanel).toContainText('dark')
    await storagePanel.getByRole('button', { name: 'Copy loaded' }).click()
    await expect(storagePanel.getByRole('button', { name: 'Copied' })).toBeVisible()
  } finally {
    await client.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
