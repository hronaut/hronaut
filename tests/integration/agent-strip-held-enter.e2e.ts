import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { connectMcpWorkspace } from '../../scripts/mcp-workspace.js'
import { expect, test } from './fixtures.js'

function parsed(result: CallToolResult): Record<string, unknown> {
  const content = result.content.find(item => item.type === 'text')
  const text = content?.type === 'text' ? content.text : ''
  expect(result.isError, text).not.toBe(true)
  return JSON.parse(text)
}

test('a held Enter on Hand back in the live strip hands back without pausing or taking over', async ({ appWindow, mcpPort, mcpToken }) => {
  await expect.poll(async () => {
    try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`, { headers: { authorization: `Bearer ${mcpToken}` } })).ok } catch { return false }
  }).toBe(true)
  const client = new Client({ name: 'Claude Code', version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), { requestInit: { headers: { authorization: `Bearer ${mcpToken}` } } }))
  try {
    await connectMcpWorkspace(client, 'Held strip', false)
    const opened = parsed(await client.callTool({ name: 'browser_new_tab', arguments: { url: 'data:text/html,<title>Held strip</title><main>Held strip</main>', active: true } }) as CallToolResult)
    const tabId = (opened.tabs as Array<{ id: string }>)[0]!.id
    await appWindow.evaluate(`window.hronaut.selectTab(${JSON.stringify(tabId)})`)
    await appWindow.evaluate('window.hronautSettings.setPinAgentLiveStatus(true)')
    const strip = appWindow.getByRole('group', { name: 'Live status of agents in this workspace', exact: true })
    await expect(strip.getByText('Claude Code', { exact: true })).toBeVisible()
    const paused = () => appWindow.evaluate(`window.hronaut.getState().then(state => state.tabs.find(tab => tab.id === ${JSON.stringify(tabId)})?.agentPaused === true)`)

    parsed(await client.callTool({ name: 'browser_request_user_attention', arguments: { tabId, reason: 'Check the total.' } }) as CallToolResult)
    await expect(strip).toHaveAttribute('data-state', 'needs-you')
    const handBack = strip.getByRole('button', { name: 'Hand back', exact: true })
    await handBack.focus()
    await expect(handBack).toBeFocused()
    await appWindow.keyboard.down('Enter')
    await expect.poll(() => appWindow.evaluate('window.hronaut.getUserAttention()')).toBeNull()
    // Hand back leaves and hands its focus to the strip's next control, Take over or Pause, which each repeat of the
    // held key used to press: Take over paused the agent and took its tab, Pause flipped on every repeat.
    const focused = strip.locator('button:focus')
    await expect(focused).toHaveText(/^(Take over|Pause)$/)
    const next = strip.getByRole('button', { name: (await focused.textContent())!.trim(), exact: true })
    for (let repeat = 0; repeat < 5; repeat += 1) {
      await appWindow.waitForTimeout(50)
      await expect(next).toBeFocused()
      await appWindow.keyboard.down('Enter')
    }
    await appWindow.keyboard.up('Enter')
    await expect(next).toBeFocused()
    expect(await paused()).toBe(false)

    // A new press still runs it.
    await appWindow.keyboard.press('Enter')
    await expect.poll(paused).toBe(true)

    // Unpin hands its focus to the agent's avatar, which each repeat used to open the card from.
    const unpin = strip.getByRole('button', { name: 'Unpin live status', exact: true })
    await unpin.focus()
    await expect(unpin).toBeFocused()
    const avatar = appWindow.getByRole('group', { name: 'Agents in this workspace', exact: true }).getByRole('button', { name: /^Claude Code, / })
    await appWindow.keyboard.down('Enter')
    await expect(strip).toHaveCount(0)
    for (let repeat = 0; repeat < 5; repeat += 1) {
      await appWindow.waitForTimeout(50)
      await expect(avatar).toBeFocused()
      await appWindow.keyboard.down('Enter')
    }
    await appWindow.keyboard.up('Enter')
    await expect(avatar).toHaveAttribute('aria-expanded', 'false')
    await appWindow.keyboard.press('Enter')
    await expect(avatar).toHaveAttribute('aria-expanded', 'true')
  } finally {
    await client.close()
  }
})
