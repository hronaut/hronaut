import { createServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { BrowserState, HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

const text = (result: CallToolResult) => result.content.filter(item => item.type === 'text').map(item => item.text).join('\n')

type InspectionChange = 'navigation' | 'close' | 'pause' | 'global pause' | 'workspace access' | 'ownership release' | 'stylesheet' | 'replacement'
for (const { change, cssProperties } of (['navigation', 'close', 'pause', 'global pause', 'workspace access', 'ownership release'] as InspectionChange[])
  .flatMap(change => ([undefined, ['display']] as const).map(cssProperties => ({ change, cssProperties })))
  .concat((['stylesheet', 'replacement'] as const).map(change => ({ change, cssProperties: ['display'] as const })))) {
  test(`${change === 'ownership release' ? 'preserves authorized read-only inspection across' : 'discards element inspection captured before'} ${change}${cssProperties ? ' with CSS provenance' : ''}`, async ({ appWindow, electronApp, mcpPort, mcpToken }) => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html' })
      response.end('<!doctype html><title>Inspection lifecycle</title><style>#target{display:block}</style><button id="target" autofocus>Old inspection evidence</button>')
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing fixture port')
    const url = `http://127.0.0.1:${address.port}/`
    const client = new Client({ name: 'inspection-lifecycle', version: '1' })
    let pending: Promise<CallToolResult> | undefined
    try {
      await expect.poll(async () => { try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`)).ok } catch { return false } }).toBe(true)
      await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), { requestInit: { headers: { authorization: `Bearer ${mcpToken}` } } }))
      const call = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args }) as Promise<CallToolResult>
      const workspace = JSON.parse(text(await call('browser_workspaces', { action: 'create', storage: 'scratch', name: 'Inspection lifecycle' }))) as { id: string }
      const state = JSON.parse(text(await call('browser_new_tab', { workspaceId: workspace.id, url }))) as BrowserState
      const tabId = state.activeTabId!
      await expect.poll(() => electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents().some(page => page.getURL() === url && !page.isLoading()), url)).toBe(true)
      await electronApp.evaluate(({ webContents }, url) => {
        const page = webContents.getAllWebContents().find(page => page.getURL() === url)!
        const original = page.executeJavaScriptInIsolatedWorld
        let release!: () => void
        const gate = new Promise<void>(resolve => { release = resolve })
        const held = { held: false, release, restore: () => { page.executeJavaScriptInIsolatedWorld = original } }
        ;(globalThis as typeof globalThis & { __inspectionHeld?: typeof held }).__inspectionHeld = held
        page.executeJavaScriptInIsolatedWorld = async function (...args) {
          const value = await original.apply(this, args)
          if (args[0] === 1006 && !held.held) {
            held.held = true
            await gate
            held.restore()
          }
          return value
        }
      }, url)
      pending = call('browser_element_inspect', { workspaceId: workspace.id, tabId, selector: '#target', ...(cssProperties ? { cssProperties } : {}) })
      await expect.poll(() => electronApp.evaluate(() => (globalThis as typeof globalThis & { __inspectionHeld?: { held: boolean } }).__inspectionHeld?.held)).toBe(true)
      if (change === 'navigation') {
        await electronApp.evaluate(async ({ webContents }, url) => {
          await webContents.getAllWebContents().find(page => page.getURL() === url)!.loadURL(`${url}?next`)
        }, url)
      } else if (change === 'close') {
        await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.closeTab(id), tabId)
      } else if (change === 'pause') {
        await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.setTabAgentPaused(id, true), tabId)
      } else if (change === 'global pause') {
        await appWindow.evaluate('window.hronautMcp.setPaused(true)')
      } else if (change === 'ownership release') {
        const released = await call('browser_workspaces', { action: 'release-ownership', workspaceId: workspace.id })
        expect(released.isError, text(released)).not.toBe(true)
      } else if (change === 'stylesheet' || change === 'replacement') {
        await electronApp.evaluate(async ({ webContents }, { url, change }) => {
          const page = webContents.getAllWebContents().find(page => page.getURL() === url)!
          await page.executeJavaScript(change === 'stylesheet'
            ? "document.styleSheets[0].insertRule('#target{opacity:0.5}'); void 0"
            : "document.querySelector('#target').outerHTML = '<button id=target>Replacement</button>'; void 0")
        }, { url, change })
      } else {
        await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.updateTabGroup(id, { agentAccess: false }), workspace.id)
      }
      await electronApp.evaluate(() => (globalThis as typeof globalThis & { __inspectionHeld?: { release(): void } }).__inspectionHeld?.release())
      const result = await pending
      if (change === 'ownership release') {
        // Releasing write ownership retains read authorization. Inspection must not reclaim it.
        expect(result.isError, text(result)).not.toBe(true)
        expect(JSON.parse(text(result)).accessibility).toHaveProperty('focused')
        const write = await call('browser_press', { workspaceId: workspace.id, tabId, key: 'Tab' })
        expect(write.isError).toBe(true)
      } else {
        expect(result.isError, text(result)).toBe(true)
        expect(text(result)).not.toContain('Old inspection evidence')
      }
      if (change === 'navigation') expect(text(result)).toContain('changed during element inspection')
      if (change === 'stylesheet' || change === 'replacement') expect(text(result)).toContain('changed during CSS provenance')
    } finally {
      await electronApp.evaluate(() => {
        const scope = globalThis as typeof globalThis & { __inspectionHeld?: { release(): void; restore(): void } }
        scope.__inspectionHeld?.release()
        scope.__inspectionHeld?.restore()
        delete scope.__inspectionHeld
      }).catch(() => undefined)
      await pending?.catch(() => undefined)
      await client.close().catch(() => undefined)
      await closeFixtureServer(server)
    }
  })
}
