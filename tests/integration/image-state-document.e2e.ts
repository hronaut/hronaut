import { createServer, type ServerResponse } from 'node:http'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { test, expect, text } from './capability-fixtures.js'
import { closeFixtureServer } from './fixtures.js'

type Gate = { held: boolean; listeners: number; release(): void; restore(): void }
type Scope = typeof globalThis & { __imageDocumentGate?: Gate }
for (const reload of [false, true]) test(`image state ${reload ? 'rejects an already-started same-URL commit' : 'accepts an unchanged retained document'}`, async ({ capabilities, electronApp }, info) => {
  const { client, tabId } = capabilities
  let hold = false, response: ServerResponse | undefined, navigation: Promise<void> | undefined, pending: Promise<CallToolResult> | undefined
  const html = '<!doctype html><link rel="icon" href="data:,"><img id="target">'
  const server = createServer((_request, reply) => { if (hold) response = reply; else { reply.setHeader('Content-Type', 'text/html'); reply.end(html) } })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`
  try {
    expect((await client.callTool({ name: 'browser_navigate', arguments: { tabId, url } })).isError).not.toBe(true)
    const id = await electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(p => p.getURL() === url)!.id, url)
    await electronApp.evaluate(({ webContents }, id) => {
      const page = webContents.fromId(id)!, original = page.executeJavaScriptInIsolatedWorld
      let release!: () => void
      const wait = new Promise<void>(resolve => { release = resolve })
      const gate: Gate = { held: false, listeners: page.listenerCount('did-navigate'), release, restore: () => { page.executeJavaScriptInIsolatedWorld = original } }
      ;(globalThis as Scope).__imageDocumentGate = gate
      page.executeJavaScriptInIsolatedWorld = async function (...args) {
        if (args[0] === 1022 && args[1][0]!.code.includes('const selector=')) { gate.held = true; await wait }
        return original.apply(this, args)
      }
    }, id)
    if (reload) {
      hold = true
      navigation = electronApp.evaluate(async ({ webContents }, { id, url }) => { await webContents.fromId(id)!.loadURL(url) }, { id, url })
      await expect.poll(() => Boolean(response)).toBe(true)
    }
    pending = client.callTool({ name: 'browser_image_state', arguments: { tabId, selector: '#target' } }) as Promise<CallToolResult>
    await expect.poll(() => electronApp.evaluate(() => (globalThis as Scope).__imageDocumentGate!.held)).toBe(true)
    expect(await electronApp.evaluate(({ webContents }, id) => webContents.fromId(id)!.listenerCount('did-navigate') - (globalThis as Scope).__imageDocumentGate!.listeners, id)).toBe(1)
    if (reload) { response!.setHeader('Content-Type', 'text/html'); response!.end(html); await navigation }
    await electronApp.evaluate(() => (globalThis as Scope).__imageDocumentGate!.release())
    const result = await pending
    const listenerDelta = await electronApp.evaluate(({ webContents }, id) => webContents.fromId(id)!.listenerCount('did-navigate') - (globalThis as Scope).__imageDocumentGate!.listeners, id)
    await info.attach('image-document-commit', { body: JSON.stringify({ reload, result, listenerDelta }), contentType: 'application/json' })
    expect(result.isError === true).toBe(reload)
    if (reload) { expect(text(result)).toContain('changed during image inspection'); expect(text(result)).not.toContain('observedAt') }
    else expect(JSON.parse(text(result))).toMatchObject({ complete: true })
    expect(listenerDelta).toBe(0)
  } finally {
    if (response && !response.writableEnded) response.end(html)
    await navigation?.catch(() => undefined)
    await electronApp.evaluate(() => { const gate = (globalThis as Scope).__imageDocumentGate; gate?.release(); gate?.restore(); delete (globalThis as Scope).__imageDocumentGate })
    await pending?.catch(() => undefined)
    await closeFixtureServer(server)
  }
})
