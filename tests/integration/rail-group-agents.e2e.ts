import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { Locator, Page } from '@playwright/test'
import { connectMcpWorkspace } from '../../scripts/mcp-workspace.js'
import type { AgentPresenceSnapshot } from '../../src/shared/agent-presence.js'
import { expect, test } from './fixtures.js'

function succeeded(result: CallToolResult): string {
  const content = result.content.find(item => item.type === 'text')
  const text = content?.type === 'text' ? content.text : ''
  expect(result.isError, text).not.toBe(true)
  return text
}

function presenceRevision(appWindow: Page): Promise<number> {
  return appWindow.evaluate(async () => (await (window as unknown as { hronautAgentPresence: { get: () => Promise<AgentPresenceSnapshot> } }).hronautAgentPresence.get()).revision)
}

/** Where the header's name, agents and count sit, and whether each stays inside the header. */
function headerLayout(header: Locator) {
  return header.evaluate((button) => {
    const row = button.getBoundingClientRect()
    const box = (selector: string) => button.querySelector(selector)!.getBoundingClientRect()
    const name = box('.tab-group-name')
    const agents = box('.tab-group-agents')
    const count = box('.tab-group-count')
    // Avatars wholly inside the cluster's first line, the only one in view.
    const whole = [...button.querySelectorAll('.tab-group-agent')].filter((avatar) => {
      const rect = avatar.getBoundingClientRect()
      return rect.width > 0 && rect.top < agents.bottom - 4 && rect.left >= agents.left - 0.5 && rect.right <= agents.right + 0.5
    }).length
    const nameElement = button.querySelector('.tab-group-name')!
    return {
      nameWhole: nameElement.scrollWidth <= nameElement.clientWidth,
      nameBeforeAgents: agents.width === 0 || name.right <= agents.left + 0.5,
      agentsBeforeCount: agents.width === 0 || agents.right <= count.left + 0.5,
      countInside: count.right <= row.right + 0.5,
      whole
    }
  })
}

test('shows each workspace\'s agents in the rail and opens a folded workspace when its agent needs you', async ({ appWindow, mcpPort, mcpToken }) => {
  await expect.poll(async () => {
    try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`, { headers: { authorization: `Bearer ${mcpToken}` } })).ok } catch { return false }
  }).toBe(true)
  const connect = async (name: string) => {
    const client = new Client({ name, version: '1.0.0' })
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), { requestInit: { headers: { authorization: `Bearer ${mcpToken}` } } }))
    return client
  }
  const clients = [await connect('Claude Code')]
  const [client] = clients as [Client]
  try {
    await appWindow.evaluate("window.hronautSettings.setTabPosition('left')")
    const workspace = await connectMcpWorkspace(client, 'Shop', false)
    const opened = JSON.parse(succeeded(await client.callTool({ name: 'browser_new_tab', arguments: { url: 'data:text/html,<title>Cart</title><main>Cart</main>', active: false } }) as CallToolResult))
    const tabId = (opened.tabs as Array<{ id: string }>)[0]!.id

    const header = appWindow.getByRole('button', { name: /^(Collapse|Expand) workspace Shop, 1 tab/u })
    const avatars = header.getByTestId('workspace-agents')
    await expect(avatars.locator('.tab-group-agent')).toHaveCount(1)
    await expect(avatars.locator('.tab-group-agent')).toHaveAttribute('data-initial', 'C')
    await expect(avatars.locator('.tab-group-agent')).toHaveAttribute('data-state', 'working')
    await expect(header).toHaveAccessibleDescription(/Agents here: Claude Code \(Working\)/u)
    // Drawn inside the header, after the name and before the tab count.
    expect(await headerLayout(header)).toMatchObject({ nameBeforeAgents: true, agentsBeforeCount: true, countInside: true })

    // The top tab strip has no room for them; the toolbar shows the agents of the workspace in view.
    await appWindow.evaluate("window.hronautSettings.setTabPosition('top')")
    await expect(avatars).toBeHidden()
    await appWindow.evaluate("window.hronautSettings.setTabPosition('left')")
    await expect(avatars).toBeVisible()

    // The person folds it while the agent works; it stays folded while the same agent carries on, however long it
    // paused in between.
    await header.click()
    await expect(header).toHaveAttribute('aria-expanded', 'false')
    const before = await presenceRevision(appWindow)
    succeeded(await client.callTool({ name: 'browser_snapshot', arguments: { tabId } }) as CallToolResult)
    await expect.poll(() => presenceRevision(appWindow)).toBeGreaterThan(before)
    await expect(avatars.locator('.tab-group-agent')).toHaveAttribute('data-state', 'working')
    await expect(header).toHaveAttribute('aria-expanded', 'false')

    // Asking for the person opens it again. Naming no tab, so the shell does not switch to one, which would open it too.
    const activeTab = () => appWindow.evaluate(async () => (await (window as unknown as { hronaut: { getState: () => Promise<{ activeTabId: string }> } }).hronaut.getState()).activeTabId)
    const shown = await activeTab()
    expect(shown).not.toBe(tabId)
    succeeded(await client.callTool({ name: 'browser_request_user_attention', arguments: { reason: 'Check the total.' } }) as CallToolResult)
    await expect(header).toHaveAttribute('aria-expanded', 'true')
    expect(await activeTab()).toBe(shown)
    await expect(avatars.locator('.tab-group-agent')).toHaveAttribute('data-state', 'needs-you')
    await expect(appWindow.getByRole('tab', { name: /Cart/u })).toBeVisible()

    // At the narrowest rail, with Needs you and four agents, the name, the label and the count stay whole, and the
    // agents give way.
    for (const name of ['Cursor', 'Windsurf', 'Codex']) {
      const other = await connect(name)
      clients.push(other)
      await connectMcpWorkspace(other, '', false, workspace)
      succeeded(await other.callTool({ name: 'browser_tabs', arguments: {} }) as CallToolResult)
    }
    await expect(avatars.locator('.tab-group-agent')).toHaveCount(4)
    await expect(avatars.locator('.tab-group-agent.more')).toHaveAttribute('data-initial', '+1')
    const separator = appWindow.getByRole('separator', { name: 'Resize workspace panel', exact: true })
    await separator.focus()
    await appWindow.keyboard.press('Home')
    await expect(separator).toHaveAttribute('aria-valuenow', '200')
    await expect(avatars).toBeHidden()
    await expect.poll(() => headerLayout(header)).toMatchObject({ countInside: true })
    expect((await headerLayout(header)).nameWhole).toBe(true)
    // Once answered, the agents come back, as many as fit whole, the first always.
    const request = await appWindow.evaluate(() => (window as unknown as { hronaut: { getUserAttention: () => Promise<{ id: string } | null> } }).hronaut.getUserAttention())
    expect(await appWindow.evaluate((id) => (window as unknown as { hronaut: { answerUserAttention: (id: string, outcome: string) => Promise<boolean> } }).hronaut.answerUserAttention(id, 'dismissed'), request!.id)).toBe(true)
    await expect(avatars).toBeVisible()
    await expect.poll(() => headerLayout(header)).toMatchObject({ nameWhole: true, nameBeforeAgents: true, agentsBeforeCount: true, countInside: true })
    expect((await headerLayout(header)).whole).toBeGreaterThanOrEqual(1)
  } finally {
    await Promise.allSettled(clients.map((each) => each.close()))
  }
})
