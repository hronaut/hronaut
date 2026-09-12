import { createServer, type ServerResponse } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { BrowserState } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

test('keeps activity from a disconnected command that settles after changing the MCP port', async ({ appWindow, electronApp, mcpPort, mcpToken }) => {
  let held: ServerResponse | undefined
  const fixture = createServer((request, response) => {
    if (request.url === '/hold') { held = response; return }
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>Activity fixture</title><main>Ready</main>')
  })
  const reserve = createServer()
  const listen = (server: ReturnType<typeof createServer>) => new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  await listen(fixture)
  await listen(reserve)
  const fixtureAddress = fixture.address()
  const nextAddress = reserve.address()
  if (!fixtureAddress || typeof fixtureAddress === 'string' || !nextAddress || typeof nextAddress === 'string') throw new Error('Missing fixture ports')
  const nextPort = nextAddress.port
  await closeFixtureServer(reserve)
  const client = new Client({ name: 'activity-continuity-test', version: '1' })
  const call = async (name: string, args: Record<string, unknown>) => await client.callTool({ name, arguments: args }) as CallToolResult
  const parse = <T>(result: CallToolResult): T => {
    expect(result.isError).not.toBe(true)
    return JSON.parse(result.content.filter(part => part.type === 'text').map(part => part.text).join('\n')) as T
  }
  try {
    await expect.poll(async () => {
      try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`, { headers: { authorization: `Bearer ${mcpToken}` } })).ok } catch { return false }
    }).toBe(true)
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${mcpToken}` } }
    }))
    const workspace = parse<{ id: string }>(await call('browser_workspaces', { action: 'create', storage: 'scratch', name: 'Activity fixture' }))
    const state = parse<BrowserState>(await call('browser_new_tab', { workspaceId: workspace.id, url: `http://127.0.0.1:${fixtureAddress.port}` }))
    const timedOut = await call('browser_wait', {
      workspaceId: workspace.id, tabId: state.activeTabId!, text: 'text that never appears', timeoutMs: 100
    })
    expect(timedOut).toMatchObject({ isError: true, structuredContent: { status: 'TIMED_OUT' } })
    const pending = call('browser_evaluate', { workspaceId: workspace.id, tabId: state.activeTabId!, script: "fetch('/hold').then(() => 'done')" })
    void pending.catch(() => undefined)
    await expect.poll(() => Boolean(held)).toBe(true)
    await client.close()
    await appWindow.getByRole('button', { name: 'Settings' }).click()
    await appWindow.getByRole('button', { name: /MCP security/ }).click()
    await appWindow.getByRole('spinbutton', { name: 'MCP server port' }).fill(String(nextPort))
    await appWindow.getByRole('button', { name: 'Apply port' }).click()
    await expect(appWindow.getByText(`MCP port ${nextPort} is active.`)).toBeVisible()
    held!.end('release')
    await appWindow.evaluate('window.hronaut.openHome()')
    await expect.poll(() => electronApp.evaluate(async ({ webContents }) => {
      const home = webContents.getAllWebContents().find(contents => contents.getURL().startsWith('hronaut://home'))
      if (!home) return null
      try { return await home.executeJavaScript("fetch('/api/status').then(response => response.json()).then(state => state.recentActivity)") } catch { return null }
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ toolName: 'browser_new_tab', outcome: 'finished' }),
      expect.objectContaining({
        toolName: 'browser_wait', outcome: 'failed',
        result: {
          outcome: 'timed-out', reasonCode: 'TIMEOUT', dispatch: 'dispatched',
          effects: 'none', evidenceSource: 'hronaut-observed'
        }
      }),
      // Replacing the endpoint aborts the old server's in-flight command. Keep
      // that explicit cancellation visible in the shared activity history.
      expect.objectContaining({
        toolName: 'browser_evaluate', outcome: 'failed',
        result: {
          outcome: 'cancelled', reasonCode: 'REQUEST_CANCELLED', dispatch: 'dispatched',
          effects: 'possible', evidenceSource: 'hronaut-observed'
        }
      })
    ]))
    await expect.poll(() => electronApp.evaluate(async ({ webContents }) => {
      const home = webContents.getAllWebContents().find(contents => contents.getURL().startsWith('hronaut://home'))
      return home?.executeJavaScript("document.getElementById('activity-list')?.innerText")
    })).toEqual(expect.stringContaining('Cancelled'))
    await expect.poll(() => electronApp.evaluate(async ({ webContents }) => {
      const home = webContents.getAllWebContents().find(contents => contents.getURL().startsWith('hronaut://home'))
      return home?.executeJavaScript("document.getElementById('activity-list')?.innerText")
    })).toEqual(expect.stringContaining('Timed out'))
  } finally {
    held?.end()
    await client.close()
    await closeFixtureServer(fixture)
  }
})
