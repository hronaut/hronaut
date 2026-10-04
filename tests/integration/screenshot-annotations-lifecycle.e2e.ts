import { createServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { BrowserState, HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

const text = (result: CallToolResult) => result.content.filter(item => item.type === 'text').map(item => item.text).join('\n')

type Change = 'navigation' | 'close' | 'pause' | 'global pause' | 'workspace access' | 'ownership release' | 'movement' | 'replacement' | 'scroll'
for (const change of ['navigation', 'close', 'pause', 'global pause', 'workspace access', 'ownership release', 'movement', 'replacement', 'scroll'] as Change[]) {
  test(`guards annotated screenshots across ${change}`, async ({ appWindow, electronApp, mcpPort, mcpToken }) => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html' })
      response.end('<!doctype html><title>Screenshot lifecycle</title><style>body{height:2000px}#target{display:block}</style><button id="target" autofocus>Old inspection evidence</button>')
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing fixture port')
    const url = `http://127.0.0.1:${address.port}/`
    const client = new Client({ name: 'screenshot-lifecycle', version: '1' })
    let pending: Promise<CallToolResult> | undefined
    try {
      await expect.poll(async () => { try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`)).ok } catch { return false } }).toBe(true)
      await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), { requestInit: { headers: { authorization: `Bearer ${mcpToken}` } } }))
      const call = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args }) as Promise<CallToolResult>
      const workspace = JSON.parse(text(await call('browser_workspaces', { action: 'create', storage: 'scratch', name: 'Screenshot lifecycle' }))) as { id: string }
      const state = JSON.parse(text(await call('browser_new_tab', { workspaceId: workspace.id, url }))) as BrowserState
      const tabId = state.activeTabId!
      await expect.poll(() => electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents().some(page => page.getURL() === url && !page.isLoading()), url)).toBe(true)
      await call('browser_snapshot', { workspaceId: workspace.id, tabId })
      await electronApp.evaluate(({ webContents }, url) => {
        const page = webContents.getAllWebContents().find(page => page.getURL() === url)!
        const original = page.capturePage
        const originalExecute = page.executeJavaScriptInIsolatedWorld
        let release!: () => void
        const gate = new Promise<void>(resolve => { release = resolve })
        let armed = false
        const held = { held: false, release, restore: () => { page.capturePage = original; page.executeJavaScriptInIsolatedWorld = originalExecute } }
        ;(globalThis as typeof globalThis & { __screenshotHeld?: typeof held }).__screenshotHeld = held
        page.executeJavaScriptInIsolatedWorld = async function (...args) {
          const result = await originalExecute.apply(this, args)
          if (args[0] === 1018) armed = true
          return result
        }
        page.capturePage = async function (...args) {
          const value = await original.apply(this, args)
          if (armed && !held.held) {
            held.held = true
            await gate
            held.restore()
          }
          return value
        }
      }, url)
      pending = call('browser_screenshot', { workspaceId: workspace.id, tabId, annotateRefs: ['e1'] })
      await expect.poll(() => electronApp.evaluate(() => (globalThis as typeof globalThis & { __screenshotHeld?: { held: boolean } }).__screenshotHeld?.held)).toBe(true)
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
        // Screenshot keeps the existing exclusive operation lease while capture is pending.
        expect(released.isError).toBe(true)
        expect(text(released)).toContain('WORKSPACE_BUSY')
      } else if (change === 'movement' || change === 'replacement' || change === 'scroll') {
        await electronApp.evaluate(async ({ webContents }, { url, change }) => {
          const page = webContents.getAllWebContents().find(page => page.getURL() === url)!
          await page.executeJavaScript(change === 'movement'
            ? "document.querySelector('#target').style.marginLeft='80px'; void 0"
            : change === 'scroll' ? 'scrollTo(0,100); void 0'
            : "const node=document.querySelector('#target'); node.replaceWith(node.cloneNode(true)); void 0")
        }, { url, change })
      } else {
        await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.updateTabGroup(id, { agentAccess: false }), workspace.id)
      }
      await electronApp.evaluate(() => (globalThis as typeof globalThis & { __screenshotHeld?: { release(): void } }).__screenshotHeld?.release())
      const result = await pending
      if (change === 'ownership release') {
        // The pending capture finishes before ownership can be released.
        expect(result.isError, text(result)).not.toBe(true)
        expect(JSON.parse(text(result)).annotations[0].status).toBe('labeled')
        const released = await call('browser_workspaces', { action: 'release-ownership', workspaceId: workspace.id })
        expect(released.isError, text(released)).not.toBe(true)
        const write = await call('browser_press', { workspaceId: workspace.id, tabId, key: 'Tab' })
        expect(write.isError).toBe(true)
      } else if (change === 'replacement' || change === 'movement') {
        expect(result.isError, text(result)).not.toBe(true)
        expect(JSON.parse(text(result)).annotations[0].status).toBe(change === 'replacement' ? 'changed' : 'moved')
        expect(JSON.parse(text(result)).annotations[0]).not.toHaveProperty('labelBounds')
      } else {
        expect(result.isError, text(result)).toBe(true)
        expect(result.content.some(item => item.type === 'image')).toBe(false)
        expect(text(result)).not.toContain('Old inspection evidence')
      }
      if (change === 'navigation') expect(text(result)).toContain('changed during annotated screenshot')
      if (!['navigation', 'close'].includes(change)) {
        expect(await electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(page => page.getURL() === url)!.executeJavaScriptInIsolatedWorld(1018, [{ code: 'globalThis.__hronautScreenshotAnnotations?.size ?? 0' }]), url)).toBe(0)
      }
    } finally {
      await electronApp.evaluate(() => {
        const scope = globalThis as typeof globalThis & { __screenshotHeld?: { release(): void; restore(): void } }
        scope.__screenshotHeld?.release()
        scope.__screenshotHeld?.restore()
        delete scope.__screenshotHeld
      }).catch(() => undefined)
      await pending?.catch(() => undefined)
      await client.close().catch(() => undefined)
      await closeFixtureServer(server)
    }
  })
}
