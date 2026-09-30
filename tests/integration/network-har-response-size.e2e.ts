import { gzipSync } from 'node:zlib'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { BrowserNetworkHar } from '../../src/shared/types.js'
import { expect, test, text } from './capability-fixtures.js'

test('exports compressed response body and decoded content bytes without reading bodies', async ({ capabilities }) => {
  const { client, tabId } = capabilities
  const monitoring = await client.callTool({ name: 'browser_network', arguments: { tabId } }) as CallToolResult
  expect(monitoring.isError, text(monitoring)).not.toBe(true)
  const fetched = await client.callTool({
    name: 'browser_evaluate',
    arguments: { tabId, script: "fetch('/gzip-size-fixture').then(response => response.text()).then(text => text.length)" }
  }) as CallToolResult
  expect(fetched.isError, text(fetched)).not.toBe(true)
  expect(text(fetched)).toBe('2000')
  const completed = await client.callTool({
    name: 'browser_network_wait',
    arguments: { tabId, urlPattern: '*gzip-size-fixture', phase: 'complete' }
  }) as CallToolResult
  expect(completed.isError, text(completed)).not.toBe(true)
  const result = await client.callTool({
    name: 'browser_network_har', arguments: { tabId, query: 'gzip-size-fixture', includeBodies: false }
  }) as CallToolResult
  expect(result.isError, text(result)).not.toBe(true)
  const har = JSON.parse(text(result)) as BrowserNetworkHar
  expect(har.log.entries).toHaveLength(1)
  expect(har.log.entries[0]?.response.bodySize).toBe(gzipSync('😀'.repeat(1_000)).length)
  expect(har.log.entries[0]?.response.content.size).toBe(4_000)
  expect(har.log.entries[0]?.response.content.text).toBeUndefined()
})
