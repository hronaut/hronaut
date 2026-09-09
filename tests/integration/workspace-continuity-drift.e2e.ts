import { createServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { BrowserState } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

for (const change of ['tab', 'policy', 'input'] as const) {
  test(`requires fresh continuity review after a human ${change} change`, async ({ appWindow, electronApp, mcpPort, mcpToken }) => {
    const fixture = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html' })
      response.end(`<!doctype html><title>Continuity drift</title><body onkeydown="document.body.dataset.human='yes'"><main>Disposable fixture</main></body>`)
    })
    await new Promise<void>(resolve => fixture.listen(0, '127.0.0.1', resolve))
    const address = fixture.address()
    if (!address || typeof address === 'string') throw new Error('Missing fixture address')
    const origin = `http://127.0.0.1:${address.port}`
    const client = new Client({ name: 'continuity-drift-qa', version: '1' })
    const call = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args }) as Promise<CallToolResult>
    const decode = <T>(result: CallToolResult): T => {
      expect(result.isError).not.toBe(true)
      return JSON.parse(result.content.filter(part => part.type === 'text').map(part => part.text).join('\n')) as T
    }
    try {
      await expect.poll(async () => { try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`)).ok } catch { return false } }).toBe(true)
      await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), { requestInit: { headers: { authorization: `Bearer ${mcpToken}` } } }))
      const workspace = decode<{ id: string }>(await call('browser_workspaces', { action: 'create', storage: 'scratch', name: 'Continuity drift' }))
      const args = { workspaceId: workspace.id }
      const first = decode<BrowserState>(await call('browser_new_tab', { ...args, url: `${origin}/first` }))
      decode(await call('browser_new_tab', { ...args, url: `${origin}/second` }))
      await expect.poll(() => appWindow.evaluate(async () => {
        const state = await (window as unknown as { hronaut: { getState(): Promise<BrowserState> } }).hronaut.getState()
        return state.tabs.every(tab => !tab.loading)
      })).toBe(true)
      decode(await call('browser_continuity', { ...args, action: 'checkpoint' }))
      await appWindow.evaluate('window.hronautMcp.setPaused(true)')
      if (change === 'tab') {
        await appWindow.evaluate(`window.hronaut.selectTab(${JSON.stringify(first.activeTabId)})`)
      } else if (change === 'policy') {
        await appWindow.evaluate(`window.hronaut.updateWorkspaceNavigationPolicy(${JSON.stringify(workspace.id)}, { mode: 'restricted', rules: [${JSON.stringify(origin)}] })`)
      }
      if (change === 'input') {
        await electronApp.evaluate(({ webContents }, url) => {
          const page = webContents.getAllWebContents().find(page => page.getURL() === url)
          if (!page) throw new Error('Missing active drift fixture page')
          page.focus()
          page.sendInputEvent({ type: 'keyDown', keyCode: 'X' })
          page.sendInputEvent({ type: 'char', keyCode: 'X' })
          page.sendInputEvent({ type: 'keyUp', keyCode: 'X' })
        }, `${origin}/second`)
        await expect.poll(() => electronApp.evaluate(({ webContents }, url) => {
          return webContents.getAllWebContents().find(page => page.getURL() === url)?.executeJavaScript('document.body.dataset.human')
        }, `${origin}/second`)).toBe('yes')
      }
      await appWindow.evaluate('window.hronautMcp.setPaused(false)')
      const report = decode<{ reviewId: string; reasons: string[] }>(await call('browser_continuity', { ...args, action: 'status' }))
      expect(report).toMatchObject({ status: 'BLOCKED', suspended: true })
      expect(report.reasons).toContain(change === 'tab' ? 'TAB_CHANGED' : change === 'policy' ? 'POLICY_CHANGED' : 'HUMAN_INPUT_CHANGED')
      expect(JSON.stringify(report)).not.toContain(origin)
      expect((await call('browser_evaluate', { ...args, script: 'window.driftWrites = 1' })).isError).toBe(true)
      const writes = await electronApp.evaluate(async ({ webContents }, origin) => Promise.all(
        webContents.getAllWebContents().filter(page => page.getURL().startsWith(origin)).map(page => page.executeJavaScript('window.driftWrites ?? 0'))
      ), origin)
      expect(writes).toEqual([0, 0])
      decode(await call('browser_continuity', { ...args, action: 'reconcile', reviewId: report.reviewId }))
      expect((await call('browser_evaluate', { ...args, script: 'window.driftWrites = 1' })).isError).not.toBe(true)
    } finally {
      await client.close()
      await closeFixtureServer(fixture)
    }
  })
}
