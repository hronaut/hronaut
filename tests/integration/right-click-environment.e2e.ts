import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { HronautApi } from '../../src/shared/types.js'
import { test, expect, text } from './capability-fixtures.js'
import { installRightClickGate, rightClickSettlement, type RightClickScope as RightScope } from './right-click-diagnostics.js'

for (const change of ['unchanged', 'zoom-aba', 'selection-aba', 'bounds-aba', 'pause-aba', 'global-pause-aba', 'access-aba', 'route', 'close', 'cancel', 'frame', 'global-lock-requests', 'cleanup-zoom-aba'] as const) {
  test(`right-click revalidates after viewport await: ${change}`, async ({ capabilities, electronApp, appWindow }, testInfo) => {
    const { client, tabId, fixtureUrl } = capabilities
    await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.setTabHumanInteractionLocked(id, true), tabId)
    await electronApp.evaluate(async ({ webContents }, url) => { await webContents.getAllWebContents().find(page => page.getURL() === url)!.executeJavaScript("document.body.innerHTML='<button id=target>Menu</button>';document.querySelector('button').oncontextmenu=e=>e.preventDefault();void 0") }, fixtureUrl)
    await electronApp.evaluate(installRightClickGate, { url: fixtureUrl, cleanup: change === 'cleanup-zoom-aba' })
    const transport = client.transport!
    const send = transport.send.bind(transport)
    let requestId: string | number | undefined
    transport.send = async (message, options) => {
      if ('method' in message && message.method === 'tools/call' && 'id' in message && message.params?.name === 'browser_click') requestId = message.id
      return send(message, options)
    }
    const abort = new AbortController()
    let pending: Promise<CallToolResult> | undefined
    let requestStartedAt: number | undefined
    let settlement: Record<string, unknown> = { state: 'not-started' }
    try {
      requestStartedAt = Date.now()
      settlement = { at: requestStartedAt, state: 'pending' }
      pending = client.callTool({ name: 'browser_click', arguments: { tabId, selector: '#target', native: true, button: 'right' } }, undefined, { signal: abort.signal }) as Promise<CallToolResult>
      // Observe the original promise, including cancellation, without replacing it.
      void pending.then(result => { settlement = rightClickSettlement(result) }, () => { settlement = { at: Date.now(), state: 'rejected' } })
      if (change === 'cancel') pending = pending.catch(() => ({ isError: true, content: [{ type: 'text', text: 'Client cancelled' }] }))
      await expect.poll(() => electronApp.evaluate(() => (globalThis as RightScope).rightClickGate!.held)).toBe(true)
      if (change === 'zoom-aba' || change === 'cleanup-zoom-aba') await appWindow.evaluate(async id => {
        const api = (window as unknown as { hronaut: HronautApi }).hronaut
        await api.setZoom({ tabId: id, action: 'set', percent: 125 })
        await api.setZoom({ tabId: id, action: 'reset' })
      }, tabId)
      if (change === 'selection-aba') await appWindow.evaluate(async id => {
        const api = (window as unknown as { hronaut: HronautApi }).hronaut
        const other = (await api.getState()).tabs.find(tab => tab.id !== id && !tab.sleeping)!
        await api.selectTab(other.id)
        await api.selectTab(id)
      }, tabId)
      if (change === 'pause-aba') await appWindow.evaluate(async id => {
        const api = (window as unknown as { hronaut: HronautApi }).hronaut
        await api.setTabAgentPaused(id, true)
        await api.setTabAgentPaused(id, false)
      }, tabId)
      if (change === 'access-aba') await appWindow.evaluate(async id => {
        const api = (window as unknown as { hronaut: HronautApi }).hronaut
        const workspace = (await api.getState()).tabs.find(tab => tab.id === id)!.mcpGroupId!
        await api.updateTabGroup(workspace, { agentAccess: false })
        await api.updateTabGroup(workspace, { agentAccess: true })
      }, tabId)
      if (change === 'global-pause-aba') await appWindow.evaluate('window.hronautMcp.setPaused(true).then(()=>window.hronautMcp.setPaused(false))')
      if (change === 'bounds-aba') await electronApp.evaluate(({ BrowserWindow, webContents }, url) => {
        const page = webContents.getAllWebContents().find(p => p.getURL() === url)!
        const owner = BrowserWindow.getAllWindows().find(window => window.contentView.children.some(view => 'webContents' in view && view.webContents === page))!
        const view = owner.contentView.children.find(view => 'webContents' in view && view.webContents === page)!
        const bounds = view.getBounds()
        view.setBounds({ ...bounds, width: bounds.width - 1 })
        view.setBounds(bounds)
      }, fixtureUrl)
      if (change === 'route' || change === 'frame') await electronApp.evaluate(async ({ webContents }, { url, change }) => {
        await webContents.getAllWebContents().find(p => p.getURL() === url)!.executeJavaScript(change === 'route'
          ? "location.hash='rightClick-route'" : "document.body.appendChild(document.createElement('iframe'));void 0")
      }, { url: fixtureUrl, change })
      if (change === 'close') await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.closeTab(id), tabId)
      if (change === 'global-lock-requests') {
        const rejected = await appWindow.evaluate(async () => {
          const api = (window as unknown as { hronaut: HronautApi }).hronaut
          const results = await Promise.allSettled([api.setAllHumanInteractionLocked(true), api.setAllHumanInteractionLocked(false)])
          return results.map(result => result.status)
        })
        expect(rejected).toEqual(['rejected', 'rejected'])
      }
      if (change === 'cancel') {
        if (requestId === undefined) throw new Error('Missing rightClick request ID')
        await client.notification({ method: 'notifications/cancelled', params: { requestId, reason: 'Controlled rightClick cancellation' } })
        abort.abort()
      }
      await electronApp.evaluate(() => (globalThis as RightScope).rightClickGate!.release())
      const result = await pending
      // Cancellation can settle the transport before the server. Observe the
      // terminal activity from the trusted Home endpoint before checking input.
      await expect.poll(() => electronApp.evaluate(async ({ webContents }, id) => {
        const home = webContents.getAllWebContents().find(p => p.getURL().startsWith('hronaut://home'))!
        const state = await (await home.session.fetch('hronaut://home/api/status')).json() as { recentActivity: Array<{ toolName: string; tabId: string }> }
        return state.recentActivity.filter(activity => activity.toolName === 'browser_click' && activity.tabId === id).length
      }, tabId)).toBe(1)
      if (change === 'cancel') await expect.poll(() => electronApp.evaluate(async ({ webContents }, id) => {
        const home = webContents.getAllWebContents().find(page => page.getURL().startsWith('hronaut://home'))!
        const state = await (await home.session.fetch('hronaut://home/api/status')).json() as { recentActivity: Array<{ toolName: string; tabId: string; result: unknown }> }
        return state.recentActivity.find(row => row.toolName === 'browser_click' && row.tabId === id)?.result
      }, tabId)).toMatchObject({ outcome: 'cancelled', reasonCode: 'REQUEST_CANCELLED', effects: 'possible' })
      const commands = await electronApp.evaluate(() => (globalThis as RightScope).rightClickGate!.commands)
      await testInfo.attach('rightClick-authority', { body: JSON.stringify({ change, result, commands }), contentType: 'application/json' })
      expect(result.isError === true, text(result)).toBe(change !== 'unchanged')
      expect(commands).toEqual(change === 'unchanged' || change === 'cleanup-zoom-aba' ? ['mouseMoved', 'mousePressed', 'mouseReleased'] : ['mouseMoved'])
    } finally {
      try {
        // Capture before releasing held work: cleanup must not turn a pending
        // preparation into a misleading successful diagnostic outcome.
        const gate = await electronApp.evaluate(() => {
          const gate = (globalThis as RightScope).rightClickGate!
          return { held: gate.held, events: gate.events, dropped: gate.dropped }
        })
        await testInfo.attach('right-click-pre-cleanup', {
          body: JSON.stringify({ change, requestStartedAt, capturedAt: Date.now(), requestObserved: requestId !== undefined, settlement, gate }), contentType: 'application/json'
        })
      } finally {
        transport.send = send
        await electronApp.evaluate(() => { (globalThis as RightScope).rightClickGate?.restore(); delete (globalThis as RightScope).rightClickGate }).catch(() => undefined)
        await Promise.allSettled([pending].filter((p): p is Promise<CallToolResult> => p !== undefined))
      }
    }
  })
}
