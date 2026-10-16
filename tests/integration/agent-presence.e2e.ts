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
    // They overlap, Figma style, and the one under the pointer comes to the front.
    const edges = await group.getByRole('button').evaluateAll(buttons => buttons.map(button => button.getBoundingClientRect()).map(box => ({ left: box.left, right: box.right })))
    expect(edges[1]!.left).toBeLessThan(edges[0]!.right)
    await windsurfAvatar.hover()
    expect(await windsurfAvatar.evaluate(element => getComputedStyle(element).zIndex)).toBe('2')

    // Any call counts, not only calls that act on a tab.
    await connectMcpWorkspace(cursor.client, '', false, workspace)
    succeeded(await cursor.client.callTool({ name: 'browser_tabs', arguments: {} }) as CallToolResult)
    await expect(group.getByRole('button', { name: /^Cursor, / })).toBeVisible()
    await cursor.transport.terminateSession()
    await expect(group.getByRole('button', { name: /^Cursor, / })).toHaveCount(0)

    // Clicking an avatar opens its card (agent-card.e2e.ts covers the card itself).
    await expect(claudeAvatar).toHaveAttribute('aria-haspopup', 'dialog')

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
    const statusAttention = async () => (parsed(await claude.client.callTool({ name: 'browser_status', arguments: {} }) as CallToolResult).userAttention as { id: string } | null)
    const request = await statusAttention()
    expect(request?.id).toBeTruthy()
    // Pressing anywhere in the shell only quiets the request: agents see it answered, as before,
    // while it still shows as needs you until you answer it.
    await appWindow.locator('.address-form input').click()
    await expect.poll(statusAttention).toBeNull()
    await expect(asking).toBeVisible()
    expect(await appWindow.evaluate('window.hronaut.getUserAttention().then(request => request?.id)')).toBe(request!.id)
    // An answer for another request changes nothing; answering this one ends it.
    expect(await appWindow.evaluate('window.hronaut.answerUserAttention("00000000-0000-4000-8000-000000000000", "dismissed")')).toBe(false)
    expect(await appWindow.evaluate(`window.hronaut.answerUserAttention(${JSON.stringify(request!.id)}, "dismissed")`)).toBe(true)
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
