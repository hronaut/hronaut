import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, test, text } from './capability-fixtures.js'
import type { BrowserState } from '../../src/shared/types.js'

test('resumes only a selected tab during global pause and keeps Live/Frozen independent', async ({ capabilities, appWindow, mcpPort, mcpToken }) => {
  const { client, tabId, fixtureOrigin } = capabilities
  const opened = await client.callTool({ name: 'browser_new_tab', arguments: { url: fixtureOrigin, active: false } }) as CallToolResult
  expect(opened.isError, text(opened)).not.toBe(true)
  const state = await appWindow.evaluate('window.hronaut.getState()') as BrowserState
  const workspaceId = state.tabs.find(tab => tab.id === tabId)!.mcpGroupId!
  const other = state.tabs.find(tab => tab.mcpGroupId === workspaceId && tab.id !== tabId)!
  const ownership = await client.callTool({ name: 'browser_workspaces', arguments: { action: 'list' } }) as CallToolResult
  // Existing ownership is retained by the client; global pause clears its write lease.
  expect(ownership.isError).not.toBe(true)
  await appWindow.evaluate(`window.hronaut.selectTab(${JSON.stringify(tabId)})`)
  const pause = appWindow.getByRole('button', { name: 'Pause agents for this tab', exact: true })
  await pause.click()
  const blocked = await client.callTool({ name: 'browser_snapshot', arguments: { tabId } }) as CallToolResult
  expect(blocked.isError).toBe(true)
  expect(text(blocked)).toContain('paused')
  await appWindow.evaluate('window.hronautMcp.setPaused(true)')
  await appWindow.getByRole('button', { name: 'Resume agents for this tab', exact: true }).click()
  expect(await appWindow.evaluate('window.hronautMcp.getState().then(s => s.paused)')).toBe(true)
  const snapshot = await client.callTool({ name: 'browser_snapshot', arguments: { tabId } }) as CallToolResult
  expect(snapshot.isError, text(snapshot)).not.toBe(true)
  await pause.click()
  await expect(client.callTool({ name: 'browser_snapshot', arguments: { tabId } })).rejects.toThrow(/503/)
  await appWindow.getByRole('button', { name: 'Resume agents for this tab', exact: true }).click()
  const userCreated = await appWindow.evaluate(`window.hronaut.newTab({mcpGroupId:${JSON.stringify(workspaceId)},active:false})`) as BrowserState
  expect(userCreated.tabs.find(tab => !state.tabs.some(previous => previous.id === tab.id))?.agentPaused).toBe(true)
  const denied = await client.callTool({ name: 'browser_snapshot', arguments: { tabId: other.id } }) as CallToolResult
  expect(denied.isError).toBe(true)
  const newTab = await client.callTool({ name: 'browser_new_tab', arguments: { url: fixtureOrigin } }) as CallToolResult
  expect(newTab.isError).toBe(true)
  const claim = await client.callTool({ name: 'browser_workspaces', arguments: { action: 'claim-ownership', workspaceId } }) as CallToolResult
  expect(claim.isError, text(claim)).not.toBe(true)
  const navigate = await client.callTool({ name: 'browser_navigate', arguments: { tabId, url: `${fixtureOrigin}/?agent-control=allowed` } }) as CallToolResult
  expect(navigate.isError, text(navigate)).not.toBe(true)
  await appWindow.getByRole('button', { name: 'Freeze this live page for deterministic review' }).click()
  await expect(appWindow.getByRole('button', { name: 'Resume this frozen page' })).toBeVisible()
  await expect(pause).toBeVisible()
  await appWindow.getByRole('button', { name: 'Resume this frozen page' }).click()
  await expect(appWindow.getByRole('button', { name: 'Freeze this live page for deterministic review' })).toBeVisible()
  await appWindow.evaluate('window.hronautMcp.setPaused(true)')
  await expect(appWindow.getByRole('button', { name: 'Resume agents for this tab', exact: true })).toBeVisible()
  await expect(client.callTool({ name: 'browser_snapshot', arguments: { tabId } })).rejects.toThrow(/503/)
  await appWindow.evaluate('window.hronautMcp.setPaused(false)')
  // The saved per-tab pause from before the global override is restored.
  await expect(appWindow.getByRole('button', { name: 'Resume agents for this tab', exact: true })).toBeVisible()
  const stillPaused = await client.callTool({ name: 'browser_snapshot', arguments: { tabId } }) as CallToolResult
  expect(stillPaused.isError).toBe(true)
  await appWindow.getByRole('button', { name: 'Resume agents for this tab', exact: true }).click()
  await appWindow.evaluate('window.hronautMcp.setPaused(true)')
  await appWindow.getByRole('button', { name: 'Resume agents for this tab', exact: true }).click()
  const reconnected = new Client({ name: 'paused-tab-reconnect', version: '1' })
  try {
    await reconnected.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${mcpToken}` } }
    }))
    expect((await reconnected.listTools()).tools.length).toBeGreaterThan(0)
    const unauthorized = await reconnected.callTool({ name: 'browser_snapshot', arguments: { workspaceId, tabId } }) as CallToolResult
    expect(unauthorized.isError).toBe(true)
    expect(text(unauthorized)).toContain('not authorized')
  } finally {
    await reconnected.close()
    await appWindow.evaluate('window.hronautMcp.setPaused(false)')
  }
})
