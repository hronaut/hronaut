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

function parsed(result: CallToolResult): Record<string, unknown> {
  return JSON.parse(succeeded(result))
}

test('shows the agents working in the workspace in view, who needs you, and forgets closed sessions', async ({ appWindow, mcpPort, mcpToken }) => {
  await expect.poll(async () => {
    try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`, { headers: { authorization: `Bearer ${mcpToken}` } })).ok } catch { return false }
  }).toBe(true)
  const connect = async (name: string) => {
    const client = new Client({ name, version: '1.0.0' })
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), { requestInit: { headers: { authorization: `Bearer ${mcpToken}` } } })
    await client.connect(transport)
    return { client, transport }
  }
  const claude = await connect('Claude Code')
  const windsurf = await connect('Windsurf')
  const cursor = await connect('Cursor')
  try {
    const workspace = await connectMcpWorkspace(claude.client, 'Presence', false)
    const first = parsed(await claude.client.callTool({ name: 'browser_new_tab', arguments: { url: 'data:text/html,<title>Presence one</title><main>One</main>', active: true } }) as CallToolResult)
    const firstTabId = (first.tabs as Array<{ id: string }>)[0]!.id
    await appWindow.evaluate(`window.hronaut.selectTab(${JSON.stringify(firstTabId)})`)

    const group = appWindow.getByRole('group', { name: 'Agents in this workspace', exact: true })
    const claudeAvatar = group.getByRole('button', { name: 'Claude Code, working', exact: true })
    await expect(claudeAvatar).toBeVisible()
    await expect(claudeAvatar).toHaveAttribute('data-tooltip', 'Claude Code · Opening a new tab')
    // After the address field, inside the toolbar, at least a 32 px target.
    expect(await appWindow.locator('.toolbar').evaluate(toolbar => {
      const address = toolbar.querySelector('.address-form')!.getBoundingClientRect()
      const avatar = toolbar.querySelector('.agent-avatar')!.getBoundingClientRect()
      return avatar.left >= address.right && avatar.width >= 32 && avatar.height >= 32
    })).toBe(true)
    const face = claudeAvatar.locator('.agent-avatar-face')
    await expect(face).toHaveText('C')
    expect(await face.evaluate(element => getComputedStyle(element).animationName)).toBe('agent-avatar-breathe')

    // A second client in the same workspace joins the group, after the first.
    await connectMcpWorkspace(windsurf.client, '', false, workspace)
    succeeded(await windsurf.client.callTool({ name: 'browser_snapshot', arguments: { tabId: firstTabId } }) as CallToolResult)
    const windsurfAvatar = group.getByRole('button', { name: /^Windsurf, / })
    await expect(windsurfAvatar).toHaveAttribute('data-tooltip', 'Windsurf · Reading the page')
    await expect(group.getByRole('button')).toHaveText(['C', 'W'])

    // Any call counts, not only calls that act on a tab.
    await connectMcpWorkspace(cursor.client, '', false, workspace)
    succeeded(await cursor.client.callTool({ name: 'browser_tabs', arguments: {} }) as CallToolResult)
    await expect(group.getByRole('button', { name: /^Cursor, / })).toBeVisible()
    await cursor.transport.terminateSession()
    await expect(group.getByRole('button', { name: /^Cursor, / })).toHaveCount(0)

    // Clicking an avatar shows the tab that agent last used.
    const second = parsed(await claude.client.callTool({ name: 'browser_new_tab', arguments: { url: 'data:text/html,<title>Presence two</title><main>Two</main>', active: false } }) as CallToolResult)
    const secondTabId = (second.tabs as Array<{ id: string }>).find(tab => tab.id !== firstTabId)!.id
    await expect(claudeAvatar).toHaveAttribute('data-tooltip', 'Claude Code · Opening a new tab')
    await claudeAvatar.click()
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then(state => state.activeTabId)')).toBe(secondTabId)

    // An agent that asks for you comes first, with an amber ring, a badge and its reason.
    succeeded(await windsurf.client.callTool({ name: 'browser_request_user_attention', arguments: { tabId: firstTabId, reason: 'Check the total.' } }) as CallToolResult)
    const asking = group.getByRole('button', { name: 'Windsurf, needs you', exact: true })
    await expect(asking).toHaveAttribute('data-tooltip', 'Windsurf · Needs you: Check the total.')
    await expect(group.getByRole('button')).toHaveText(['W', 'C'])
    await expect(asking.locator('.agent-avatar-badge')).toBeVisible()
    const ring = await asking.locator('.agent-avatar-face').evaluate(element => {
      const probe = document.createElement('i')
      probe.style.color = 'var(--needs-you)'
      element.append(probe)
      const color = getComputedStyle(probe).color
      probe.remove()
      return { shadow: getComputedStyle(element).boxShadow, color }
    })
    expect(ring.shadow).toContain(ring.color)

    // Closing a session that waits for you keeps it until you answer; then it leaves.
    await windsurf.transport.terminateSession()
    await expect(asking).toBeVisible()
    // Pressing the avatar answers the request and still shows the tab it asked about.
    await appWindow.evaluate(`window.hronaut.selectTab(${JSON.stringify(secondTabId)})`)
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then(state => state.activeTabId)')).toBe(secondTabId)
    await asking.click()
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then(state => state.activeTabId)')).toBe(firstTabId)
    await expect.poll(() => appWindow.evaluate('window.hronaut.getUserAttention()')).toBeNull()
    await expect(group.getByRole('button', { name: /^Windsurf/ })).toHaveCount(0)
    await expect(group.getByRole('button', { name: /^Claude Code, / })).toBeVisible()

    // Another workspace shows only the agents working there.
    const other = await connect('Codex')
    try {
      await connectMcpWorkspace(other.client, 'Elsewhere', false)
      const elsewhere = parsed(await other.client.callTool({ name: 'browser_new_tab', arguments: { url: 'data:text/html,<title>Elsewhere</title>', active: true } }) as CallToolResult)
      await appWindow.evaluate(`window.hronaut.selectTab(${JSON.stringify((elsewhere.tabs as Array<{ id: string }>)[0]!.id)})`)
      await expect(group.getByRole('button')).toHaveText(['C'])
      await expect(group.getByRole('button', { name: /^Codex, / })).toBeVisible()
    } finally {
      await other.client.close()
    }
  } finally {
    await Promise.allSettled([claude.client.close(), windsurf.client.close(), cursor.client.close()])
  }
})
