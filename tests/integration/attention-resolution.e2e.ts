import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, test } from './fixtures.js'
import { useMcpWorkspace } from '../../scripts/mcp-workspace.js'

type MenuProbe = typeof globalThis & { attentionMenu?: Electron.Menu; originalAttentionPopup?: typeof Electron.Menu.prototype.popup }
function parsed(result: CallToolResult): Record<string, unknown> {
  const content = result.content.find(item => item.type === 'text')
  const text = content?.type === 'text' ? content.text : ''
  expect(result.isError, text).not.toBe(true)
  return JSON.parse(text)
}

test('human tab-menu resolution satisfies concurrent exact-request MCP waits after acknowledgement', async ({ appWindow, electronApp, mcpPort, mcpToken }) => {
  const client = new Client({ name: 'attention-resolution', version: '1.0.0' })
  await expect.poll(async () => {
    try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`, { headers: { authorization: `Bearer ${mcpToken}` } })).ok } catch { return false }
  }).toBe(true)
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), { requestInit: { headers: { authorization: `Bearer ${mcpToken}` } } }))
  await electronApp.evaluate(({ Menu }) => {
    const scope = globalThis as MenuProbe
    scope.originalAttentionPopup = Menu.prototype.popup
    Menu.prototype.popup = function (): void { scope.attentionMenu = this }
  })
  try {
    const workspaceId = await useMcpWorkspace(client, 'Attention resolution', false)
    const created = parsed(await client.callTool({ name: 'browser_new_tab', arguments: { workspaceId, url: 'data:text/html,<title>Resolve attention</title><main>Manual task</main>', active: true } }) as CallToolResult)
    const tabId = (created.tabs as Array<{ id: string }>)[0]!.id
    await appWindow.evaluate(`Promise.all([window.hronaut.setTabPinned(${JSON.stringify(tabId)}, true), window.hronaut.setTabMuted(${JSON.stringify(tabId)}, true), window.hronaut.setTabHumanInteractionLocked(${JSON.stringify(tabId)}, true)])`)
    const request = parsed(await client.callTool({ name: 'browser_request_user_attention', arguments: { workspaceId, tabId, reason: 'Complete the manual task.' } }) as CallToolResult)
    // Real chrome right-click acknowledges the alert before the native menu opens.
    await appWindow.getByRole('tab', { name: /^Resolve attention/ }).click({ button: 'right' })
    await expect.poll(() => electronApp.evaluate(() => (globalThis as MenuProbe).attentionMenu?.getMenuItemById('resolve-attention')?.label)).toBe('Mark as resolved')
    const status = parsed(await client.callTool({ name: 'browser_user_attention', arguments: { workspaceId, requestId: request.id } }) as CallToolResult)
    expect(status.state).toBe('acknowledged')
    const timeout = parsed(await client.callTool({ name: 'browser_user_attention', arguments: { workspaceId, requestId: request.id, action: 'wait', timeoutMs: 10 } }) as CallToolResult)
    expect(timeout.outcome).toBe('timed-out')
    const waits = [1, 2].map(() => client.callTool({ name: 'browser_user_attention', arguments: { workspaceId, requestId: request.id, action: 'wait', timeoutMs: 5000 } }))
    await electronApp.evaluate(() => {
      const item = (globalThis as MenuProbe).attentionMenu!.getMenuItemById('resolve-attention')!
      ;(item.click as unknown as () => void)()
      ;(item.click as unknown as () => void)()
    })
    for (const result of await Promise.all(waits)) expect(parsed(result as CallToolResult).outcome).toBe('resolved')
    expect(parsed(await client.callTool({ name: 'browser_user_attention', arguments: { workspaceId, requestId: request.id, action: 'wait' } }) as CallToolResult).outcome).toBe('resolved')
    expect(await appWindow.evaluate('window.hronaut.getUserAttention()')).toBeNull()
    expect(await appWindow.evaluate(`window.hronaut.getState().then(state => { const tab = state.tabs.find(tab => tab.id === ${JSON.stringify(tabId)}); return { pinned: tab.pinned, muted: tab.muted, locked: tab.humanInteractionLocked } })`)).toEqual({ pinned: true, muted: true, locked: true })
    await appWindow.evaluate(`window.hronaut.showTabContextMenu(${JSON.stringify(tabId)})`)
    expect(await electronApp.evaluate(() => !!(globalThis as MenuProbe).attentionMenu?.getMenuItemById('resolve-attention'))).toBe(false)
  } finally {
    await electronApp.evaluate(({ Menu }) => {
      const scope = globalThis as MenuProbe
      if (scope.originalAttentionPopup) Menu.prototype.popup = scope.originalAttentionPopup
      delete scope.originalAttentionPopup; delete scope.attentionMenu
    })
    await client.close()
  }
})

test('stale menu cannot resolve a newer request or a closed target', async ({ appWindow, electronApp, mcpPort, mcpToken }) => {
  const client = new Client({ name: 'attention-stale-menu', version: '1.0.0' })
  await expect.poll(async () => {
    try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`, { headers: { authorization: `Bearer ${mcpToken}` } })).ok } catch { return false }
  }).toBe(true)
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), { requestInit: { headers: { authorization: `Bearer ${mcpToken}` } } }))
  await electronApp.evaluate(({ Menu }) => {
    const scope = globalThis as MenuProbe; scope.originalAttentionPopup = Menu.prototype.popup
    Menu.prototype.popup = function (): void { scope.attentionMenu = this }
  })
  try {
    const workspaceId = await useMcpWorkspace(client, 'Attention identity', false)
    const created = parsed(await client.callTool({ name: 'browser_new_tab', arguments: { workspaceId, url: 'data:text/html,<title>Exact attention target</title><main>Task</main>' } }) as CallToolResult)
    const tabId = (created.tabs as Array<{ id: string }>)[0]!.id
    const request = async () => parsed(await client.callTool({ name: 'browser_request_user_attention', arguments: { workspaceId, tabId, reason: 'Manual task.' } }) as CallToolResult)
    const older = await request()
    const olderWait = client.callTool({ name: 'browser_user_attention', arguments: { workspaceId, requestId: older.id, action: 'wait', timeoutMs: 5000 } })
    await appWindow.evaluate(`window.hronaut.showTabContextMenu(${JSON.stringify(tabId)})`)
    const newer = await request()
    await electronApp.evaluate(() => { const item = (globalThis as MenuProbe).attentionMenu!.getMenuItemById('resolve-attention')!; (item.click as unknown as () => void)() })
    expect(parsed(await olderWait as CallToolResult).outcome).toBe('superseded')
    expect(parsed(await client.callTool({ name: 'browser_user_attention', arguments: { workspaceId, requestId: newer.id } }) as CallToolResult).state).toBe('pending')
    await appWindow.evaluate(`window.hronaut.showTabContextMenu(${JSON.stringify(tabId)})`)
    await appWindow.evaluate(`window.hronaut.closeTab(${JSON.stringify(tabId)})`)
    await electronApp.evaluate(() => { const item = (globalThis as MenuProbe).attentionMenu!.getMenuItemById('resolve-attention')!; (item.click as unknown as () => void)() })
    expect(parsed(await client.callTool({ name: 'browser_user_attention', arguments: { workspaceId, requestId: newer.id, action: 'wait' } }) as CallToolResult).outcome).toBe('target-closed')
    const replacement = parsed(await client.callTool({ name: 'browser_new_tab', arguments: { workspaceId, url: 'data:text/html,<main>Replacement</main>' } }) as CallToolResult)
    const replacementId = (replacement.tabs as Array<{ id: string }>)[0]!.id
    const finalRequest = parsed(await client.callTool({ name: 'browser_request_user_attention', arguments: { workspaceId, tabId: replacementId, reason: 'Manual task.' } }) as CallToolResult)
    await appWindow.evaluate(`window.hronaut.showTabContextMenu(${JSON.stringify(replacementId)})`)
    await appWindow.evaluate(`window.hronaut.closeWorkspace(${JSON.stringify(workspaceId)})`)
    await electronApp.evaluate(() => { const item = (globalThis as MenuProbe).attentionMenu!.getMenuItemById('resolve-attention')!; (item.click as unknown as () => void)() })
    expect((await client.callTool({ name: 'browser_user_attention', arguments: { workspaceId, requestId: finalRequest.id, action: 'wait' } }) as CallToolResult).isError).toBe(true)

  } finally {
    await electronApp.evaluate(({ Menu }) => {
      const scope = globalThis as MenuProbe
      if (scope.originalAttentionPopup) Menu.prototype.popup = scope.originalAttentionPopup
      delete scope.originalAttentionPopup; delete scope.attentionMenu
    })
    await client.close()
  }
})
