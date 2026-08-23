import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { useMcpWorkspace } from './mcp-workspace.js'

interface BrowserStateResult {
  activeTabId: string | null
}

const endpoint = new URL(process.env.HRONAUT_MCP_URL || 'http://127.0.0.1:47812/mcp')
const token = process.env.HRONAUT_MCP_TOKEN
const client = new Client({ name: 'hronaut-smoke', version: '1.0.0' })
const transport = new StreamableHTTPClientTransport(endpoint, {
  ...(token ? { requestInit: { headers: { authorization: `Bearer ${token}` } } } : {})
})

function text(result: CallToolResult): string {
  const content = result.content.find((item) => item.type === 'text')
  return content?.type === 'text' ? content.text : ''
}

function fail(message: string): never {
  throw new Error(message)
}

await client.connect(transport)
try {
  await useMcpWorkspace(client, 'MCP smoke')
  const tools = await client.listTools()
  const requiredTools = ['browser_workspaces', 'browser_status', 'browser_new_tab', 'browser_snapshot', 'browser_element_inspect', 'browser_dialog', 'browser_emulate', 'browser_storage', 'browser_memory', 'browser_debug_report', 'browser_network_wait', 'browser_network_search', 'browser_type', 'browser_screenshot']
  for (const name of requiredTools) {
    if (!tools.tools.some((tool) => tool.name === name)) fail(`Missing MCP tool: ${name}`)
  }

  const page = encodeURIComponent(
    '<!doctype html><title>Hronaut MCP Smoke</title><h1>Hronaut MCP Smoke</h1><label>Name <input aria-label="Name"></label><button onclick="document.querySelector(\'h1\').textContent=\'Smoke passed\'">Run</button><script>console.error(\'hronaut-packaged-debug-marker\')</script>'
  )
  const opened = await client.callTool({
    name: 'browser_new_tab',
    arguments: { url: `data:text/html;charset=utf-8,${page}`, active: true }
  }) as CallToolResult
  if (opened.isError) fail(text(opened))
  const state = JSON.parse(text(opened)) as BrowserStateResult
  const tabId = state.activeTabId
  if (!tabId) fail('No active tab returned by browser_new_tab')

  const snapshot = await client.callTool({ name: 'browser_snapshot', arguments: { tabId } }) as CallToolResult
  const snapshotText = text(snapshot)
  if (!snapshotText.includes('Hronaut MCP Smoke') || !snapshotText.includes('[e1]')) {
    fail(`Unexpected snapshot: ${snapshotText.slice(0, 500)}`)
  }

  const typed = await client.callTool({
    name: 'browser_type',
    arguments: { tabId, ref: 'e1', text: 'persistent-profile-check' }
  }) as CallToolResult
  if (typed.isError) fail(text(typed))

  const screenshot = await client.callTool({ name: 'browser_screenshot', arguments: { tabId } }) as CallToolResult
  const image = screenshot.content.find((item) => item.type === 'image')
  if (image?.type !== 'image' || !image.data || image.mimeType !== 'image/png') {
    fail('browser_screenshot did not return a PNG image')
  }

  const debugReport = await client.callTool({
    name: 'browser_debug_report',
    arguments: { tabId, maxConsoleMessages: 5, maxNetworkRequests: 5 }
  }) as CallToolResult
  if (debugReport.isError || !text(debugReport).includes('hronaut-packaged-debug-marker')) {
    fail(`Unexpected debug report: ${text(debugReport).slice(0, 500)}`)
  }

  const closed = await client.callTool({ name: 'browser_close_tab', arguments: { tabId } }) as CallToolResult
  if (closed.isError) fail(text(closed))

  console.log(`MCP smoke passed: ${tools.tools.length} tools, semantic snapshot, typing, debug report, and PNG screenshot.`)
} finally {
  await client.close()
}
