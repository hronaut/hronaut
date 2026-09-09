import { createServer, type ServerResponse } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

for (const inputKind of ['mouse', 'keyboard'] as const) {
test(`discards an in-flight write result after direct human ${inputKind} input without requiring a pause`, async ({ electronApp, mcpPort, mcpToken }) => {
  let held: ServerResponse | undefined
  const fixture = createServer((request, response) => {
    if (request.url === '/hold') { held = response; return }
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><style>button{width:300px;height:200px}</style><body onkeydown="document.body.dataset.human=\'yes\'"><button onmousedown="document.body.dataset.human=\'yes\'">Human action</button>')
  })
  await new Promise<void>(resolve => fixture.listen(0, '127.0.0.1', resolve))
  const address = fixture.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const origin = `http://127.0.0.1:${address.port}`
  const client = new Client({ name: 'human-input-handoff', version: '1' })
  const call = async (name: string, args: Record<string, unknown>) => await client.callTool({ name, arguments: args }) as CallToolResult
  const parse = (result: CallToolResult): { id: string } => {
    expect(result.isError).not.toBe(true)
    return JSON.parse(result.content.filter(part => part.type === 'text').map(part => part.text).join('\n')) as { id: string }
  }
  try {
    await expect.poll(async () => {
      try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`)).ok } catch { return false }
    }).toBe(true)
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${mcpToken}` } }
    }))
    const workspace = parse(await call('browser_workspaces', { action: 'create', name: 'Human input', storage: 'scratch' }))
    const args = { workspaceId: workspace.id }
    expect((await call('browser_new_tab', { ...args, url: origin })).isError).not.toBe(true)
    // MCP-generated input must not be mistaken for a human takeover.
    expect((await call('browser_click', { ...args, selector: 'button' })).isError).not.toBe(true)
    expect((await call('browser_evaluate', { ...args, script: 'delete document.body.dataset.human' })).isError).not.toBe(true)
    const pending = call('browser_evaluate', { ...args, script: "fetch('/hold').then(() => { document.body.dataset.effect = 'applied'; return 'stale-human-input-canary'; })" })
    void pending.catch(() => undefined)
    await expect.poll(() => Boolean(held)).toBe(true)
    await electronApp.evaluate(({ webContents }, { expectedOrigin, kind }) => {
      const page = webContents.getAllWebContents().find(page => page.getURL().startsWith(expectedOrigin))
      if (!page) throw new Error('Missing fixture page')
      page.focus()
      if (kind === 'keyboard') {
        page.sendInputEvent({ type: 'keyDown', keyCode: 'X' })
        page.sendInputEvent({ type: 'char', keyCode: 'X' })
        page.sendInputEvent({ type: 'keyUp', keyCode: 'X' })
      } else {
      page.sendInputEvent({ type: 'mouseDown', x: 80, y: 80, button: 'left', clickCount: 1 })
      page.sendInputEvent({ type: 'mouseUp', x: 80, y: 80, button: 'left', clickCount: 1 })
      }
    }, { expectedOrigin: origin, kind: inputKind })
    await expect.poll(() => electronApp.evaluate(async ({ webContents }, expectedOrigin) => {
      const page = webContents.getAllWebContents().find(page => page.getURL().startsWith(expectedOrigin))
      return page?.executeJavaScript('document.body.dataset.human')
    }, origin)).toBe('yes')
    held!.end('release')
    const result = await pending
    expect(result.isError).toBe(true)
    expect(result.structuredContent).toMatchObject({ status: 'OUTCOME_UNKNOWN', retrySafe: false })
    expect(JSON.stringify(result)).not.toContain('stale-human-input-canary')
    const fresh = await call('browser_evaluate', { ...args, script: 'document.body.dataset.effect' })
    expect(fresh.isError).not.toBe(true)
    expect(fresh.content).toContainEqual({ type: 'text', text: 'applied' })
  } finally {
    held?.end()
    await client.close()
    await closeFixtureServer(fixture)
  }
})
}
