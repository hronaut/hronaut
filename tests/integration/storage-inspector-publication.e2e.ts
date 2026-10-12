import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { HronautApi, McpTabActivity } from '../../src/shared/types.js'
import { expect, test, text } from './capability-fixtures.js'

type PublicationGate = { counts(): { primary: number; fallback: number; indexeddb: number }; held: boolean; release(): void; restore(): void }
type PublicationGlobal = typeof globalThis & { __inspectorPublicationGate?: PublicationGate }

for (const mode of ['indexeddb', 'primary', 'fallback'] as const) for (const change of ['pause', 'pause ABA', 'navigation ABA', 'access ABA', 'close', 'cancel', 'unchanged'] as const) {
  const tool = mode === 'indexeddb' ? 'browser_indexeddb' : 'browser_storage_usage'
  test(`Storage inspector ${mode} publication during audit append across ${change}`, async ({ capabilities, electronApp, appWindow }) => {
    const { client, tabId, fixtureUrl } = capabilities
    if (tool === 'browser_indexeddb') await electronApp.evaluate(async ({ webContents }, fixtureUrl) => {
      await webContents.getAllWebContents().find(p => p.getURL() === fixtureUrl)!.executeJavaScript(`new Promise((resolve, reject) => {
        const request = indexedDB.open('synthetic-inspector-db', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('records');
        request.onerror = () => reject(new Error('synthetic setup failure'));
        request.onsuccess = () => {
          const db = request.result, tx = db.transaction('records', 'readwrite');
          tx.objectStore('records').put('synthetic-indexeddb-canary', 'synthetic-record');
          tx.oncomplete = () => { db.close(); resolve(true); };
          tx.onerror = () => { db.close(); reject(new Error('synthetic setup failure')); };
        };
      })`)
    }, fixtureUrl)
    const args = { tabId, ...(tool === 'browser_indexeddb' ? { database: 'synthetic-inspector-db', objectStore: 'records', includeValues: true } : {}) }
    const initial = await client.callTool({ name: tool, arguments: args }) as CallToolResult
    expect(initial.isError, text(initial)).not.toBe(true)
    if (tool === 'browser_indexeddb') expect(text(initial)).toContain('synthetic-indexeddb-canary')
    else expect(JSON.parse(text(initial))).toMatchObject({ source: 'chromium-quota' })
    await appWindow.evaluate(tool => {
      const scope = window as unknown as { hronaut: HronautApi; inspectorActivities: McpTabActivity[]; stopInspector(): void }
      scope.inspectorActivities = []
      scope.stopInspector = scope.hronaut.onMcpTabActivity(activity => { if (activity.toolName === tool) scope.inspectorActivities.push(activity) })
    }, tool)
    const abort = new AbortController()
    const transport = client.transport!, send = transport.send.bind(transport)
    let cancelled = false
    transport.send = async (message, options) => { await send(message, options); if ('method' in message && message.method === 'notifications/cancelled') cancelled = true }
    let pending: Promise<CallToolResult> | undefined
    try {
      const started = await client.callTool({ name: 'browser_audit_receipts', arguments: { action: 'start' } }) as CallToolResult
      expect(started.isError, text(started)).not.toBe(true)
      await electronApp.evaluate(({ webContents }, { tool, fixtureUrl, mode }) => {
        const page = webContents.getAllWebContents().find(p => p.getURL() === fixtureUrl)!
        const command = page.debugger.sendCommand, script = page.executeJavaScriptInIsolatedWorld
        let primary = 0, fallback = 0, indexeddb = 0
        page.debugger.sendCommand = async function (...args) {
          if (args[0] !== 'Storage.getUsageAndQuota') return command.apply(this, args)
          primary++
          return command.call(this, mode === 'fallback' ? 'Storage.hronautUnsupportedQuotaProbe' : args[0], args[1])
        }
        page.executeJavaScriptInIsolatedWorld = async function (...args) {
          if (args[0] === 1007) indexeddb++
          if (args[0] === 1009) fallback++
          return script.apply(this, args)
        }
        const fs = (process.getBuiltinModule('fs') as typeof import('node:fs')).promises
        const { syncBuiltinESMExports } = process.getBuiltinModule('module') as typeof import('node:module')
        const open = fs.open
        let release!: () => void
        const barrier = new Promise<void>(resolve => { release = resolve })
        let actionId = ''
        const gate: PublicationGate = { counts: () => ({ primary, fallback, indexeddb }), held: false, release, restore: () => { page.debugger.sendCommand = command; page.executeJavaScriptInIsolatedWorld = script; fs.open = open; syncBuiltinESMExports() } }
        ;(globalThis as PublicationGlobal).__inspectorPublicationGate = gate
        fs.open = async function (...args) {
          const handle = await open.apply(this, args)
          if (String(args[0]).includes('/audit-receipts/') && args[1] === 'a') {
            const write = handle.writeFile.bind(handle)
            handle.writeFile = async (data, options) => {
              const event = JSON.parse(String(data)).event as { phase: string; toolName?: string; actionId?: string }
              if (event.phase === 'decision' && event.toolName === tool) actionId = event.actionId!
              if (event.phase === 'outcome' && event.actionId === actionId && !gate.held) {
                gate.held = true
                await barrier
              }
              return write(data, options)
            }
          }
          return handle
        }
        syncBuiltinESMExports()
      }, { tool, fixtureUrl, mode })
      pending = (client.callTool({ name: tool, arguments: args }, undefined, { signal: abort.signal }) as Promise<CallToolResult>).catch(error => { if (change !== 'cancel') throw error; return { isError: true, content: [] } })
      await expect.poll(() => electronApp.evaluate(() => (globalThis as PublicationGlobal).__inspectorPublicationGate?.held)).toBe(true)
      // The manager returned; this barrier is before the later audit outcome append.
      if (change === 'pause' || change === 'pause ABA') await appWindow.evaluate(async ({ id, resume }) => {
        const api = (window as unknown as { hronaut: HronautApi }).hronaut
        await api.setTabAgentPaused(id, true)
        if (resume) await api.setTabAgentPaused(id, false)
      }, { id: tabId, resume: change === 'pause ABA' })
      if (change === 'navigation ABA') await electronApp.evaluate(async ({ webContents }, url) => {
        const page = webContents.getAllWebContents().find(p => p.getURL() === url)!
        await page.loadURL('data:text/html,inspector publication changed')
        await page.loadURL(url)
      }, fixtureUrl)
      if (change === 'access ABA') await appWindow.evaluate(async id => {
        const api = (window as unknown as { hronaut: HronautApi }).hronaut
        const workspace = (await api.getState()).tabs.find(t => t.id === id)!.mcpGroupId!
        await api.updateTabGroup(workspace, { agentAccess: false })
        await api.updateTabGroup(workspace, { agentAccess: true })
      }, tabId)
      if (change === 'close') await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.closeTab(id), tabId)
      if (change === 'cancel') { abort.abort(); await expect.poll(() => cancelled).toBe(true) }
      await electronApp.evaluate(() => (globalThis as PublicationGlobal).__inspectorPublicationGate!.release())
      const result = await pending
      // Cancellation discards the client response; terminal activity remains observable.
      await expect.poll(() => appWindow.evaluate(() => (window as unknown as { inspectorActivities: McpTabActivity[] }).inspectorActivities.filter(a => a.phase !== 'started').length)).toBe(1)
      expect(await electronApp.evaluate(() => (globalThis as PublicationGlobal).__inspectorPublicationGate!.counts())).toEqual({ primary: mode === 'indexeddb' ? 0 : 1, fallback: mode === 'fallback' ? 1 : 0, indexeddb: mode === 'indexeddb' ? 1 : 0 })
      if (change === 'unchanged') {
        expect(result.isError, text(result)).not.toBe(true)
        if (tool === 'browser_indexeddb') expect(text(result)).toContain('synthetic-indexeddb-canary')
        else expect(JSON.parse(text(result))).toMatchObject({ source: mode === 'fallback' ? 'storage-manager' : 'chromium-quota' })
      } else if (change !== 'cancel') {
        expect(result.isError, text(result)).toBe(true)
        expect(result.structuredContent).toMatchObject({ status: 'STALE_OBSERVATION', effects: 'none', retrySafe: false })
        expect(text(result)).not.toContain('synthetic-indexeddb-canary')
        expect(text(result)).not.toContain('synthetic-record')
        expect(text(result)).not.toContain('synthetic-inspector-db')
        expect(text(result)).not.toContain('usage')
        expect(text(result)).not.toContain('quota')
      }
      if (change !== 'unchanged') expect(await appWindow.evaluate(() => (window as unknown as { inspectorActivities: McpTabActivity[] }).inspectorActivities.filter(a => a.phase === 'failed').at(-1)?.result)).toMatchObject({ dispatch: 'dispatched', effects: 'none', ...(change === 'cancel' ? { outcome: 'cancelled', reasonCode: 'REQUEST_CANCELLED' } : {}) })
    } finally {
      transport.send = send
      await electronApp.evaluate(() => {
        const scope = globalThis as PublicationGlobal
        scope.__inspectorPublicationGate?.release()
        scope.__inspectorPublicationGate?.restore()
        delete scope.__inspectorPublicationGate
      }).catch(() => undefined)
      await pending?.catch(() => undefined)
      await appWindow.evaluate(() => (window as unknown as { stopInspector(): void }).stopInspector()).catch(() => undefined)
    }
  })
}
