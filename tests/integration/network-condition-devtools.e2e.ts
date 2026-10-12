import type { HronautApi } from '../../src/shared/types.js'
import { expect, test } from './capability-fixtures.js'

type HandoffGate = { waiting: boolean; commands: string[]; detached: number; opened: number; release(): void; restore(): void }
type HandoffScope = typeof globalThis & { __conditionHandoff?: HandoffGate }

for (const mode of ['pending-rows', 'pending-empty', 'confirmed-before-wait', 'confirmed-rows-before-wait'] as const) {
  test(`DevTools cannot recover a failed queued condition application: ${mode}`, async ({ capabilities, electronApp, appWindow }) => {
    const { tabId, fixtureUrl, fixtureOrigin } = capabilities
    if (mode === 'confirmed-rows-before-wait') await appWindow.evaluate(async ({ tabId, fixtureOrigin }) => (window as unknown as { hronaut: HronautApi }).hronaut.addNetworkRoute(tabId, { urlPattern: `${fixtureOrigin}/route-target`, times: 3, response: { status: 409 } }), { tabId, fixtureOrigin })
    await electronApp.evaluate(({ webContents }, { fixtureUrl, mode }) => {
      const page = webContents.getAllWebContents().find(p => p.getURL() === fixtureUrl)!
      const api = page.debugger, original = api.sendCommand
      let release!: () => void
      const barrier = new Promise<void>(resolve => { release = resolve })
      const detached = (): void => { gate.detached++ }
      const opened = (): void => { gate.opened++ }
      const gate: HandoffGate = { waiting: false, commands: [], detached: 0, opened: 0, release, restore: () => {
        release(); if (!page.isDestroyed()) { api.sendCommand = original; api.removeListener('detach', detached); page.removeListener('devtools-opened', opened) }
      } }
      ;(globalThis as HandoffScope).__conditionHandoff = gate
      api.on('detach', detached)
      page.on('devtools-opened', opened)
      api.sendCommand = async (method, ...args) => {
        if (['Fetch.enable','Fetch.disable','Network.emulateNetworkConditionsByRule','Network.overrideNetworkState','Network.emulateNetworkConditions'].includes(method)) gate.commands.push(method)
        const result = await original.call(api, method, ...args)
        const hold = mode.startsWith('confirmed') ? 'Network.setCacheDisabled' : mode === 'pending-rows' ? 'Fetch.enable' : 'Fetch.disable'
        if (!gate.waiting && method === hold) { gate.waiting = true; await barrier; if (!mode.startsWith('confirmed')) throw new Error('Controlled lost condition acknowledgement before DevTools') }
        if (mode.startsWith('confirmed') && method === 'Network.emulateNetworkConditionsByRule') throw new Error('Controlled lost condition acknowledgement during handoff wait')
        return result
      }
    }, { fixtureUrl, mode })
    let application: Promise<string> | undefined
    let handoff: Promise<string> | undefined
    try {
      application = appWindow.evaluate(async ({ tabId, fixtureOrigin, mode }) => {
        const api = (window as unknown as { hronaut: HronautApi }).hronaut
        try {
          if (mode === 'pending-rows') await api.addNetworkRoute(tabId, { urlPattern: `${fixtureOrigin}/route-target`, times: 3, response: { status: 409 } })
          else if (mode === 'pending-empty') await api.clearNetworkRoutes(tabId)
          else await api.setTabViewport(tabId, { width: 900, height: 700, deviceScaleFactor: 1, mobile: false, touch: false, orientation: 'landscape' })
          return 'unexpected application success'
        } catch (error) { return String(error) }
      }, { tabId, fixtureOrigin, mode })
      await expect.poll(() => electronApp.evaluate(() => (globalThis as HandoffScope).__conditionHandoff!.waiting)).toBe(true)
      handoff = appWindow.evaluate(async tabId => {
        try { await (window as unknown as { hronaut: HronautApi }).hronaut.toggleDevTools(tabId); return 'unexpected DevTools success' }
        catch (error) { return String(error) }
      }, tabId)
      // Same-renderer IPC barrier proves the handoff request preceded release.
      const pending = await appWindow.evaluate(async id => (await (window as unknown as { hronaut: HronautApi }).hronaut.getState()).tabs.find(t => t.id === id)!.networkConditionState!, tabId)
      expect(pending.application).toBe(mode.startsWith('confirmed') ? 'confirmed' : 'pending')
      expect(pending.retainedRules).toHaveLength(mode === 'pending-rows' || mode === 'confirmed-rows-before-wait' ? 1 : 0)
      await electronApp.evaluate(() => (globalThis as HandoffScope).__conditionHandoff!.release())
      expect(await application).toContain('Controlled lost condition acknowledgement')
      const handoffResult = await handoff
      const native = await electronApp.evaluate(({ webContents }, fixtureUrl) => {
        const page = webContents.getAllWebContents().find(p => p.getURL() === fixtureUrl)!
        const gate = (globalThis as HandoffScope).__conditionHandoff!
        return { commands: gate.commands, detached: gate.detached, opened: gate.opened, attached: page.debugger.isAttached(), devTools: page.isDevToolsOpened() }
      }, fixtureUrl)
      console.log(JSON.stringify({ scenario: `devtools-${mode}`, handoffRejected: handoffResult !== 'unexpected DevTools success', ...native }))
      expect(handoffResult).not.toBe('unexpected DevTools success')
      expect(native).toEqual({ commands: mode.startsWith('confirmed') ? ['Network.emulateNetworkConditionsByRule'] : [mode === 'pending-rows' ? 'Fetch.enable' : 'Fetch.disable'], detached: 0, opened: 0, attached: true, devTools: false })
      const health = await appWindow.evaluate(async id => (await (window as unknown as { hronaut: HronautApi }).hronaut.getState()).tabs.find(t => t.id === id)!.networkConditionState!, tabId)
      expect(health.application).toBe('unknown')
      expect(health.retainedRules).toHaveLength(mode === 'pending-rows' || mode === 'confirmed-rows-before-wait' ? 1 : 0)
    } finally {
      await electronApp.evaluate(() => { (globalThis as HandoffScope).__conditionHandoff?.restore(); delete (globalThis as HandoffScope).__conditionHandoff }).catch(() => undefined)
      await Promise.allSettled([...(application ? [application] : []), ...(handoff ? [handoff] : [])])
    }
  })
}
