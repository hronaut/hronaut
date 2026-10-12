import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { HronautApi, McpTabActivity } from '../../src/shared/types.js'
import { expect, test, text } from './capability-fixtures.js'

type Gate = { ready: boolean; calls: number; release(): void; restore(): void; remaining(): Promise<number> }
type Scope = typeof globalThis & { __cookieWriteGate?: Gate }
type Change = 'none' | 'pause' | 'pause ABA' | 'navigation' | 'navigation ABA' | 'access ABA' | 'close' | 'cancel'
const cases: { action: 'set' | 'delete' | 'clear'; phase: 'read' | 'write' | 'readback' | 'lost-ack'; change: Change }[] = [
  ...(['none', 'pause', 'pause ABA', 'navigation', 'navigation ABA', 'access ABA', 'close', 'cancel'] as const).map(change => ({ action: 'set' as const, phase: 'read' as const, change })),
  ...(['delete', 'clear'] as const).flatMap(action => (['none', 'pause', 'navigation', 'cancel'] as const).map(change => ({ action, phase: 'write' as const, change }))),
  { action: 'set', phase: 'lost-ack', change: 'none' },
  { action: 'set', phase: 'readback', change: 'pause' }
]

for (const { action, phase, change } of cases) {
  test(`cookie ${action} at ${phase} preserves authority across ${change}`, async ({ capabilities, appWindow, electronApp }) => {
    const { client, tabId, fixtureUrl } = capabilities
    const url = new URL('/cookie-scope', fixtureUrl).href
    await electronApp.evaluate(async ({ webContents }, { fixtureUrl, url }) => {
      await webContents.getAllWebContents().find(p => p.getURL() === fixtureUrl)!.loadURL(url)
    }, { fixtureUrl, url })
    await electronApp.evaluate(async ({ webContents }, { url, action, phase }) => {
      const page = webContents.getAllWebContents().find(p => p.getURL() === url)!
      const store = page.session.cookies
      // Only synthetic cookies in this case's isolated workspace are touched.
      for (const cookie of await store.get({ url })) await store.remove(url, cookie.name)
      if (action !== 'set') {
        await store.set({ url, name: 'write-boundary', value: 'synthetic-cookie-canary', path: '/' })
        await store.set({ url, name: action === 'delete' ? 'write-boundary' : 'write-boundary-second', value: 'synthetic-cookie-canary', path: '/cookie-scope' })
      }
      const get = store.get, set = store.set, remove = store.remove
      let release!: () => void, reads = 0
      const barrier = new Promise<void>(resolve => { release = resolve })
      const gate: Gate = { ready: false, calls: 0, release, restore: () => {
        release(); store.get = get; store.set = set; store.remove = remove
      }, remaining: async () => (await get.call(store, { url })).filter(c => c.name.startsWith('write-boundary')).length }
      ;(globalThis as Scope).__cookieWriteGate = gate
      const hold = async (): Promise<void> => { gate.ready = true; await barrier }
      store.get = async (...args) => {
        const result = await get.apply(store, args)
        if (args[0].url === url && ++reads === (phase === 'readback' ? 2 : 1) && (phase === 'read' || phase === 'readback')) await hold()
        return result
      }
      store.set = async details => {
        gate.calls++
        await set.call(store, details)
        if (phase === 'lost-ack') { await hold(); throw new Error('synthetic-cookie-canary') }
      }
      store.remove = async (...args) => {
        gate.calls++
        await remove.apply(store, args)
        if (phase === 'write' && gate.calls === 1) await hold()
      }
    }, { url, action, phase })
    await appWindow.evaluate(() => {
      const scope = window as unknown as { hronaut: HronautApi; cookieActivities: McpTabActivity[]; stopCookies(): void }
      scope.cookieActivities = []
      scope.stopCookies = scope.hronaut.onMcpTabActivity(activity => { if (activity.toolName === 'browser_storage') scope.cookieActivities.push(activity) })
    })
    const abort = new AbortController()
    const transport = client.transport!, send = transport.send.bind(transport)
    let cancelled = false
    transport.send = async (message, options) => { await send(message, options); if ('method' in message && message.method === 'notifications/cancelled') cancelled = true }
    let pending: Promise<CallToolResult> | undefined
    try {
      pending = (client.callTool({ name: 'browser_storage', arguments: { tabId, kind: 'cookies', action, key: 'write-boundary', value: 'synthetic-cookie-canary', includeValues: true } }, undefined, { signal: abort.signal }) as Promise<CallToolResult>).catch(() => ({ isError: true, content: [] }))
      await expect.poll(() => electronApp.evaluate(() => (globalThis as Scope).__cookieWriteGate!.ready)).toBe(true)
      if (change === 'pause' || change === 'pause ABA') await appWindow.evaluate(async ({ tabId, resume }) => {
        const api = (window as unknown as { hronaut: HronautApi }).hronaut
        await api.setTabAgentPaused(tabId, true)
        if (resume) await api.setTabAgentPaused(tabId, false)
      }, { tabId, resume: change === 'pause ABA' })
      if (change === 'navigation' || change === 'navigation ABA') await electronApp.evaluate(async ({ webContents }, { url, back }) => {
        const page = webContents.getAllWebContents().find(p => p.getURL() === url)!
        await page.loadURL('data:text/html,new cookie context')
        if (back) await page.loadURL(url)
      }, { url, back: change === 'navigation ABA' })
      if (change === 'access ABA') await appWindow.evaluate(async id => {
        const api = (window as unknown as { hronaut: HronautApi }).hronaut
        const workspace = (await api.getState()).tabs.find(t => t.id === id)!.mcpGroupId!
        await api.updateTabGroup(workspace, { agentAccess: false })
        await api.updateTabGroup(workspace, { agentAccess: true })
      }, tabId)
      if (change === 'close') await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.closeTab(id), tabId)
      if (change === 'cancel') { abort.abort(); await expect.poll(() => cancelled).toBe(true) }
      await electronApp.evaluate(() => (globalThis as Scope).__cookieWriteGate!.release())
      const result = await pending
      // Wait for server settlement even if the SDK already discarded cancellation.
      await expect.poll(() => appWindow.evaluate(() => (window as unknown as { cookieActivities: McpTabActivity[] }).cookieActivities.filter(a => a.phase !== 'started').length)).toBe(1)
      const failed = change !== 'none' || phase === 'lost-ack'
      const calls = failed ? (phase === 'read' ? 0 : 1) : action === 'set' ? 1 : 2
      expect(await electronApp.evaluate(() => (globalThis as Scope).__cookieWriteGate!.calls)).toBe(calls)
      expect(await electronApp.evaluate(() => (globalThis as Scope).__cookieWriteGate!.remaining())).toBe(action === 'set' ? calls : 2 - calls)
      if (change !== 'cancel') {
        expect(result.isError === true).toBe(failed)
        if (failed) {
          expect(result.structuredContent).toMatchObject({ status: calls ? 'OUTCOME_UNKNOWN' : 'NOT_DISPATCHED', effects: calls ? 'possible' : 'none', attemptedWrites: calls, acknowledgedWrites: phase === 'lost-ack' ? 0 : calls, retrySafe: false })
          expect(text(result)).not.toContain('synthetic-cookie-canary')
          expect(text(result)).not.toContain('write-boundary')
        }
      }
      if (failed) await expect.poll(() => appWindow.evaluate(() => (window as unknown as { cookieActivities: McpTabActivity[] }).cookieActivities.filter(a => a.phase === 'failed').at(-1)?.result)).toMatchObject({ dispatch: calls ? 'dispatched' : 'not-dispatched', effects: calls ? 'possible' : 'none' })
    } finally {
      transport.send = send
      await electronApp.evaluate(() => { (globalThis as Scope).__cookieWriteGate?.restore(); delete (globalThis as Scope).__cookieWriteGate }).catch(() => undefined)
      await pending?.catch(() => undefined)
      await appWindow.evaluate(() => (window as unknown as { stopCookies(): void }).stopCookies()).catch(() => undefined)
    }
  })
}
