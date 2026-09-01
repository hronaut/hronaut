import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { useMcpWorkspace } from '../../scripts/mcp-workspace.js'
import { expect, test } from './fixtures.js'

function text(result: CallToolResult): string {
  const content = result.content.find((item) => item.type === 'text')
  return content?.type === 'text' ? content.text : ''
}

test('rejects local file navigation from an agent workspace', async ({
  electronApp: _electronApp,
  mcpToken,
  mcpPort,
  profileDirectory
}) => {
  const sentinel = 'HRONAUT_LOCAL_FILE_MUST_NOT_REACH_AGENT_TABS'
  const localPath = join(profileDirectory, 'agent-navigation-secret.txt')
  await writeFile(localPath, sentinel, 'utf8')

  const authorization = `Bearer ${mcpToken}`
  const client = new Client({ name: 'hronaut-navigation-security-test', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
    requestInit: { headers: { authorization } }
  })

  try {
    await expect.poll(async () => {
      try {
        return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`, { headers: { authorization } })).ok
      } catch {
        return false
      }
    }).toBe(true)
    await client.connect(transport)
    await useMcpWorkspace(client, 'Navigation security')

    const before = await client.callTool({ name: 'browser_tabs', arguments: {} }) as CallToolResult
    const beforeTabs = JSON.parse(text(before)) as Array<{ id: string; url: string }>
    const blankTabId = beforeTabs[0]!.id
    const localUrl = new URL(`file://${localPath}`).href
    const attempted = await client.callTool({
      name: 'browser_new_tab',
      arguments: { url: localUrl, active: true }
    }) as CallToolResult

    expect(attempted.isError).toBe(true)
    expect(text(attempted)).toContain('Agent workspaces cannot open local or privileged browser URLs')
    expect(text(attempted)).not.toContain(localPath)
    expect(text(attempted)).not.toContain(sentinel)

    const navigated = await client.callTool({
      name: 'browser_navigate',
      arguments: { tabId: blankTabId, url: localUrl }
    }) as CallToolResult
    expect(navigated.isError).toBe(true)
    expect(text(navigated)).toContain('Agent workspaces cannot open local or privileged browser URLs')
    expect(text(navigated)).not.toContain(localPath)

    const privileged = await client.callTool({
      name: 'browser_navigate',
      arguments: { tabId: blankTabId, url: 'chrome://version' }
    }) as CallToolResult
    expect(privileged.isError).toBe(true)
    expect(text(privileged)).toContain('Agent workspaces cannot open local or privileged browser URLs')

    const pageNavigation = await client.callTool({
      name: 'browser_evaluate',
      arguments: {
        tabId: blankTabId,
        script: `location.href = ${JSON.stringify(localUrl)}; 'attempted'`
      }
    }) as CallToolResult
    expect(pageNavigation.isError, text(pageNavigation)).not.toBe(true)
    expect(text(pageNavigation)).toBe('attempted')

    const popup = await client.callTool({
      name: 'browser_evaluate',
      arguments: {
        tabId: blankTabId,
        script: `window.open(${JSON.stringify(localUrl)}, '_blank'); 'attempted'`
      }
    }) as CallToolResult
    expect(popup.isError, text(popup)).not.toBe(true)

    const after = await client.callTool({ name: 'browser_tabs', arguments: {} }) as CallToolResult
    expect(JSON.parse(text(after))).toEqual(beforeTabs)
  } finally {
    await client.close().catch(() => undefined)
  }
})
