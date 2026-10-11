import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { HronautApi } from '../../src/shared/types.js'
import { test, expect, text } from './capability-fixtures.js'
import { setupHoldPage, observeHold, holdObservation, restoreHold, type HoldScope } from './key-hold-fixture.js'

for (const phase of ['before-down', 'held'] as const) for (const change of ['pause-aba', 'global-pause-aba', 'access-aba', 'selection-aba', 'route', 'navigation', 'close', 'cancel', 'tab-lock', 'global-lock', 'lock-aba', 'child-frame'] as const) {
  test(`key hold rejects ${change} ${phase} and contains cleanup`, async ({ capabilities, electronApp, appWindow }, testInfo) => {
    const { client, tabId, fixtureUrl } = capabilities
    await setupHoldPage(electronApp, fixtureUrl)
    if (phase === 'before-down') await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.setTabHumanInteractionLocked(id, true), tabId)
    await observeHold(electronApp, fixtureUrl, phase === 'before-down' ? 'before-down' : 'none')
    const transport = client.transport!
    const send = transport.send.bind(transport)
    let requestId: string | number | undefined
    transport.send = async (message, options) => {
      if ('method' in message && message.method === 'tools/call' && 'id' in message && message.params?.name === 'browser_hold_key') requestId = message.id
      return send(message, options)
    }
    const abort = new AbortController()
    let pending: Promise<CallToolResult> | undefined
    let locking: Promise<unknown> | undefined
    try {
      pending = client.callTool({ name: 'browser_hold_key', arguments: { tabId, key: 'ArrowRight', durationMs: 5000 } }, undefined, { signal: abort.signal }) as Promise<CallToolResult>
      if (change === 'cancel') pending = pending.catch(() => ({ isError: true, content: [{ type: 'text', text: 'Client cancelled' }] }))
      await expect.poll(() => electronApp.evaluate((_electron, phase) => phase === 'before-down' ? (globalThis as HoldScope).holdProbe!.ready : (globalThis as HoldScope).holdProbe!.downAcknowledged, phase)).toBe(true)
      const triggeredAt = Date.now()
      if (change === 'pause-aba') await appWindow.evaluate(async id => {
        const api = (window as unknown as { hronaut: HronautApi }).hronaut
        await api.setTabAgentPaused(id, true); await api.setTabAgentPaused(id, false)
      }, tabId)
      if (change === 'global-pause-aba') await appWindow.evaluate('window.hronautMcp.setPaused(true).then(()=>window.hronautMcp.setPaused(false))')
      if (change === 'access-aba') await appWindow.evaluate(async id => {
        const api = (window as unknown as { hronaut: HronautApi }).hronaut
        const group = (await api.getState()).tabs.find(t => t.id === id)!.mcpGroupId!
        await api.updateTabGroup(group, { agentAccess: false }); await api.updateTabGroup(group, { agentAccess: true })
      }, tabId)
      if (change === 'selection-aba') await appWindow.evaluate(async id => {
        const api = (window as unknown as { hronaut: HronautApi }).hronaut
        const other = (await api.getState()).tabs.find(t => t.id !== id && !t.sleeping)!
        await api.selectTab(other.id); await api.selectTab(id)
      }, tabId)
      if (change === 'route' || change === 'child-frame') await electronApp.evaluate(async ({ webContents }, { url, change }) => webContents.getAllWebContents().find(p => p.getURL() === url)!.executeJavaScript(change === 'route' ? "location.hash='hold-route';void 0" : "document.body.appendChild(document.createElement('iframe'));void 0"), { url: fixtureUrl, change })
      if (change === 'navigation') await electronApp.evaluate(async ({ webContents }) => {
        const page = webContents.fromId((globalThis as HoldScope).holdProbe!.pageId)!
        await page.loadURL('data:text/html,<title>Replacement document</title><p>Replaced</p>')
        if (await page.executeJavaScript('document.title') !== 'Replacement document') throw new Error('Document was not replaced')
      })
      if (change === 'close') await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.closeTab(id), tabId)
      if (change === 'tab-lock' || change === 'global-lock' || change === 'lock-aba') {
        locking = appWindow.evaluate(async ({ id, change }) => {
          const api = (window as unknown as { hronaut: HronautApi }).hronaut
          if (change === 'tab-lock') return api.setTabHumanInteractionLocked(id, true)
          if (change === 'global-lock') return api.setAllHumanInteractionLocked(true)
          return Promise.all([api.setAllHumanInteractionLocked(true), api.setAllHumanInteractionLocked(false)])
        }, { id: tabId, change })
        void locking.catch(() => undefined)
        await appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState())
      }
      if (change === 'cancel') {
        if (requestId === undefined) throw new Error('Missing key hold request ID')
        await client.notification({ method: 'notifications/cancelled', params: { requestId, reason: 'Controlled hold cancellation' } })
        abort.abort()
      }
      if (phase === 'before-down') await electronApp.evaluate(() => (globalThis as HoldScope).holdProbe!.release())
      const result = await pending
      await locking // A lock request must succeed within its existing preparation budget.
      const activity = () => electronApp.evaluate(async ({ webContents }, id) => {
        const home = webContents.getAllWebContents().find(p => p.getURL().startsWith('hronaut://home'))!
        const state = await (await home.session.fetch('hronaut://home/api/status')).json() as { recentActivity: Array<{ toolName: string; tabId: string; result: { outcome: string; effects: string; dispatch: string } }> }
        return state.recentActivity.filter(a => a.toolName === 'browser_hold_key' && a.tabId === id)
      }, tabId)
      await expect.poll(activity).toHaveLength(1)
      const terminal = (await activity())[0]!.result
      expect(terminal).toMatchObject({ effects: phase === 'held' ? 'possible' : 'none', dispatch: phase === 'held' ? 'dispatched' : 'not-dispatched' })
      if (change === 'cancel') expect(terminal.outcome).toBe('cancelled')
      if (change === 'close' && phase === 'held') expect(terminal.outcome).toBe('outcome-unknown')
      const observed = await holdObservation(electronApp)
      await testInfo.attach('key-hold-authority', { body: JSON.stringify({ phase, change, triggeredAt, result, terminal, observed }), contentType: 'application/json' })
      expect(result.isError, text(result)).toBe(true)
      expect(observed.commands.map(c => c.type)).toEqual(phase === 'held' ? (change === 'close' ? ['rawKeyDown'] : ['rawKeyDown', 'keyUp']) : [])
      if (phase === 'before-down' && change !== 'cancel') expect(result.structuredContent).toMatchObject({ status: 'NOT_DISPATCHED', effects: 'none' })
      if (phase === 'held') {
        if (change === 'close') expect(observed.destroyed).toBe(true)
        else expect(observed.commands[1]!.at - triggeredAt).toBeLessThan(1500)
        if (change !== 'cancel') expect(result.structuredContent).toMatchObject({ status: 'OUTCOME_UNKNOWN', retrySafe: false, release: change === 'close' ? 'UNCONFIRMED' : 'ACKNOWLEDGED' })
        expect(observed.upAcknowledged).toBe(change !== 'close')
        if (change === 'navigation') expect(observed.effects).toBeNull()
        if (change !== 'close' && change !== 'navigation') await expect.poll(async () => (await holdObservation(electronApp)).effects?.held).toBe(false)
        if (change !== 'close' && change !== 'navigation') {
          const released = (await holdObservation(electronApp)).effects!.events.find(e => e.type === 'keyup')!
          expect(released.wallTime - triggeredAt).toBeLessThan(1500)
        }
      }
    } finally {
      transport.send = send
      await restoreHold(electronApp)
      await Promise.allSettled([pending, locking].filter((p): p is Promise<CallToolResult> => p !== undefined))
    }
  })
}
