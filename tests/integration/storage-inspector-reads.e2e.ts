import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { HronautApi, McpTabActivity } from '../../src/shared/types.js'
import { expect, test, text } from './capability-fixtures.js'

type Gate = { held: boolean; primaryCalls: number; fallbackCalls: number; indexedDbCalls: number; nativeCommands: string[]; release(): void; restore(): void }
type Scope = typeof globalThis & { __quotaProbe?: Gate }
for (const mode of ['primary', 'unsupported', 'fallback', 'indexeddb'] as const) for (const change of ['unchanged', 'pause', 'pause ABA', 'access ABA', 'navigation ABA', 'cancel'] as const) {
  test(`Storage inspector ${mode} counts reads across ${change}`, async ({ capabilities, appWindow, electronApp }) => {
    const { client, tabId, fixtureUrl } = capabilities
    const tool = mode === 'indexeddb' ? 'browser_indexeddb' : 'browser_storage_usage'
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
      await electronApp.evaluate(({ webContents }, { fixtureUrl, mode }) => {
        const page = webContents.getAllWebContents().find(p => p.getURL() === fixtureUrl)!
        const command = page.debugger.sendCommand, script = page.executeJavaScriptInIsolatedWorld
        let release!: () => void
        const barrier = new Promise<void>(resolve => { release = resolve })
        const gate: Gate = { held: false, primaryCalls: 0, fallbackCalls: 0, indexedDbCalls: 0, nativeCommands: [], release, restore: () => {
          release(); page.debugger.sendCommand = command; page.executeJavaScriptInIsolatedWorld = script
        } }
        ;(globalThis as Scope).__quotaProbe = gate
        page.debugger.sendCommand = async function (...args) {
          if (args[0] !== 'Storage.getUsageAndQuota') return command.apply(this, args)
          gate.primaryCalls++
          const nativeMethod = mode === 'primary' ? args[0] : 'Storage.hronautUnsupportedQuotaProbe'
          gate.nativeCommands.push(nativeMethod)
          let result: unknown, failure: unknown
          try { result = await command.call(this, nativeMethod, args[1]) } catch (error) { failure = error }
          if (mode !== 'fallback') { gate.held = true; await barrier }
          if (failure) throw failure
          return result
        }
        page.executeJavaScriptInIsolatedWorld = async function (...args) {
          if (args[0] === 1009) gate.fallbackCalls++
          if (args[0] === 1007) gate.indexedDbCalls++
          const result = await script.apply(this, args)
          if ((mode === 'fallback' && args[0] === 1009) || (mode === 'indexeddb' && args[0] === 1007)) { gate.held = true; await barrier }
          return result
        }
      }, { fixtureUrl, mode })
      pending = (client.callTool({ name: tool, arguments: { tabId } }, undefined, { signal: abort.signal }) as Promise<CallToolResult>).catch(error => { if (change !== 'cancel') throw error; return { isError: true, content: [] } })
      await expect.poll(() => electronApp.evaluate(() => (globalThis as Scope).__quotaProbe?.held)).toBe(true)
      expect(await electronApp.evaluate(() => ({ primary: (globalThis as Scope).__quotaProbe!.primaryCalls, fallback: (globalThis as Scope).__quotaProbe!.fallbackCalls }))).toEqual({ primary: mode === 'indexeddb' ? 0 : 1, fallback: mode === 'fallback' ? 1 : 0 })
      if (change === 'pause ABA' || change === 'pause') await appWindow.evaluate(async ({ tabId, resume }) => {
        const api = (window as unknown as { hronaut: HronautApi }).hronaut
        await api.setTabAgentPaused(tabId, true); if (resume) await api.setTabAgentPaused(tabId, false)
      }, { tabId, resume: change === 'pause ABA' })
      if (change === 'access ABA') await appWindow.evaluate(async tabId => {
        const api = (window as unknown as { hronaut: HronautApi }).hronaut
        const workspace = (await api.getState()).tabs.find(t => t.id === tabId)!.mcpGroupId!
        await api.updateTabGroup(workspace, { agentAccess: false }); await api.updateTabGroup(workspace, { agentAccess: true })
      }, tabId)
      if (change === 'navigation ABA') await electronApp.evaluate(async ({ webContents }, fixtureUrl) => {
        const page = webContents.getAllWebContents().find(p => p.getURL() === fixtureUrl)!
        await page.loadURL('data:text/html,quota changed'); await page.loadURL(fixtureUrl)
      }, fixtureUrl)
      if (change === 'cancel') { abort.abort(); await expect.poll(() => cancelled).toBe(true) }
      await electronApp.evaluate(() => (globalThis as Scope).__quotaProbe!.release())
      const result = await pending
      await expect.poll(() => appWindow.evaluate(() => (window as unknown as { inspectorActivities: McpTabActivity[] }).inspectorActivities.filter(a => a.phase !== 'started').length)).toBe(1)
      const counts = await electronApp.evaluate(() => ({ primary: (globalThis as Scope).__quotaProbe!.primaryCalls, fallback: (globalThis as Scope).__quotaProbe!.fallbackCalls, indexeddb: (globalThis as Scope).__quotaProbe!.indexedDbCalls, commands: (globalThis as Scope).__quotaProbe!.nativeCommands }))
      expect(counts.primary).toBe(mode === 'indexeddb' ? 0 : 1)
      expect(counts.indexeddb).toBe(mode === 'indexeddb' ? 1 : 0)
      expect(counts.commands).toEqual(mode === 'indexeddb' ? [] : [mode === 'primary' ? 'Storage.getUsageAndQuota' : 'Storage.hronautUnsupportedQuotaProbe'])
      expect(counts.fallback).toBe(mode === 'fallback' || (mode === 'unsupported' && change === 'unchanged') ? 1 : 0)
      if (change === 'unchanged') {
        expect(result.isError, text(result)).not.toBe(true)
        if (mode !== 'indexeddb') expect(JSON.parse(text(result))).toMatchObject({ source: mode === 'primary' ? 'chromium-quota' : 'storage-manager' })
      } else if (change !== 'cancel') {
        expect(result.isError, text(result)).toBe(true)
        expect(result.structuredContent).toMatchObject({ status: 'STALE_OBSERVATION', effects: 'none', retrySafe: false })
        expect(JSON.stringify(result)).not.toMatch(/"(usage|quota|databases|records|origin)"/)
      }
      if (change !== 'unchanged') expect(await appWindow.evaluate(() => (window as unknown as { inspectorActivities: McpTabActivity[] }).inspectorActivities.filter(a => a.phase === 'failed').at(-1)?.result)).toMatchObject({ dispatch: 'dispatched', effects: 'none', ...(change === 'cancel' ? { outcome: 'cancelled', reasonCode: 'REQUEST_CANCELLED' } : {}) })
    } finally {
      transport.send = send
      await electronApp.evaluate(() => { (globalThis as Scope).__quotaProbe?.restore(); delete (globalThis as Scope).__quotaProbe }).catch(() => undefined)
      await pending?.catch(() => undefined)
      await appWindow.evaluate(() => (window as unknown as { stopInspector(): void }).stopInspector()).catch(() => undefined)
    }
  })
}

test('storage usage retains the real Developer Tools fallback without a primary command', async ({ capabilities, electronApp }) => {
  const { client, tabId, fixtureUrl } = capabilities
  try {
    await electronApp.evaluate(({ webContents }, fixtureUrl) => {
      const page = webContents.getAllWebContents().find(p => p.getURL() === fixtureUrl)!
      const command = page.debugger.sendCommand, script = page.executeJavaScriptInIsolatedWorld
      const gate: Gate = { held: false, primaryCalls: 0, fallbackCalls: 0, indexedDbCalls: 0, nativeCommands: [], release: () => {}, restore: () => {
        page.debugger.sendCommand = command; page.executeJavaScriptInIsolatedWorld = script; page.closeDevTools()
      } }
      ;(globalThis as Scope).__quotaProbe = gate
      page.debugger.sendCommand = async function (...args) {
        if (args[0] === 'Storage.getUsageAndQuota') gate.primaryCalls++
        return command.apply(this, args)
      }
      page.executeJavaScriptInIsolatedWorld = async function (...args) {
        if (args[0] === 1009) gate.fallbackCalls++
        return script.apply(this, args)
      }
      page.openDevTools({ mode: 'detach', activate: false })
    }, fixtureUrl)
    await expect.poll(() => electronApp.evaluate(({ webContents }, fixtureUrl) => webContents.getAllWebContents().find(p => p.getURL() === fixtureUrl)!.isDevToolsOpened(), fixtureUrl)).toBe(true)
    const result = await client.callTool({ name: 'browser_storage_usage', arguments: { tabId } }) as CallToolResult
    expect(result.isError, text(result)).not.toBe(true)
    expect(JSON.parse(text(result))).toMatchObject({ source: 'storage-manager' })
    expect(await electronApp.evaluate(() => ({ primary: (globalThis as Scope).__quotaProbe!.primaryCalls, fallback: (globalThis as Scope).__quotaProbe!.fallbackCalls }))).toEqual({ primary: 0, fallback: 1 })
  } finally {
    await electronApp.evaluate(() => { (globalThis as Scope).__quotaProbe?.restore(); delete (globalThis as Scope).__quotaProbe }).catch(() => undefined)
  }
})


test('IndexedDB preserves fresh input feedback before submitting an isolated read', async ({ capabilities, electronApp }) => {
  const { client, tabId, fixtureUrl } = capabilities
  try {
    await electronApp.evaluate(({ webContents }, fixtureUrl) => {
      const page = webContents.getAllWebContents().find(p => p.getURL() === fixtureUrl)!
      const script = page.executeJavaScriptInIsolatedWorld
      const gate: Gate = { held: false, primaryCalls: 0, fallbackCalls: 0, indexedDbCalls: 0, nativeCommands: [], release: () => {}, restore: () => { page.executeJavaScriptInIsolatedWorld = script } }
      ;(globalThis as Scope).__quotaProbe = gate
      page.executeJavaScriptInIsolatedWorld = async function (...args) {
        if (args[0] === 1007) gate.indexedDbCalls++
        return script.apply(this, args)
      }
    }, fixtureUrl)
    const result = await client.callTool({ name: 'browser_indexeddb', arguments: { tabId, objectStore: 'synthetic-store' } }) as CallToolResult
    expect(result.isError, text(result)).toBe(true)
    expect(text(result)).toContain('database is required when objectStore is provided')
    expect(await electronApp.evaluate(() => (globalThis as Scope).__quotaProbe!.indexedDbCalls)).toBe(0)
  } finally {
    await electronApp.evaluate(() => { (globalThis as Scope).__quotaProbe?.restore(); delete (globalThis as Scope).__quotaProbe }).catch(() => undefined)
  }
})
