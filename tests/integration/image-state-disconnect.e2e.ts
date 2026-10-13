import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { connectMcpWorkspace } from '../../scripts/mcp-workspace.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { test, expect, text } from './capability-fixtures.js'

type Gate = { baselineListeners: number; reads: number; settlements: number; cleanups: number; finishedCleanups: number; releaseReads(): void; releaseCleanup(): void; restore(): void }
type Scope = typeof globalThis & { __imageSlotGate?: Gate }
test.use({ trace: 'off', screenshot: 'off', video: 'off' })
test('actual image client disconnect retains native work and cleanup ownership', async ({ capabilities, electronApp, mcpPort, mcpToken }, info) => {
  const { client, tabId, fixtureUrl } = capabilities
  const replacement = new Client({ name: 'image-reconnected', version: '1' })
  const transport = client.transport as StreamableHTTPClientTransport
  const received: string[] = []
  let cancellations = 0
  const onmessage = transport.onmessage!
  transport.onmessage = message => { received.push(JSON.stringify(message)); onmessage(message) }
  const send = transport.send.bind(transport)
  transport.send = (message, options) => { if ('method' in message && message.method === 'notifications/cancelled') cancellations++; return send(message, options) }
  const pending: Array<Promise<CallToolResult>> = []
  await electronApp.evaluate(async ({ webContents }, url) => {
    const page = webContents.getAllWebContents().find(p => p.getURL() === url)!
    await page.executeJavaScript("document.body.innerHTML='<img id=target>';void 0")
    const original = page.executeJavaScriptInIsolatedWorld
    let releaseReads!: () => void, releaseCleanup!: () => void
    const reads = new Promise<void>(resolve => { releaseReads = resolve })
    const cleanup = new Promise<void>(resolve => { releaseCleanup = resolve })
    const state: Gate = { baselineListeners: page.listenerCount('did-navigate'), reads: 0, settlements: 0, cleanups: 0, finishedCleanups: 0, releaseReads, releaseCleanup, restore: () => { page.executeJavaScriptInIsolatedWorld = original } }
    ;(globalThis as Scope).__imageSlotGate = state
    page.executeJavaScriptInIsolatedWorld = async function (...args) {
      const code = args[1][0]!.code
      if (args[0] === 1022 && code.includes('handle.settle()')) state.settlements++
      if (args[0] === 1022 && code.includes('const selector=')) {
        state.reads++
        const value = await original.apply(this, args)
        await reads
        return value
      }
      if (args[0] === 1022 && code.includes('handle?.cleanup()')) {
        state.cleanups++
        await cleanup
        const value = await original.apply(this, args)
        state.finishedCleanups++
        return value
      }
      return original.apply(this, args)
    }
  }, fixtureUrl)
  let currentClient = client
  const inspect = () => currentClient.callTool({ name: 'browser_image_state', arguments: { tabId, selector: '#target' } }) as Promise<CallToolResult>
  try {
    for (let i = 0; i < 8; i++) { const request = inspect(); void request.catch(() => undefined); pending.push(request) }
    await expect.poll(() => electronApp.evaluate(() => (globalThis as Scope).__imageSlotGate!.reads)).toBe(8)
    // DELETE closes the actual HTTP MCP session; no cancellation notification or AbortController is used.
    expect(transport.sessionId).toBeTruthy()
    await transport.terminateSession()
    await client.close()
    const results = await Promise.allSettled(pending)
    expect(results.every(result => result.status === 'rejected')).toBe(true)
    expect(cancellations).toBe(0)
    expect(received.join('\n')).not.toContain('observedAt')
    await replacement.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), { requestInit: { headers: { authorization: `Bearer ${mcpToken}` } } }))
    await connectMcpWorkspace(replacement, 'Image reconnect', false, capabilities.workspace)
    currentClient = replacement
    expect(text(await inspect())).toContain('inspection busy')
    await expect.poll(() => electronApp.evaluate(() => (globalThis as Scope).__imageSlotGate!.cleanups)).toBe(8)
    expect(text(await inspect())).toContain('inspection busy')
    await electronApp.evaluate(() => (globalThis as Scope).__imageSlotGate!.releaseReads())
    expect(text(await inspect())).toContain('inspection busy')
    await electronApp.evaluate(() => (globalThis as Scope).__imageSlotGate!.releaseCleanup())
    await expect.poll(() => electronApp.evaluate(() => (globalThis as Scope).__imageSlotGate!.finishedCleanups)).toBe(8)
    const receipt = await electronApp.evaluate(() => { const s = (globalThis as Scope).__imageSlotGate!; return { reads: s.reads, cleanups: s.cleanups, finishedCleanups: s.finishedCleanups, settlements: s.settlements } })
    await info.attach('native-slot-lifetime', { body: JSON.stringify(receipt), contentType: 'application/json' })
    expect(receipt).toEqual({ reads: 8, cleanups: 8, finishedCleanups: 8, settlements: 0 })
    const activity = await electronApp.evaluate(async ({ webContents }) => {
      const home = webContents.getAllWebContents().find(p => p.getURL().startsWith('hronaut://home'))!
      const response = await home.session.fetch('hronaut://home/api/status')
      const state = await response.json() as { recentActivity: Array<{ toolName: string; outcome: string; result: { outcome: string; effects: string } }> }
      return state.recentActivity.filter(item => item.toolName === 'browser_image_state')
    })
    expect(activity).toHaveLength(11)
    expect(activity.every(item => item.outcome === 'failed' && item.result.effects === 'none')).toBe(true)
    expect(activity.filter(item => item.result.outcome === 'cancelled')).toHaveLength(8)
    const cleanupProof = await electronApp.evaluate(async ({ webContents }, url) => {
      const page = webContents.getAllWebContents().find(p => p.getURL() === url)!
      return { listenerDelta: page.listenerCount('did-navigate') - (globalThis as Scope).__imageSlotGate!.baselineListeners, handles: await page.executeJavaScriptInIsolatedWorld(1022, [{ code: 'globalThis.__hronautImageState?.size ?? 0' }], false) }
    }, fixtureUrl)
    expect(cleanupProof).toEqual({ listenerDelta: 0, handles: 0 })
    await info.attach('disconnect-terminal-proof', { body: JSON.stringify({ cancellationsSent: cancellations, rejectedRequests: results.length, activity, cleanupProof }), contentType: 'application/json' })
    await electronApp.evaluate(() => (globalThis as Scope).__imageSlotGate!.restore())
    const recovered = await inspect()
    expect(recovered.isError, text(recovered)).not.toBe(true)
  } finally {
    await electronApp.evaluate(() => { const s = (globalThis as Scope).__imageSlotGate; s?.releaseReads(); s?.releaseCleanup(); s?.restore(); delete (globalThis as Scope).__imageSlotGate })
    await Promise.allSettled(pending)
    await replacement.close().catch(() => undefined)
  }
})
