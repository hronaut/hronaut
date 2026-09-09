import { createServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

test('rejects a checkpoint when a write starts and finishes during its marker read', async ({ electronApp, mcpPort, mcpToken }) => {
  const fixture = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><main id="marker">Before</main>')
  })
  await new Promise<void>(resolve => fixture.listen(0, '127.0.0.1', resolve))
  const address = fixture.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture address')
  const origin = `http://127.0.0.1:${address.port}`
  const client = new Client({ name: 'continuity-action-race', version: '1' })
  const call = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args }) as Promise<CallToolResult>
  const decode = <T>(result: CallToolResult): T => {
    expect(result.isError).not.toBe(true)
    return JSON.parse(result.content.filter(part => part.type === 'text').map(part => part.text).join('\n')) as T
  }
  let pending: Promise<CallToolResult> | undefined
  try {
    await expect.poll(async () => { try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`)).ok } catch { return false } }).toBe(true)
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), { requestInit: { headers: { authorization: `Bearer ${mcpToken}` } } }))
    const workspace = decode<{ id: string }>(await call('browser_workspaces', { action: 'create', storage: 'scratch', name: 'Marker action race' }))
    const args = { workspaceId: workspace.id }
    decode(await call('browser_new_tab', { ...args, url: origin }))
    await expect.poll(() => electronApp.evaluate(({ webContents }, origin) => webContents.getAllWebContents().some(page => page.getURL().startsWith(origin) && !page.isLoading()), origin)).toBe(true)
    await electronApp.evaluate(({ webContents }, origin) => {
      const page = webContents.getAllWebContents().find(page => page.getURL().startsWith(origin))!
      const original = page.executeJavaScriptInIsolatedWorld
      const state = globalThis as typeof globalThis & { __checkpointHeld?: boolean; __checkpointRelease?: () => void; __checkpointRestore?: () => void }
      state.__checkpointRestore = () => { page.executeJavaScriptInIsolatedWorld = original }
      page.executeJavaScriptInIsolatedWorld = async function (...args) {
        const value = await original.apply(this, args)
        if (args[0] !== 1011) return value
        page.executeJavaScriptInIsolatedWorld = original
        state.__checkpointHeld = true
        await new Promise<void>(resolve => { state.__checkpointRelease = resolve })
        return value
      }
    }, origin)
    pending = call('browser_continuity', { ...args, action: 'checkpoint', markerSelector: '#marker' })
    await expect.poll(() => electronApp.evaluate(() => (globalThis as typeof globalThis & { __checkpointHeld?: boolean }).__checkpointHeld)).toBe(true)
    const write = await call('browser_evaluate', { ...args, script: 'document.querySelector("main").textContent = "After"; "done"' })
    expect(write.isError).not.toBe(true)
    await electronApp.evaluate(() => (globalThis as typeof globalThis & { __checkpointRelease?: () => void }).__checkpointRelease?.())
    expect((await pending).isError).toBe(true)
    const fresh = await call('browser_continuity', { ...args, action: 'checkpoint', markerSelector: '#marker' })
    expect(fresh.isError).not.toBe(true)
  } finally {
    await electronApp.evaluate(() => {
      const state = globalThis as typeof globalThis & { __checkpointHeld?: boolean; __checkpointRelease?: () => void; __checkpointRestore?: () => void }
      state.__checkpointRelease?.(); state.__checkpointRestore?.()
      delete state.__checkpointHeld; delete state.__checkpointRelease; delete state.__checkpointRestore
    })
    await pending?.catch(() => undefined)
    await client.close()
    await closeFixtureServer(fixture)
  }
})
