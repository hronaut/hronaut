import { randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { HronautApi, HronautSettingsApi } from '../../src/shared/types.js'
import { test, expect, expectFixtureSuccess } from './fixtures.js'
import { text } from './capability-fixtures.js'

type Gate = { held: boolean; actionId: string; release(): void; restore(): void }
type Scope = typeof globalThis & { __labelAuditGate?: Gate }
for (const change of ['newer label', 'workspace access ABA', 'capability revoke', 'audit failure', 'human waiting', 'cancel', 'disconnect'] as const) {
  test(`labeled creation publication after audit across ${change}`, async ({ electronApp, appWindow, mcpPort, mcpToken, profileDirectory }, info) => {
    const client = new Client({ name: 'label-publication', version: '1' })
    const abort = new AbortController()
    let creation: Promise<CallToolResult> | undefined
    let restoreTransport: (() => void) | undefined
    const marker = 'PRIVATE_CREATION_LABEL_CANARY'
    try {
      if (change === 'capability revoke') await appWindow.evaluate(() => (window as unknown as { hronautSettings: HronautSettingsApi }).hronautSettings.setMcpAuthentication(true))
      const credential = change === 'capability revoke' ? await appWindow.evaluate(() => (window as unknown as { hronautSettings: HronautSettingsApi }).hronautSettings.createMcpCapabilityProfile({ name: 'Label publication fixture', preset: 'complete' })) : undefined
      const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), { requestInit: { headers: { authorization: `Bearer ${credential?.credential ?? mcpToken}` } } })
      await expect.poll(async () => { try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`, { headers: { authorization: `Bearer ${credential?.credential ?? mcpToken}` } })).ok } catch { return false } }).toBe(true)
      await client.connect(transport)
      const send = transport.send
      let creationRequestId: string | number | undefined
      const cancelledRequestIds: unknown[] = []
      let cancellationDelivery: Promise<void> | undefined
      transport.send = (message, options) => {
        if ('id' in message && 'method' in message && message.method === 'tools/call' && message.params?.name === 'browser_new_tab') {
          expect(creationRequestId).toBeUndefined()
          creationRequestId = message.id
        }
        const delivery = send.call(transport, message, options)
        if ('method' in message && message.method === 'notifications/cancelled') {
          cancelledRequestIds.push(message.params?.requestId)
          cancellationDelivery = delivery
        }
        return delivery
      }
      restoreTransport = () => { transport.send = send }
      if (credential) {
        // Home never sees capability profile ids, so this waits for the profile's session to be initialized.
        await expect.poll(() => electronApp.evaluate(async ({ webContents }) => {
          const home = webContents.getAllWebContents().find(page => page.getURL().startsWith('hronaut://home'))!
          const state = await (await home.session.fetch('hronaut://home/api/status')).json() as { clients: Array<{ name: string; initializedAt?: string }> }
          return state.clients.some(client => client.name === 'label-publication' && Boolean(client.initializedAt))
        })).toBe(true)
      }
      const call = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args }) as Promise<CallToolResult>
      const workspaceResult = await call('browser_workspaces', { action: 'create', storage: 'scratch', name: 'Label publication' })
      expectFixtureSuccess(workspaceResult, 'create workspace')
      const workspace = JSON.parse(text(workspaceResult)) as { id: string }
      expectFixtureSuccess(await call('browser_audit_receipts', { workspaceId: workspace.id, action: 'start' }), 'start audit')
      await electronApp.evaluate((_electron, fail) => {
        const fs = process.getBuiltinModule('node:fs/promises') as typeof import('node:fs/promises')
        const { syncBuiltinESMExports } = process.getBuiltinModule('node:module') as typeof import('node:module')
        const original = fs.open
        let release!: () => void
        const gate = new Promise<void>(resolve => { release = resolve })
        const state: Gate = { held: false, actionId: '', release, restore() { fs.open = original; syncBuiltinESMExports(); release() } }
        ;(globalThis as Scope).__labelAuditGate = state
        fs.open = (async (...args: Parameters<typeof fs.open>) => {
          const handle = await original(...args)
          if (String(args[0]).includes('/audit-receipts/') && args[1] === 'a') {
            const write = handle.writeFile.bind(handle)
            handle.writeFile = async (data, options) => {
              const event = JSON.parse(String(data)).event as { phase: string; toolName?: string; actionId?: string }
              if (event.phase === 'decision' && event.toolName === 'browser_new_tab') state.actionId = event.actionId!
              if (event.phase === 'outcome' && event.actionId === state.actionId && !state.held) {
                state.held = true; await gate
                if (fail) throw new Error('Synthetic creation audit failure')
              }
              return write(data, options)
            }
          }
          return handle
        }) as typeof fs.open
        syncBuiltinESMExports()
      }, change === 'audit failure')
      const received: string[] = []
      const onmessage = transport.onmessage!
      transport.onmessage = message => { received.push(JSON.stringify(message)); onmessage(message) }
      creation = (client.callTool({ name: 'browser_new_tab', arguments: { workspaceId: workspace.id, label: marker } }, undefined, { signal: abort.signal }) as Promise<CallToolResult>).catch(error => {
        if (change !== 'cancel' && change !== 'disconnect') throw error
        return { isError: true, content: [{ type: 'text', text: 'Transport closed' }] }
      })
      await expect.poll(() => electronApp.evaluate(() => (globalThis as Scope).__labelAuditGate?.held)).toBe(true)
      const state = await appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState())
      const id = state.tabs.find(tab => tab.mcpGroupId === workspace.id)!.id
      expect(state.tabs.find(tab => tab.id === id)?.label).toBe(marker)
      if (change === 'newer label') await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.setTabLabel(id, 'New human intent'), id)
      else if (change === 'workspace access ABA') await appWindow.evaluate(async id => { const api = (window as unknown as { hronaut: HronautApi }).hronaut; await api.updateTabGroup(id, { agentAccess: false }); await api.updateTabGroup(id, { agentAccess: true }) }, workspace.id)
      else if (change === 'capability revoke') await appWindow.evaluate(id => (window as unknown as { hronautSettings: HronautSettingsApi }).hronautSettings.revokeMcpCapabilityProfile(id), credential!.profile.id)
      else if (change === 'human waiting') expectFixtureSuccess(await call('browser_human_waiting', { workspaceId: workspace.id, action: 'request', runId: randomUUID(), decision: 'review-page' }), 'new human barrier')
      else if (change === 'cancel') {
        abort.abort()
        await creation
        // Client rejection precedes asynchronous notification delivery. Keep the
        // audit barrier held until this exact request's cancellation was sent.
        expect(creationRequestId).toBeDefined()
        expect(cancelledRequestIds).toEqual([creationRequestId])
        expect(cancellationDelivery).toBeDefined()
        await cancellationDelivery
      }
      else if (change === 'disconnect') { await transport.terminateSession(); await client.close(); await creation }
      await electronApp.evaluate(() => (globalThis as Scope).__labelAuditGate?.release())
      const result = await creation
      if (change === 'newer label') {
        expectFixtureSuccess(result, 'creation settles')
        const body = JSON.parse(text(result))
        expect(body.createdTabId).toBe(id)
        expect(body.labelPersistence).toBe('saved')
        expect(body.tabs.find((tab: { id: string }) => tab.id === id).label).toBe('New human intent')
        expect(text(result)).not.toContain(marker)
      } else {
        expect(result.isError).toBe(true)
        expect(text(result)).not.toContain(marker); expect(text(result)).not.toContain('createdTabId')
        if (change === 'capability revoke') expect(result.structuredContent).toMatchObject({ status: 'OUTCOME_UNKNOWN', permission: 'denied', policyDecision: expect.any(Object) })
      }
      await expect.poll(() => electronApp.evaluate(async ({ webContents }, id) => {
        const home = webContents.getAllWebContents().find(page => page.getURL().startsWith('hronaut://home'))!
        const state = await (await home.session.fetch('hronaut://home/api/status')).json() as { recentActivity: Array<{ toolName: string; tabId: string; result: { outcome: string } }> }
        return state.recentActivity.filter(activity => activity.toolName === 'browser_new_tab' && activity.tabId === id).map(activity => activity.result.outcome)
      }, id)).toEqual([change === 'newer label' ? 'succeeded' : change === 'cancel' || change === 'disconnect' ? 'cancelled' : 'outcome-unknown'])
      if (change !== 'newer label') expect(received.join('\n')).not.toContain(marker)
      await info.attach('creation-publication', { body: JSON.stringify({ change, result }), contentType: 'application/json' })
      // Audit events do not copy authored labels. Stop flush is checked in the
      // successful authorized case; revoked/disconnected clients cannot stop it.
      if (change === 'newer label') {
        expectFixtureSuccess(await call('browser_audit_receipts', { workspaceId: workspace.id, action: 'stop' }), 'stop audit')
        const files = await readdir(join(profileDirectory, 'audit-receipts'), { recursive: true, withFileTypes: true })
        const contents = await Promise.all(files.filter(file => file.isFile()).map(file => readFile(join(file.parentPath, file.name), 'utf8')))
        expect(contents.length).toBeGreaterThan(0)
        expect(contents.join('\n')).not.toContain(marker)
        expect(contents.join('\n')).not.toContain('New human intent')
      }
    } finally {
      restoreTransport?.()
      await electronApp.evaluate(() => { (globalThis as Scope).__labelAuditGate?.restore(); delete (globalThis as Scope).__labelAuditGate }).catch(() => undefined)
      await Promise.allSettled([creation].filter(Boolean))
      await client.close().catch(() => undefined)
    }
  })
}
