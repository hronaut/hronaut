import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { HronautApi } from '../../src/shared/types.js'
import { test, expect, text } from './capability-fixtures.js'
import { waitForSettledPageBounds } from './settled-page-bounds.js'

type WheelGate = { held: boolean; commands: string[]; release: () => void; restore: () => void }
type WheelScope = typeof globalThis & { wheelGate?: WheelGate }

// A wheel refuses when main moves its page while the call waits; let the
// toolbar settle after the fixture selects its tab.
test.beforeEach(async ({ capabilities, electronApp }) => {
  await waitForSettledPageBounds(electronApp, capabilities.fixtureUrl)
})

for (const change of ['unchanged', 'zoom-aba', 'selection-aba', 'bounds-aba', 'pause-aba', 'global-pause-aba', 'access-aba', 'route', 'close', 'cancel', 'frame', 'lock-request', 'global-lock-requests'] as const) {
  test(`wheel revalidates after viewport await: ${change}`, async ({ capabilities, electronApp, appWindow }, testInfo) => {
    const { client, tabId, fixtureUrl } = capabilities
    await electronApp.evaluate(({ webContents }, url) => {
      const page = webContents.getAllWebContents().find(p => p.getURL() === url)!
      const original = page.debugger.sendCommand
      let release!: () => void
      const hold = new Promise<void>(resolve => { release = resolve })
      const gate: WheelGate = { held: false, commands: [], release, restore: () => { release(); if (!page.isDestroyed()) page.debugger.sendCommand = original } }
      ;(globalThis as WheelScope).wheelGate = gate
      page.debugger.sendCommand = async (method, ...args) => {
        if (method === 'Input.dispatchMouseEvent') gate.commands.push(String((args[0] as Record<string, unknown>)?.type))
        if (method === 'Page.getLayoutMetrics' && !gate.held) {
          const result = await original.call(page.debugger, method, ...args)
          gate.held = true
          await hold
          return result
        }
        return original.call(page.debugger, method, ...args)
      }
    }, fixtureUrl)
    const transport = client.transport!
    const send = transport.send.bind(transport)
    let requestId: string | number | undefined
    transport.send = async (message, options) => {
      if ('method' in message && message.method === 'tools/call' && 'id' in message && message.params?.name === 'browser_wheel') requestId = message.id
      return send(message, options)
    }
    const abort = new AbortController()
    let pending: Promise<CallToolResult> | undefined
    let locking: Promise<unknown> | undefined
    try {
      pending = client.callTool({ name: 'browser_wheel', arguments: { tabId, x: 150, y: 150, deltaX: 0, deltaY: 20 } }, undefined, { signal: abort.signal }) as Promise<CallToolResult>
      if (change === 'cancel') pending = pending.catch(() => ({ isError: true, content: [{ type: 'text', text: 'Client cancelled' }] }))
      await expect.poll(() => electronApp.evaluate(() => (globalThis as WheelScope).wheelGate!.held)).toBe(true)
      if (change === 'zoom-aba') await appWindow.evaluate(async id => {
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
          ? "location.hash='wheel-route'" : "document.body.appendChild(document.createElement('iframe'));void 0")
      }, { url: fixtureUrl, change })
      if (change === 'close') await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.closeTab(id), tabId)
      if (change === 'lock-request') {
        locking = appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.setTabHumanInteractionLocked(id, true), tabId)
        void locking.catch(() => undefined)
        // Round-trip through main after the trusted IPC request was sent. The
        // lock itself waits behind this operation's queue, which must reject it.
        await appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState())
      }
      if (change === 'global-lock-requests') {
        locking = appWindow.evaluate(async () => {
          const api = (window as unknown as { hronaut: HronautApi }).hronaut
          await Promise.all([api.setAllHumanInteractionLocked(true), api.setAllHumanInteractionLocked(false)])
        })
        void locking.catch(() => undefined)
        await appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState())
      }
      if (change === 'cancel') {
        if (requestId === undefined) throw new Error('Missing wheel request ID')
        await client.notification({ method: 'notifications/cancelled', params: { requestId, reason: 'Controlled wheel cancellation' } })
        abort.abort()
      }
      await electronApp.evaluate(() => (globalThis as WheelScope).wheelGate!.release())
      const result = await pending
      await locking
      // Cancellation can settle the transport before the server. Observe the
      // terminal activity from the trusted Home endpoint before checking input.
      await expect.poll(() => electronApp.evaluate(async ({ webContents }, id) => {
        const home = webContents.getAllWebContents().find(p => p.getURL().startsWith('hronaut://home'))!
        const state = await (await home.session.fetch('hronaut://home/api/status')).json() as { recentActivity: Array<{ toolName: string; tabId: string }> }
        return state.recentActivity.filter(activity => activity.toolName === 'browser_wheel' && activity.tabId === id).length
      }, tabId)).toBe(1)
      const commands = await electronApp.evaluate(() => (globalThis as WheelScope).wheelGate!.commands)
      await testInfo.attach('wheel-authority', { body: JSON.stringify({ change, result, commands }), contentType: 'application/json' })
      expect(result.isError === true, text(result)).toBe(change !== 'unchanged')
      expect(commands).toEqual(change === 'unchanged' ? ['mouseWheel'] : [])
    } finally {
      transport.send = send
      await electronApp.evaluate(() => { (globalThis as WheelScope).wheelGate?.restore(); delete (globalThis as WheelScope).wheelGate }).catch(() => undefined)
      await Promise.allSettled([pending, locking].filter((p): p is Promise<CallToolResult> => p !== undefined))
    }
  })
}
