import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { connectMcpWorkspace } from '../../scripts/mcp-workspace.js'
import { expect, test } from './fixtures.js'

function succeeded(result: CallToolResult): string {
  const content = result.content.find(item => item.type === 'text')
  const text = content?.type === 'text' ? content.text : ''
  expect(result.isError, text).not.toBe(true)
  return text
}

test('shows each workspace\'s agents in the rail and opens a folded workspace when its agent needs you', async ({ appWindow, mcpPort, mcpToken }) => {
  await expect.poll(async () => {
    try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`, { headers: { authorization: `Bearer ${mcpToken}` } })).ok } catch { return false }
  }).toBe(true)
  const client = new Client({ name: 'Claude Code', version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), { requestInit: { headers: { authorization: `Bearer ${mcpToken}` } } }))
  try {
    await appWindow.evaluate("window.hronautSettings.setTabPosition('left')")
    await connectMcpWorkspace(client, 'Shop', false)
    const opened = JSON.parse(succeeded(await client.callTool({ name: 'browser_new_tab', arguments: { url: 'data:text/html,<title>Cart</title><main>Cart</main>', active: false } }) as CallToolResult))
    const tabId = (opened.tabs as Array<{ id: string }>)[0]!.id

    const header = appWindow.getByRole('button', { name: /^(Collapse|Expand) workspace Shop, 1 tab/u })
    const avatars = header.getByTestId('workspace-agents')
    await expect(avatars.locator('.tab-group-agent')).toHaveCount(1)
    await expect(avatars.locator('.tab-group-agent')).toHaveAttribute('data-initial', 'C')
    await expect(avatars.locator('.tab-group-agent')).toHaveAttribute('data-state', 'working')
    await expect(header).toHaveAccessibleDescription(/Agents here: Claude Code \(Working\)/u)
    // Drawn inside the header, before the tab count, without pushing the name out of view.
    expect(await header.evaluate((button) => {
      const row = button.getBoundingClientRect()
      const agents = button.querySelector('.tab-group-agents')!.getBoundingClientRect()
      const count = button.querySelector('.tab-group-count')!.getBoundingClientRect()
      const name = [...button.children].find((child) => child.textContent === 'Shop')!.getBoundingClientRect()
      return [agents.left >= name.right, agents.right <= count.left, agents.right <= row.right, name.width > 0]
    })).toEqual([true, true, true, true])

    // The top tab strip has no room for them; the toolbar shows the agents of the workspace in view.
    await appWindow.evaluate("window.hronautSettings.setTabPosition('top')")
    await expect(avatars).toBeHidden()
    await appWindow.evaluate("window.hronautSettings.setTabPosition('left')")
    await expect(avatars).toBeVisible()

    // The person folds it while the agent works; it stays folded while nothing changes there.
    await header.click()
    await expect(header).toHaveAttribute('aria-expanded', 'false')
    succeeded(await client.callTool({ name: 'browser_snapshot', arguments: { tabId } }) as CallToolResult)
    await expect(header).toHaveAttribute('aria-expanded', 'false')

    // Asking for the person opens it again. Naming no tab, so the shell does not switch to one, which would open it too.
    const activeTab = () => appWindow.evaluate(async () => (await (window as unknown as { hronaut: { getState: () => Promise<{ activeTabId: string }> } }).hronaut.getState()).activeTabId)
    const before = await activeTab()
    expect(before).not.toBe(tabId)
    succeeded(await client.callTool({ name: 'browser_request_user_attention', arguments: { reason: 'Check the total.' } }) as CallToolResult)
    await expect(header).toHaveAttribute('aria-expanded', 'true')
    expect(await activeTab()).toBe(before)
    await expect(avatars.locator('.tab-group-agent')).toHaveAttribute('data-state', 'needs-you')
    await expect(appWindow.getByRole('tab', { name: /Cart/u })).toBeVisible()
  } finally {
    await client.close()
  }
})
