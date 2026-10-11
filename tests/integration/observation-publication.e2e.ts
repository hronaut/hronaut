import { createServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { BrowserState, HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, expectFixtureSuccess, test } from './fixtures.js'

const text = (result: CallToolResult) => result.content.filter(item => item.type === 'text').map(item => item.text).join('\n')

test.use({ trace: 'off', screenshot: 'off', video: 'off' })
const changes = ['unchanged', 'workspace access', 'workspace access ABA', 'pause ABA', 'global pause ABA'] as const
for (const toolName of ['browser_screenshot', 'browser_snapshot'] as const)
for (const change of changes) {
  test(`${toolName} publication after audit persistence across ${change}`, async ({ appWindow, electronApp, mcpPort, mcpToken }, testInfo) => {
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
      await electronApp.evaluate(async (_electron, toolName) => {
        const fs = (process.getBuiltinModule('fs') as typeof import('node:fs')).promises
        const { syncBuiltinESMExports } = process.getBuiltinModule('module') as typeof import('node:module')
        const original = fs.open
        let release!: () => void
        const gate = new Promise<void>(resolve => { release = resolve })
        const held = { held: false, outcomeWrites: 0, actionId: '', release, restore: () => { fs.open = original; syncBuiltinESMExports() } }
        ;(globalThis as typeof globalThis & { __auditHeld?: typeof held }).__auditHeld = held
        fs.open = async function (...args) {
          const handle = await original.apply(this, args)
          if (String(args[0]).includes('/audit-receipts/') && args[1] === 'a') {
            const write = handle.writeFile.bind(handle)
            handle.writeFile = async (data, options) => {
              const event = JSON.parse(String(data)).event as { phase: string; toolName?: string; actionId?: string }
              if (event.phase === 'decision' && event.toolName === toolName) held.actionId = event.actionId!
              const outcome = event.phase === 'outcome' && event.actionId === held.actionId
              if (outcome && !held.held) { held.held = true; await gate }
              const result = await write(data, options)
              if (outcome) held.outcomeWrites++
              return result
            }
          }
          return handle
        }
        syncBuiltinESMExports()
      }, toolName)
      pending = client.callTool({ name: toolName, arguments: { workspaceId: workspace.id, tabId,
        ...(toolName === 'browser_screenshot' ? { maxWidth: 128, maxHeight: 128 } : { maxChars: 2000 })
      } }, undefined, { signal: abort.signal }) as Promise<CallToolResult>
      await expect.poll(() => electronApp.evaluate(() => (globalThis as typeof globalThis & { __auditHeld?: { held: boolean } }).__auditHeld?.held)).toBe(true)
      if (change === 'pause ABA') {
        await appWindow.evaluate(async id => { const api = (window as unknown as { hronaut: HronautApi }).hronaut; await api.setTabAgentPaused(id, true); await api.setTabAgentPaused(id, false) }, tabId)
      } else if (change === 'global pause ABA') {
        await appWindow.evaluate('window.hronautMcp.setPaused(true).then(()=>window.hronautMcp.setPaused(false))')
      } else if (change === 'workspace access ABA') {
        await appWindow.evaluate(async id => { const api = (window as unknown as { hronaut: HronautApi }).hronaut; await api.updateTabGroup(id, { agentAccess: false }); await api.updateTabGroup(id, { agentAccess: true }) }, workspace.id)
      } else if (change === 'workspace access') {
        await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.updateTabGroup(id, { agentAccess: false }), workspace.id)
      }
      await electronApp.evaluate(() => (globalThis as typeof globalThis & { __auditHeld?: { release(): void } }).__auditHeld?.release())
      const result = await pending
      const observation = {
        toolName, change, isError: result.isError === true, metadata: result.isError ? { status: result.structuredContent?.status, reason: result.structuredContent?.reason, dispatch: result.structuredContent?.dispatch, effects: result.structuredContent?.effects, retrySafe: result.structuredContent?.retrySafe } : undefined,
        imageCount: result.content.filter(item => item.type === 'image').length,
        markerPublished: JSON.stringify(result).includes('Synthetic public inspection target'),
        outcomeWrites: await electronApp.evaluate(() => (globalThis as typeof globalThis & { __auditHeld?: { outcomeWrites: number } }).__auditHeld?.outcomeWrites)
      }
      await testInfo.attach('observation-publication', { body: JSON.stringify(observation), contentType: 'application/json' })
      expect(observation.outcomeWrites).toBe(1)
      if (change === 'unchanged') {
        expect(result.isError, text(result)).not.toBe(true)
        if (toolName === 'browser_screenshot') expect(observation.imageCount).toBe(1)
        else expect(observation.markerPublished).toBe(true)
      } else {
        expect(result.isError).toBe(true)
        expect(result.structuredContent).toMatchObject({ status: 'OUTCOME_UNKNOWN', dispatch: 'dispatched', effects: 'possible', retrySafe: false })
        expect(observation.imageCount).toBe(0)
        expect(observation.markerPublished).toBe(false)
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
