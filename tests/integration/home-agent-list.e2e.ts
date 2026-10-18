import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { connectMcpWorkspace } from '../../scripts/mcp-workspace.js'
import type { BrowserState } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

test('Home lists connected agents by client, with their sessions, and opens the workspace one is in', async ({ electronApp, appWindow, mcpPort, mcpToken }) => {
  const site = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' })
    response.end('<!doctype html><title>Checkout</title><h1>Checkout</h1>')
  })
  await new Promise<void>(resolve => site.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(site.address() as AddressInfo).port}`
  const clients: Client[] = []
  const connect = async (name: string, version: string): Promise<Client> => {
    const client = new Client({ name, version })
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), { requestInit: { headers: { authorization: `Bearer ${mcpToken}` } } }))
    clients.push(client)
    return client
  }
  try {
    await expect.poll(async () => {
      try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`, { headers: { authorization: `Bearer ${mcpToken}` } })).ok } catch { return false }
    }).toBe(true)
    // Two sessions of one client, one of them in a workspace, and a client that came through a bridge.
    const shopper = await connect('claude-code', '2.0.31')
    await connectMcpWorkspace(shopper, 'Checkout review', false)
    const opened = await shopper.callTool({ name: 'browser_new_tab', arguments: { url: `${origin}/checkout`, active: true } }) as CallToolResult
    expect(opened.isError).not.toBe(true)
    const tabId = (JSON.parse(opened.content.filter(part => part.type === 'text').map(part => part.text).join('\n')) as BrowserState).activeTabId!
    await connect('claude-code', '2.0.28')
    await connect('claude-ai (via mcp-remote 0.1.37)', '0.1.0')

    await appWindow.evaluate('window.hronaut.openHome()')
    await expect.poll(() => electronApp.context().pages().some(page => page.url().startsWith('hronaut://home'))).toBe(true)
    const home = electronApp.context().pages().find(page => page.url().startsWith('hronaut://home'))!
    const panel = home.getByRole('region', { name: 'Connected agents', exact: true })
    const list = panel.getByRole('list', { name: 'Connected agents', exact: true })
    const clientRows = list.locator(':scope > li')
    await expect(clientRows).toHaveCount(2)
    await expect(panel.locator('#home-agents-count')).toHaveText('3')
    // One row per client: Claude Code with its two sessions, and claude-ai, read as "Claude", named apart from its bridge.
    const claude = clientRows.filter({ hasText: 'Claude Code' })
    const bridged = clientRows.filter({ hasText: 'via mcp-remote' })
    await expect(bridged.locator('strong')).toHaveText('Claude')
    await expect(bridged.locator('.home-agent-via')).toHaveText('via mcp-remote 0.1.37')
    const sessions = claude.getByRole('button', { name: 'Claude Code: 2 sessions', exact: true })
    await expect(sessions).toHaveAttribute('aria-expanded', 'false')
    await sessions.click()
    await expect(sessions).toHaveAttribute('aria-expanded', 'true')
    const rows = claude.locator('.home-agent-session')
    await expect(rows).toHaveCount(2)
    // Their versions differ, so each says its own, with when it connected. Which comes first depends on whether the
    // first session's last step is still within its working grace.
    await expect.poll(async () => (await rows.locator('.home-agent-meta').allInnerTexts()).sort())
      .toEqual([expect.stringMatching(/^v2\.0\.28 · connected /u), expect.stringMatching(/^v2\.0\.31 · connected /u)])

    // The workspace a session works in opens from its row.
    expect((await appWindow.evaluate('window.hronaut.getState()') as BrowserState).activeTabId).not.toBe(tabId)
    await claude.locator('.home-agent-row').getByRole('button', { name: 'Checkout review', exact: true }).click()
    await expect.poll(async () => (await appWindow.evaluate('window.hronaut.getState()') as BrowserState).activeTabId).toBe(tabId)
  } finally {
    await Promise.allSettled(clients.map(client => client.close()))
    await closeFixtureServer(site)
  }
})

test('Home keeps the agent status pill to its share of the header when a long agent name is in it', async ({ electronApp, appWindow, mcpPort, mcpToken }) => {
  const name = 'local-agent-mode-hronaut (via mcp-remote 0.1.37)'
  const client = new Client({ name, version: '1.0.0' })
  try {
    await expect.poll(async () => {
      try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`, { headers: { authorization: `Bearer ${mcpToken}` } })).ok } catch { return false }
    }).toBe(true)
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), { requestInit: { headers: { authorization: `Bearer ${mcpToken}` } } }))
    await appWindow.evaluate('window.hronaut.openHome()')
    await expect.poll(() => electronApp.context().pages().some(page => page.url().startsWith('hronaut://home'))).toBe(true)
    const home = electronApp.context().pages().find(page => page.url().startsWith('hronaut://home'))!
    // One connected agent is named in the status, so the pill carries its whole name.
    await expect(home.locator('#server-state')).toHaveText(`${name} connected`)
    for (const width of [1200, 760]) {
      await electronApp.evaluate(({ BrowserWindow }, next) => BrowserWindow.getAllWindows()[0]!.setSize(next, 900), width)
      await expect.poll(() => home.evaluate(() => innerWidth)).toBeLessThan(width)
      await expect.poll(() => home.evaluate(() => {
        const hero = document.querySelector('.hero')!.getBoundingClientRect()
        const pill = document.querySelector('.hero-status')!.getBoundingClientRect()
        const heading = document.getElementById('home-view-title')!
        const range = document.createRange()
        range.selectNodeContents(heading)
        return {
          share: pill.width <= hero.width * 0.45 + 1,
          clear: range.getBoundingClientRect().right <= pill.left,
          scroll: document.documentElement.scrollWidth - innerWidth <= 1
        }
      }), `${width} px`).toEqual({ share: true, clear: true, scroll: true })
      // What does not fit is cut with an ellipsis, and the whole status is there on hover.
      await expect(home.locator('#server-state')).toHaveAttribute('title', `${name} connected`)
    }
  } finally {
    await client.close().catch(() => {})
  }
})
