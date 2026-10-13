import { createServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { BrowserState, HronautApi, HronautSettingsApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, expectFixtureSuccess, test } from './fixtures.js'

const text = (result: CallToolResult) => result.content.filter(item => item.type === 'text').map(item => item.text).join('\n')

test.use({ trace: 'off', screenshot: 'off', video: 'off' })
type InspectionChange = 'navigation' | 'close' | 'pause' | 'global pause' | 'workspace access' | 'ownership release' | 'replacement' | 'selector id ABA' | 'cancel' | 'pause ABA' | 'global pause ABA' | 'deadline' | 'workspace access ABA' | 'detach reinsert' | 'capability revoke' | 'audit failure'
for (const change of ['navigation', 'close', 'replacement', 'selector id ABA', 'cancel', 'workspace access ABA', 'ownership release', 'pause ABA', 'global pause ABA', 'detach reinsert', 'deadline', 'capability revoke', 'audit failure'] as InspectionChange[]) {
  test(`image state publication after audit persistence across ${change}`, async ({ appWindow, electronApp, mcpPort, mcpToken }, info) => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html' })
      response.end('<!doctype html><title>Image publication</title><img id="target" hidden>')
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
      const credential = change === 'capability revoke' ? await appWindow.evaluate(() => (window as unknown as { hronautSettings: HronautSettingsApi }).hronautSettings.createMcpCapabilityProfile({ name: 'Image publication fixture', preset: 'complete' })) : undefined
      const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), { requestInit: { headers: { authorization: `Bearer ${credential?.credential ?? mcpToken}` } } })
      let inspectionRequestId: string | number | undefined
      const send = transport.send.bind(transport)
      transport.send = async (message, options) => {
        if ('method' in message && message.method === 'tools/call' && 'id' in message
          && message.params?.name === 'browser_image_state') inspectionRequestId = message.id
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
      await electronApp.evaluate(async ({ webContents }, { url, change }) => {
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
          if (args[0] === 1022 && args[1].some(script => script.code.includes('handle.settle()'))) held.settlements += 1
          return execute.apply(this, args)
        }
        fs.open = async function (...args) {
          const handle = await original.apply(this, args)
          if (String(args[0]).includes('/audit-receipts/') && args[1] === 'a') {
            const write = handle.writeFile.bind(handle)
            handle.writeFile = async (data, options) => {
              const event = JSON.parse(String(data)).event as { phase: string; toolName?: string; actionId?: string }
              if (event.phase === 'decision' && event.toolName === 'browser_image_state') held.actionId = event.actionId!
              if (event.phase === 'outcome' && event.actionId === held.actionId && !held.held) {
                held.held = true
                await gate
                if (change === 'audit failure') throw new Error('Synthetic image audit persistence failure')
              }
              return write(data, options)
            }
          }
          return handle
        }
        syncBuiltinESMExports()
      }, { url, change })
      pending = (client.callTool({ name: 'browser_image_state', arguments: { workspaceId: workspace.id, tabId, selector: '#target' } }, undefined, { signal: abort.signal }) as Promise<CallToolResult>).catch(error => { if (change !== 'cancel') throw error; return { isError: true, content: [{ type: 'text', text: 'Client cancelled' }] } })
      await expect.poll(() => electronApp.evaluate(() => (globalThis as typeof globalThis & { __auditHeld?: { held: boolean } }).__auditHeld?.held)).toBe(true)
      if (change === 'capability revoke') {
        const revoked = await appWindow.evaluate(id => (window as unknown as { hronautSettings: HronautSettingsApi }).hronautSettings.revokeMcpCapabilityProfile(id), credential!.profile.id)
        expect(revoked.id).toBe(credential!.profile.id)
        expect(revoked.revokedAt).toBeTruthy()
      } else if (change === 'audit failure') {
        // The held write rejects only after the native observation has succeeded.
      } else if (change === 'navigation') {
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
      } else if (change === 'pause ABA') {
        await appWindow.evaluate(async id => { const api = (window as unknown as { hronaut: HronautApi }).hronaut; await api.setTabAgentPaused(id, true); await api.setTabAgentPaused(id, false) }, tabId)
      } else if (change === 'global pause ABA') {
        await appWindow.evaluate('window.hronautMcp.setPaused(true).then(()=>window.hronautMcp.setPaused(false))')
      } else if (change === 'detach reinsert') {
        await electronApp.evaluate(async ({ webContents }, url) => { await webContents.getAllWebContents().find(page => page.getURL() === url)!.executeJavaScript('const node=target;node.remove();document.body.append(node);void 0', false) }, url)
      } else if (change === 'workspace access ABA') {
        await appWindow.evaluate(async id => { const api = (window as unknown as { hronaut: HronautApi }).hronaut; await api.updateTabGroup(id, { agentAccess: false }); await api.updateTabGroup(id, { agentAccess: true }) }, workspace.id)
      } else if (change === 'deadline') {
        const guardCount = () => electronApp.evaluate(async ({ webContents }, url) => {
          const page = webContents.getAllWebContents().find(page => page.getURL() === url)!
          return page.executeJavaScriptInIsolatedWorld(1022, [{ code: 'globalThis.__hronautImageState?.size ?? 0' }], false)
        }, url)
        expect(await guardCount()).toBe(1)
        await expect.poll(guardCount, { timeout: 8_000 }).toBe(0)
      } else if (change === 'cancel') {
        if (inspectionRequestId === undefined) throw new Error('Missing synthetic request id')
        // Await transport delivery before releasing the held server operation.
        await client.notification({ method: 'notifications/cancelled', params: { requestId: inspectionRequestId, reason: 'Synthetic cancellation' } })
        abort.abort()
      } else if (change === 'replacement' || change === 'selector id ABA') {
        await electronApp.evaluate(async ({ webContents }, { url, change }) => {
          const page = webContents.getAllWebContents().find(page => page.getURL() === url)!
          await page.executeJavaScript(change === 'selector id ABA'
            ? "const node=target;node.id='other';node.id='target';void 0"
            : "target.replaceWith(target.cloneNode());void 0", false)
        }, { url, change })
      } else {
        await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.updateTabGroup(id, { agentAccess: false }), workspace.id)
      }
      await electronApp.evaluate(() => (globalThis as typeof globalThis & { __auditHeld?: { release(): void } }).__auditHeld?.release())
      const result = await pending
      const activity = () => electronApp.evaluate(async ({ webContents }) => {
        const home = webContents.getAllWebContents().find(p => p.getURL().startsWith('hronaut://home'))!
        // Query the trusted session directly; activity is main-owned and must not depend on Home renderer navigation.
        const response = await home.session.fetch('hronaut://home/api/status')
        const state = await response.json() as { recentActivity: Array<{ toolName: string; outcome: string; result: { outcome: string; effects: string } }> }
        return state.recentActivity.filter(item => item.toolName === 'browser_image_state')
      })
      await expect.poll(async () => (await activity()).length).toBe(1)
      const terminal = await activity()
      await info.attach('image-final-activity', { body: JSON.stringify({ change, result, terminal }), contentType: 'application/json' })
      const accepted = ['ownership release', 'detach reinsert', 'selector id ABA'].includes(change)
      expect(terminal).toHaveLength(1)
      expect(terminal[0]!.outcome).toBe(accepted ? 'finished' : 'failed')
      if (accepted) expect(terminal[0]!.result.outcome).toBe('succeeded')
      else expect(terminal[0]!.result.outcome).not.toBe('succeeded')
      if (change === 'ownership release') {
        // Releasing write ownership retains read authorization. Inspection must not reclaim it.
        expect(result.isError, text(result)).not.toBe(true)
        expect(JSON.parse(text(result))).toMatchObject({ complete: true, naturalWidth: 0, naturalHeight: 0 })
        const write = await call('browser_press', { workspaceId: workspace.id, tabId, key: 'Tab' })
        expect(write.isError).toBe(true)
      } else if (change === 'detach reinsert' || change === 'selector id ABA') {
        // Native identity is sampled; same-object ABA between samples is not observed.
        expect(result.isError, text(result)).not.toBe(true)
        expect(JSON.parse(text(result))).toMatchObject({ complete: true })
      } else {
        expect(result.isError).toBe(true)
        expect(text(result)).not.toContain('observedAt')
      }
      // Trusted revocation also changes control authority, which rejects before the outer capability check.
      if (change === 'capability revoke') {
        expect(text(result)).toBe('MCP control changed before tool dispatch. Inspect the page and obtain fresh state before continuing; earlier page wake or navigation is not rolled back.')
        expect(terminal[0]!.result.effects).toBe('none')
      }
      if (change === 'audit failure') {
        expect(text(result)).toContain('audit outcome could not be saved')
        expect(text(result)).not.toContain('Synthetic image audit persistence failure')
      }
      if (change === 'navigation') expect(text(result)).toContain('changed during image inspection')
      if (change === 'cancel') {
        expect(terminal[0]!.result.outcome).toBe('cancelled')
        expect(await electronApp.evaluate(() => (globalThis as typeof globalThis & { __auditHeld?: { settlements: number } }).__auditHeld?.settlements)).toBe(0)
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
