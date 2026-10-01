import { createServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { useMcpWorkspace } from '../../scripts/mcp-workspace.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

function text(result: CallToolResult): string {
  return result.content.filter(item => item.type === 'text').map(item => item.text).join('\n')
}

for (const navigation of ['same-document', 'document'] as const) {
  test(`ignores iframe URL matches while waiting for ${navigation} main-frame navigation`, async ({ electronApp, mcpPort, mcpToken }) => {
    const server = createServer((request, response) => {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(request.url === '/frame'
        ? '<!doctype html><h1>Child frame</h1>'
        : '<!doctype html><title>Main frame wait</title><h1>Parent page</h1><iframe src="/frame"></iframe>')
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing fixture port')
    const origin = `http://127.0.0.1:${address.port}`
    const url = `${origin}/parent`
    const client = new Client({ name: 'hronaut-frame-url-wait', version: '1' })
    try {
      await expect.poll(async () => { try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`)).ok } catch { return false } }).toBe(true)
      await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
        requestInit: { headers: { authorization: `Bearer ${mcpToken}` } }
      }))
      await useMcpWorkspace(client, 'Frame URL wait', false)
      const opened = await client.callTool({ name: 'browser_new_tab', arguments: { url, active: true } }) as CallToolResult
      expect(opened.isError).not.toBe(true)
      const tabId = (JSON.parse(text(opened)) as { activeTabId: string }).activeTabId
      await expect.poll(() => electronApp.context().pages().some(page => page.url() === url)).toBe(true)
      const page = electronApp.context().pages().find(page => page.url() === url)!
      await expect(page.frameLocator('iframe').getByRole('heading')).toHaveText('Child frame')
      const listeners = () => electronApp.evaluate(({ webContents }, url) => {
        const contents = webContents.getAllWebContents().find(candidate => candidate.getURL() === url)!
        return contents.listenerCount('did-navigate-in-page')
      }, url)
      const before = await listeners()
      const waiting = client.callTool({ name: 'browser_wait', arguments: { tabId, urlPattern: `${origin}/ready?*`, timeoutMs: 5000 } }) as Promise<CallToolResult>
      // Wait for actual event registration, not a delay or command-admission indicator.
      await expect.poll(listeners).toBeGreaterThan(before)
      await page.frames().find(frame => frame.url() === `${origin}/frame`)!.evaluate(() => history.pushState({}, '', '/ready?source=iframe'))
      const target = `${origin}/ready?source=main`
      if (navigation === 'same-document') await page.evaluate(url => history.pushState({}, '', url), target)
      else await page.goto(target)
      const result = await waiting
      expect(result.isError, text(result)).not.toBe(true)
      expect(text(result)).toContain(target)
      expect(text(result)).not.toContain('source=iframe')
    } finally {
      await client.close()
      await closeFixtureServer(server)
    }
  })
}
