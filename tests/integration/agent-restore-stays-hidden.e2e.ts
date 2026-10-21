import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { HronautApi } from '../../src/shared/types.js'
import { expect, test } from './fixtures.js'

// An agent opening its archived workspace with browser_saved_workspaces showed it in the window, ending the person's
// split view, although an agent's other calls leave the window as it is.

const text = (result: CallToolResult) => result.content.map((part) => part.type === 'text' ? part.text : '').join('')

async function connectClient(port: number, token: string): Promise<Client> {
  await expect.poll(async () => {
    try {
      return (await fetch(`http://127.0.0.1:${port}/healthz`, { headers: { authorization: `Bearer ${token}` } })).ok
    } catch {
      return false
    }
  }).toBe(true)
  const client = new Client({ name: 'agent-restore-stays-hidden', version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${token}` } }
  }))
  return client
}

async function call(client: Client, name: string, args: Record<string, unknown>): Promise<string> {
  const result = await client.callTool({ name, arguments: args }) as CallToolResult
  expect(result.isError, text(result)).not.toBe(true)
  return text(result)
}

test('leaves the person\'s split view alone when an agent opens its archived workspace', async ({ appWindow, mcpPort, mcpToken }) => {
  const person = await appWindow.evaluate(async () => {
    const api = (window as unknown as { hronaut: HronautApi }).hronaut
    const state = await api.createWorkspace({ name: 'Banking', storage: 'scratch' })
    const id = state.mcpTabGroups.find(group => group.name === 'Banking')!.id
    const statement = (await api.newTab({ url: 'data:text/html,<title>Statement</title>', mcpGroupId: id, active: true })).activeTabId!
    const transfer = (await api.newTab({ url: 'data:text/html,<title>Transfer</title>', mcpGroupId: id, active: true })).activeTabId!
    const split = (await api.openSplitView(statement)).splitView
    return { transfer, split }
  })
  expect(person.split).toBeTruthy()
  const shown = () => appWindow.evaluate(async () => {
    const state = await (window as unknown as { hronaut: HronautApi }).hronaut.getState()
    return { activeTabId: state.activeTabId, splitView: state.splitView }
  })
  const before = await shown()

  const client = await connectClient(mcpPort, mcpToken)
  try {
    const { id: workspaceId } = JSON.parse(await call(client, 'browser_workspaces', { action: 'create', name: 'Agent research' })) as { id: string }
    await call(client, 'browser_new_tab', { workspaceId, url: 'data:text/html,<title>Agent page</title>' })
    const saved = JSON.parse(await call(client, 'browser_saved_workspaces', { action: 'save', workspaceId })) as { id: string }
    await expect.poll(shown).toEqual(before)

    await call(client, 'browser_saved_workspaces', { action: 'open', savedWorkspaceId: saved.id })

    await expect.poll(() => appWindow.evaluate(async (id) => (
      (await (window as unknown as { hronaut: HronautApi }).hronaut.getState()).tabs.some(tab => tab.mcpGroupId === id)
    ), workspaceId)).toBe(true)
    expect(await shown()).toEqual(before)
    expect(before.activeTabId).toBe(person.transfer)
    // The agent keeps working in its workspace without a tab ID.
    expect(await call(client, 'browser_tabs', { workspaceId })).toContain('Agent page')
  } finally {
    await client.close()
  }
})
