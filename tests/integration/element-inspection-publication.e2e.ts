import { createServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { BrowserState, HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, expectFixtureSuccess, test } from './fixtures.js'

const text = (result: CallToolResult) => result.content.filter(item => item.type === 'text').map(item => item.text).join('\n')

test.use({ trace: 'off', screenshot: 'off', video: 'off' })
const changes = ['unchanged', 'navigation', 'close', 'cancel', 'workspace access', 'workspace access ABA', 'ownership release', 'pause ABA', 'global pause ABA', 'replacement'] as const
for (const change of changes) {
  test(`default inspection publication after audit persistence across ${change}`, async ({ appWindow, electronApp, mcpPort, mcpToken }) => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html' })
      response.end('<!doctype html><title>Inspection lifecycle</title><style>#target{display:block}</style><button id="target">Synthetic public inspection target</button><button id="target">Second match</button>')
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing fixture port')
    const url = `http://127.0.0.1:${address.port}/`
    const client = new Client({ name: 'inspection-lifecycle', version: '1' })
    const abort = new AbortController()
    let pending: Promise<CallToolResult> | undefined
    try {
      await expect.poll(async () => { try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`)).ok } catch { return false } }).toBe(true)
      const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), { requestInit: { headers: { authorization: `Bearer ${mcpToken}` } } })
      let inspectionRequestId: string | number | undefined
      const send = transport.send.bind(transport)
      transport.send = async (message, options) => {
        if ('method' in message && message.method === 'tools/call' && 'id' in message
          && message.params?.name === 'browser_element_inspect') inspectionRequestId = message.id
        return send(message, options)
      }
      await client.connect(transport)
      const call = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args }) as Promise<CallToolResult>
      const createdWorkspace = await call('browser_workspaces', { action: 'create', storage: 'scratch', name: 'Inspection lifecycle' })
      expectFixtureSuccess(createdWorkspace, 'Fixture workspace creation must succeed')
      const workspace = JSON.parse(text(createdWorkspace)) as { id: string }
      expect(typeof workspace.id).toBe('string')
      const createdTab = await call('browser_new_tab', { workspaceId: workspace.id, url })
      expectFixtureSuccess(createdTab, 'Fixture tab creation must succeed')
      const state = JSON.parse(text(createdTab)) as BrowserState
      expect(typeof state.activeTabId).toBe('string')
      expect(state.activeTabId?.length).toBeGreaterThan(0)
      expect(state.tabs.some(tab => tab.id === state.activeTabId)).toBe(true)
      const tabId = state.activeTabId!
      await expect.poll(() => electronApp.evaluate(({ webContents }, url) => {
        const pages = webContents.getAllWebContents().filter(page => page.getURL() === url)
        return { found: pages.length > 0, ready: pages.some(page => !page.isLoading()) }
      }, url)).toEqual({ found: true, ready: true })
      expectFixtureSuccess(await call('browser_audit_receipts', { workspaceId: workspace.id, action: 'start' }), 'Synthetic audit start')
      await electronApp.evaluate(async ({ webContents }, url) => {
        const page = webContents.getAllWebContents().find(page => page.getURL() === url)!
        const execute = page.executeJavaScriptInIsolatedWorld
        const fs = (process.getBuiltinModule('fs') as typeof import('node:fs')).promises
        const { syncBuiltinESMExports } = process.getBuiltinModule('module') as typeof import('node:module')
        const original = fs.open
        let release!: () => void
        const gate = new Promise<void>(resolve => { release = resolve })
        const held = { held: false, settlements: 0, actionId: '', release, restore: () => { page.executeJavaScriptInIsolatedWorld = execute; fs.open = original; syncBuiltinESMExports() } }
        ;(globalThis as typeof globalThis & { __auditHeld?: typeof held }).__auditHeld = held
        page.executeJavaScriptInIsolatedWorld = async function (...args) {
          if (args[0] === 1006 && args[1].some(script => script.code.includes('handle.settle()'))) held.settlements += 1
          return execute.apply(this, args)
        }
        fs.open = async function (...args) {
          const handle = await original.apply(this, args)
          if (String(args[0]).includes('/audit-receipts/') && args[1] === 'a') {
            const write = handle.writeFile.bind(handle)
            handle.writeFile = async (data, options) => {
              const event = JSON.parse(String(data)).event as { phase: string; toolName?: string; actionId?: string }
              if (event.phase === 'decision' && event.toolName === 'browser_element_inspect') held.actionId = event.actionId!
              if (event.phase === 'outcome' && event.actionId === held.actionId && !held.held) {
                held.held = true
                await gate
              }
              return write(data, options)
            }
          }
          return handle
        }
        syncBuiltinESMExports()
      }, url)
      pending = (client.callTool({ name: 'browser_element_inspect', arguments: { workspaceId: workspace.id, tabId, selector: '#target', includeScroll: true } }, undefined, { signal: abort.signal }) as Promise<CallToolResult>).catch(() => ({ isError: true, content: [{ type: 'text', text: 'Client cancelled' }] }))
      await expect.poll(() => electronApp.evaluate(() => (globalThis as typeof globalThis & { __auditHeld?: { held: boolean } }).__auditHeld?.held)).toBe(true)
      if (change === 'navigation') {
        await electronApp.evaluate(async ({ webContents }, url) => {
          await webContents.getAllWebContents().find(page => page.getURL() === url)!.loadURL(`${url}?next`)
        }, url)
      } else if (change === 'close') {
        await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.closeTab(id), tabId)
      } else if (change === 'ownership release') {
        const released = await call('browser_workspaces', { action: 'release-ownership', workspaceId: workspace.id })
        expect(released.isError, text(released)).not.toBe(true)
      } else if (change === 'pause ABA') {
        await appWindow.evaluate(async id => { const api = (window as unknown as { hronaut: HronautApi }).hronaut; await api.setTabAgentPaused(id, true); await api.setTabAgentPaused(id, false) }, tabId)
      } else if (change === 'global pause ABA') {
        await appWindow.evaluate('window.hronautMcp.setPaused(true).then(()=>window.hronautMcp.setPaused(false))')
      } else if (change === 'workspace access ABA') {
        await appWindow.evaluate(async id => { const api = (window as unknown as { hronaut: HronautApi }).hronaut; await api.updateTabGroup(id, { agentAccess: false }); await api.updateTabGroup(id, { agentAccess: true }) }, workspace.id)
      } else if (change === 'cancel') {
        if (inspectionRequestId === undefined) throw new Error('Missing synthetic request id')
        // Await transport delivery before releasing the held server operation.
        await client.notification({ method: 'notifications/cancelled', params: { requestId: inspectionRequestId, reason: 'Synthetic cancellation' } })
        abort.abort()
      } else if (change === 'replacement') {
        await electronApp.evaluate(async ({ webContents }, url) => {
          await webContents.getAllWebContents().find(page => page.getURL() === url)!.executeJavaScript('const node=document.querySelector("#target");node.replaceWith(node.cloneNode(true));void 0', false)
        }, url)
      } else if (change === 'workspace access') {
        await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.updateTabGroup(id, { agentAccess: false }), workspace.id)
      }
      await electronApp.evaluate(() => (globalThis as typeof globalThis & { __auditHeld?: { release(): void } }).__auditHeld?.release())
      const result = await pending
      if (change === 'ownership release' || change === 'unchanged' || change === 'replacement') {
        expect(result.isError).not.toBe(true)
        const inspection = JSON.parse(text(result))
        expect(inspection.accessibility).toHaveProperty('focused')
        expect(text(result)).toContain('Synthetic public inspection target')
        expect(text(result)).not.toContain('Second match')
        expect(inspection).not.toHaveProperty('passwordOccupancy')
        if (change === 'ownership release') {
          // Releasing write ownership retains read authorization. Inspection must not reclaim it.
          const write = await call('browser_press', { workspaceId: workspace.id, tabId, key: 'Tab' })
          expect(write.isError).toBe(true)
        }
      } else {
        expect(result.isError).toBe(true)
        expect(text(result)).not.toContain('Synthetic public inspection target')
      }
      expect(await electronApp.evaluate(() => (globalThis as typeof globalThis & { __auditHeld?: { settlements: number } }).__auditHeld?.settlements)).toBe(0)
      if (change === 'navigation') expect(text(result)).toContain('changed during element inspection')
      if (change === 'cancel') {
        await expect.poll(() => electronApp.evaluate(async ({ webContents }) => {
          const home = webContents.getAllWebContents().find(contents => contents.getURL().startsWith('hronaut://home'))
          if (!home) return false
          return home.executeJavaScript("fetch('/api/status').then(r=>r.json()).then(s=>s.recentActivity.some(a=>a.toolName==='browser_element_inspect'&&a.result.outcome==='cancelled'))")
        })).toBe(true)
      }
    } finally {
      await electronApp.evaluate(() => {
        const scope = globalThis as typeof globalThis & { __auditHeld?: { release(): void; restore(): void } }
        scope.__auditHeld?.release()
        scope.__auditHeld?.restore()
        delete scope.__auditHeld
      }).catch(() => undefined)
      await pending?.catch(() => undefined)
      await client.close().catch(() => undefined)
      await closeFixtureServer(server)
    }
  })
}
