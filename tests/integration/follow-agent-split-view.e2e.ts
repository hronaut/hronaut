import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { HronautApi } from '../../src/shared/types.js'
import { expect, test } from './fixtures.js'

// With Follow agents on, an agent's call on the tab the person shows beside their own in split view made that tab
// the active pane and moved keyboard focus out of the person's page.

const text = (result: CallToolResult) => result.content.map((part) => part.type === 'text' ? part.text : '').join('')

async function connectClient(port: number, token: string): Promise<Client> {
  await expect.poll(async () => {
    try {
      return (await fetch(`http://127.0.0.1:${port}/healthz`, { headers: { authorization: `Bearer ${token}` } })).ok
    } catch {
      return false
    }
  }).toBe(true)
  const client = new Client({ name: 'follow-agent-split-view', version: '1.0.0' })
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

test('leaves the person\'s pane active when an agent works in the other pane of the split view', async ({ appWindow, electronApp, mcpPort, mcpToken }) => {
  const notesUrl = 'data:text/html,<title>Notes</title><textarea autofocus></textarea>'
  const client = await connectClient(mcpPort, mcpToken)
  try {
    const { id: workspaceId } = JSON.parse(await call(client, 'browser_workspaces', { action: 'create', name: 'Agent research' })) as { id: string }
    const agentTabId = (JSON.parse(await call(client, 'browser_new_tab', { workspaceId, url: 'data:text/html,<title>Agent run</title>' })) as { activeTabId: string }).activeTabId
    const otherAgentTabId = (JSON.parse(await call(client, 'browser_new_tab', {
      workspaceId, url: 'data:text/html,<title>Agent sources</title>', active: false
    })) as { tabs: Array<{ id: string }> }).tabs.find(tab => tab.id !== agentTabId)!.id

    // The person shows the agent's tab beside their own notes and works in the notes.
    const person = await appWindow.evaluate(async ({ url, agentTab }) => {
      const api = (window as unknown as { hronaut: HronautApi }).hronaut
      const state = await api.createWorkspace({ name: 'Notes', storage: 'scratch' })
      const id = state.mcpTabGroups.find(group => group.name === 'Notes')!.id
      const notes = (await api.newTab({ url, mcpGroupId: id, active: true })).activeTabId!
      await api.openSplitView(agentTab)
      return notes
    }, { url: notesUrl, agentTab: agentTabId })
    await appWindow.evaluate('window.hronautSettings.setFollowAgentActivity(true)')
    const shown = () => appWindow.evaluate(async () => {
      const state = await (window as unknown as { hronaut: HronautApi }).hronaut.getState()
      return { activeTabId: state.activeTabId, splitView: state.splitView }
    })
    const focusedPage = () => electronApp.evaluate(({ webContents }) => webContents.getFocusedWebContents()?.getURL() ?? null)
    await expect.poll(shown).toMatchObject({ activeTabId: person, splitView: { firstTabId: person, secondTabId: agentTabId } })
    const before = await shown()
    const focusBefore = await focusedPage()

    await call(client, 'browser_evaluate', { workspaceId, tabId: agentTabId, script: 'document.title' })

    expect(await shown()).toEqual(before)
    expect(await focusedPage()).toBe(focusBefore)

    // Follow is on: the agent's call on a tab out of view still shows that tab.
    await call(client, 'browser_evaluate', { workspaceId, tabId: otherAgentTabId, script: 'document.title' })
    await expect.poll(async () => (await shown()).activeTabId).toBe(otherAgentTabId)
  } finally {
    await appWindow.evaluate('window.hronautSettings.setFollowAgentActivity(false)').catch(() => undefined)
    await client.close()
  }
})
