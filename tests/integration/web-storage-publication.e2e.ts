import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { HronautApi, McpTabActivity } from '../../src/shared/types.js'
import { expect, test, text } from './capability-fixtures.js'

type PublicationGate = { held: boolean; release(): void; restore(): void }
type PublicationGlobal = typeof globalThis & { __webStoragePublicationGate?: PublicationGate }

const cases = (['get', 'list', 'set', 'delete', 'clear'] as const).flatMap(action =>
  (['pause ABA', 'navigation ABA', 'unchanged'] as const).map(change => ({ action, change })))
const extraCases = (['get', 'set'] as const).flatMap(action =>
  (['pause', 'access ABA', 'close', 'cancel'] as const).map(change => ({ action, change })))
for (const kind of ['local-storage', 'session-storage'] as const) for (const { action, change } of [...cases, ...extraCases]) {
  test(`Web storage ${kind} ${action} publication during audit append across ${change}`, async ({ capabilities, electronApp, appWindow }) => {
    const { client, tabId, fixtureUrl } = capabilities
    const mutation = ['set', 'delete', 'clear'].includes(action)
    const expectedValue = action === 'delete' || action === 'clear' ? null : 'synthetic-storage-canary'
    await electronApp.evaluate(async ({ webContents }, { fixtureUrl, kind, action }) => {
      const page = webContents.getAllWebContents().find(p => p.getURL() === fixtureUrl)!
      await page.executeJavaScript(`${kind === 'local-storage' ? 'localStorage' : 'sessionStorage'}.setItem('publication-fixture', '${action === 'set' ? 'synthetic-before-value' : 'synthetic-storage-canary'}')`)
    }, { fixtureUrl, kind, action })
    await appWindow.evaluate(() => {
      const scope = window as unknown as { hronaut: HronautApi; storageActivities: McpTabActivity[]; stopStorage(): void }
      scope.storageActivities = []
      scope.stopStorage = scope.hronaut.onMcpTabActivity(activity => { if (activity.toolName === 'browser_storage') scope.storageActivities.push(activity) })
    })
    const abort = new AbortController()
    const transport = client.transport!, send = transport.send.bind(transport)
    let cancelled = false
    transport.send = async (message, options) => { await send(message, options); if ('method' in message && message.method === 'notifications/cancelled') cancelled = true }
    let pending: Promise<CallToolResult> | undefined
    try {
      const started = await client.callTool({ name: 'browser_audit_receipts', arguments: { action: 'start' } }) as CallToolResult
      expect(started.isError, text(started)).not.toBe(true)
      await electronApp.evaluate(() => {
        const fs = (process.getBuiltinModule('fs') as typeof import('node:fs')).promises
        const { syncBuiltinESMExports } = process.getBuiltinModule('module') as typeof import('node:module')
        const open = fs.open
        let release!: () => void
        const barrier = new Promise<void>(resolve => { release = resolve })
        let actionId = ''
        const gate: PublicationGate = { held: false, release, restore: () => { fs.open = open; syncBuiltinESMExports() } }
        ;(globalThis as PublicationGlobal).__webStoragePublicationGate = gate
        fs.open = async function (...args) {
          const handle = await open.apply(this, args)
          if (String(args[0]).includes('/audit-receipts/') && args[1] === 'a') {
            const write = handle.writeFile.bind(handle)
            handle.writeFile = async (data, options) => {
              const event = JSON.parse(String(data)).event as { phase: string; toolName?: string; actionId?: string }
              if (event.phase === 'decision' && event.toolName === 'browser_storage') actionId = event.actionId!
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
      })
      pending = (client.callTool({ name: 'browser_storage', arguments: { tabId, kind, action, key: 'publication-fixture', value: action === 'set' ? 'synthetic-storage-canary' : undefined, includeValues: true } }, undefined, { signal: abort.signal }) as Promise<CallToolResult>).catch(error => { if (change !== 'cancel') throw error; return { isError: true, content: [] } })
      await expect.poll(() => electronApp.evaluate(() => (globalThis as PublicationGlobal).__webStoragePublicationGate?.held)).toBe(true)
      // Execution has returned; this holds before the audit outcome append.
      // Verify actual storage before intervention, independently of response flags.
      expect(await electronApp.evaluate(async ({ webContents }, { fixtureUrl, kind }) => await webContents.getAllWebContents().find(p => p.getURL() === fixtureUrl)!.executeJavaScript(`${kind === 'local-storage' ? 'localStorage' : 'sessionStorage'}.getItem('publication-fixture')`), { fixtureUrl, kind })).toBe(expectedValue)
      if (change === 'pause ABA' || change === 'pause') await appWindow.evaluate(async ({ id, resume }) => {
        const api = (window as unknown as { hronaut: HronautApi }).hronaut
        await api.setTabAgentPaused(id, true)
        if (resume) await api.setTabAgentPaused(id, false)
      }, { id: tabId, resume: change === 'pause ABA' })
      if (change === 'navigation ABA') await electronApp.evaluate(async ({ webContents }, url) => {
        const page = webContents.getAllWebContents().find(p => p.getURL() === url)!
        await page.loadURL('data:text/html,web storage publication changed')
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
      await electronApp.evaluate(() => (globalThis as PublicationGlobal).__webStoragePublicationGate!.release())
      const result = await pending
      // The SDK discards cancelled responses, so also inspect terminal server activity.
      await expect.poll(() => appWindow.evaluate(() => (window as unknown as { storageActivities: McpTabActivity[] }).storageActivities.filter(a => a.phase !== 'started').length)).toBe(1)
      if (change === 'unchanged') {
        expect(result.isError, text(result)).not.toBe(true)
        const storage = JSON.parse(text(result)) as { items: { key: string; value?: string }[] }
        expect(storage).toMatchObject({ action, kind, ...(mutation ? { changed: true } : {}) })
        expect(storage.items.filter(item => item.key === 'publication-fixture')).toMatchObject(expectedValue === null ? [] : [{ key: 'publication-fixture', value: expectedValue }])
      } else if (change !== 'cancel') {
        expect(result.isError, text(result)).toBe(true)
        expect(result.structuredContent).toMatchObject({ status: mutation ? 'OUTCOME_UNKNOWN' : 'STALE_OBSERVATION', effects: mutation ? 'possible' : 'none', mutation, executionSubmitted: true, executionAcknowledged: true, retrySafe: false })
        expect(text(result)).not.toContain('synthetic-storage-canary')
        expect(text(result)).not.toContain('publication-fixture')
      }
      if (change !== 'unchanged') await expect.poll(() => appWindow.evaluate(() => (window as unknown as { storageActivities: McpTabActivity[] }).storageActivities.filter(a => a.phase === 'failed').at(-1)?.result)).toMatchObject({ dispatch: 'dispatched', effects: mutation ? 'possible' : 'none', ...(change === 'cancel' ? { outcome: 'cancelled', reasonCode: 'REQUEST_CANCELLED' } : {}) })
      if (change !== 'close') expect(await electronApp.evaluate(async ({ webContents }, { fixtureUrl, kind }) => await webContents.getAllWebContents().find(p => p.getURL() === fixtureUrl)!.executeJavaScript(`${kind === 'local-storage' ? 'localStorage' : 'sessionStorage'}.getItem('publication-fixture')`), { fixtureUrl, kind })).toBe(expectedValue)
    } finally {
      transport.send = send
      await electronApp.evaluate(() => {
        const scope = globalThis as PublicationGlobal
        scope.__webStoragePublicationGate?.release()
        scope.__webStoragePublicationGate?.restore()
        delete scope.__webStoragePublicationGate
      }).catch(() => undefined)
      await pending?.catch(() => undefined)
      await appWindow.evaluate(() => (window as unknown as { stopStorage(): void }).stopStorage()).catch(() => undefined)
    }
  })
}
