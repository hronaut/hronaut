import type { HronautApi } from '../../src/shared/types.js'
import { expect, test } from './capability-fixtures.js'

type Probe = { armed: boolean; commands: string[]; monitored: boolean; refresh?: () => void; restore(): void }
type Scope = typeof globalThis & { __conditionBackground?: Probe }

test('unknown conditions fence consumption refresh, reattachment, emulation and DevTools with zero rows', async ({ capabilities, appWindow, electronApp }) => {
  const { tabId, fixtureUrl, fixtureOrigin } = capabilities
  await appWindow.evaluate(async ({ tabId, fixtureOrigin }) =>
    (window as unknown as { hronaut: HronautApi }).hronaut.addNetworkRoute(tabId, { urlPattern: `${fixtureOrigin}/route-target`, times: 1, response: { status: 409 } }), { tabId, fixtureOrigin })
  await electronApp.evaluate(({ webContents }, fixtureUrl) => {
    const page = webContents.getAllWebContents().find(p => p.getURL() === fixtureUrl)!
    const api = page.debugger, original = api.sendCommand, timeout = globalThis.setTimeout
    const timers: NodeJS.Timeout[] = []
    const probe: Probe = { armed: false, commands: [], monitored: false, restore: () => { api.sendCommand = original; globalThis.setTimeout = timeout; for (const timer of timers) clearTimeout(timer) } }
    ;(globalThis as Scope).__conditionBackground = probe
    // Retain the real production callback, controlling only when its scheduled
    // consumption refresh runs; unrelated timers keep their normal behavior.
    globalThis.setTimeout = ((callback: (...args: unknown[]) => void, delay: number, ...args: unknown[]) => {
      if (delay === 250 && String(callback).includes('networkRouteRefreshTimers')) {
        probe.refresh = () => callback(...args)
        const timer = timeout(() => {}, 60_000); timers.push(timer); return timer
      }
      return timeout(callback, delay, ...args)
    }) as typeof setTimeout
    api.sendCommand = async (method, ...args) => {
      if (/^(Emulation\.|Animation\.|Overlay\.|Network\.(set|emulate|override))/.test(method) || ['Fetch.enable', 'Fetch.disable'].includes(method)) probe.commands.push(method)
      const result = await original.call(api, method, ...args)
      if (probe.armed && method === 'Network.emulateNetworkConditionsByRule') throw new Error('Controlled native lost acknowledgement')
      if (method === 'Input.setIgnoreInputEvents') probe.monitored = true
      return result
    }
  }, fixtureUrl)
  try {
    expect(await electronApp.evaluate(async ({ webContents }, fixtureUrl) => webContents.getAllWebContents().find(p => p.getURL() === fixtureUrl)!.executeJavaScript("fetch('/route-target').then(r=>r.status)"), fixtureUrl)).toBe(409)
    await expect.poll(() => electronApp.evaluate(() => Boolean((globalThis as Scope).__conditionBackground!.refresh))).toBe(true)
    await electronApp.evaluate(() => { (globalThis as Scope).__conditionBackground!.armed = true })
    const error = await appWindow.evaluate(async tabId => {
      try { await (window as unknown as { hronaut: HronautApi }).hronaut.clearNetworkRoutes(tabId); return '' }
      catch (error) { return String(error) }
    }, tabId)
    expect(error).toContain('Controlled native lost acknowledgement')
    const before = await electronApp.evaluate(() => [...(globalThis as Scope).__conditionBackground!.commands])
    await electronApp.evaluate(() => (globalThis as Scope).__conditionBackground!.refresh!())
    await electronApp.evaluate(({ webContents }, fixtureUrl) => webContents.getAllWebContents().find(p => p.getURL() === fixtureUrl)!.debugger.detach(), fixtureUrl)
    await expect.poll(() => electronApp.evaluate(() => (globalThis as Scope).__conditionBackground!.monitored)).toBe(true)
    const refusals = await appWindow.evaluate(async tabId => {
      const api = (window as unknown as { hronaut: HronautApi }).hronaut
      const results = []
      for (const operation of [() => api.toggleDevTools(tabId), () => api.setTabViewport(tabId, { width: 900, height: 700, deviceScaleFactor: 1, mobile: false, touch: false, orientation: 'landscape' })]) {
        try { await operation(); results.push('unexpected success') } catch (error) { results.push(String(error)) }
      }
      return results
    }, tabId)
    expect(refusals).toHaveLength(2)
    expect(refusals[0]).toContain('unknown')
    // The shell reads the sentence for a person; MCP results keep the instruction not to replay the request.
    expect(refusals[1]).toContain('Emulation is unconfirmed. Open Environment and restore the retained settings')
    expect(await electronApp.evaluate(() => (globalThis as Scope).__conditionBackground!.commands)).toEqual(before)
    const beforeClear = await appWindow.evaluate(async tabId => (await (window as unknown as { hronaut: HronautApi }).hronaut.getState()).tabs.find(t => t.id === tabId)!, tabId)
    expect(beforeClear.networkConditionState).toEqual({ application: 'unknown', retainedRules: [] })
    expect(beforeClear.emulation).toBeUndefined()
    expect(beforeClear.emulationState).toMatchObject({ application: 'unknown', recovery: 'restore-committed' })
    await electronApp.evaluate(() => { (globalThis as Scope).__conditionBackground!.armed = false })
    await appWindow.evaluate(async tabId => (window as unknown as { hronaut: HronautApi }).hronaut.clearNetworkRoutes(tabId), tabId)
    const afterClear = await appWindow.evaluate(async tabId => (await (window as unknown as { hronaut: HronautApi }).hronaut.getState()).tabs.find(t => t.id === tabId)!, tabId)
    expect(afterClear.networkConditionState).toEqual({ application: 'confirmed', retainedRules: [] })
    expect(afterClear.emulation).toBeUndefined()
    expect(afterClear.emulationState).toEqual(beforeClear.emulationState)
    expect(await electronApp.evaluate(async ({ webContents }, fixtureUrl) => webContents.getAllWebContents().find(p => p.getURL() === fixtureUrl)!.executeJavaScript("fetch('/route-target').then(r=>r.status)"), fixtureUrl)).toBe(200)
  } finally {
    await electronApp.evaluate(() => { (globalThis as Scope).__conditionBackground?.restore(); delete (globalThis as Scope).__conditionBackground }).catch(() => undefined)
  }
})

test('explicit condition clear preserves acknowledged tab-wide network emulation', async ({ capabilities, appWindow, electronApp }) => {
  const { client, tabId, fixtureUrl, fixtureOrigin } = capabilities
  const emulated = await client.callTool({ name: 'browser_emulate', arguments: { tabId, network: 'slow-3g' } })
  expect(emulated.isError).not.toBe(true)
  await appWindow.evaluate(async ({ tabId, fixtureOrigin }) => {
    const api = (window as unknown as { hronaut: HronautApi }).hronaut
    await api.addNetworkRoute(tabId, { urlPattern: `${fixtureOrigin}/route-target`, times: 1, response: { status: 409 } })
    await api.clearNetworkRoutes(tabId)
  }, { tabId, fixtureOrigin })
  const observed = await electronApp.evaluate(async ({ webContents }, fixtureUrl) => webContents.getAllWebContents().find(p => p.getURL() === fixtureUrl)!.executeJavaScript("(async()=>{const start=performance.now();const response=await fetch('/route-target');await response.text();return {status:response.status,elapsed:performance.now()-start}})()"), fixtureUrl)
  expect(observed.status).toBe(200)
  expect(observed.elapsed).toBeGreaterThanOrEqual(1500)
  const tab = await appWindow.evaluate(async tabId => (await (window as unknown as { hronaut: HronautApi }).hronaut.getState()).tabs.find(t => t.id === tabId)!, tabId)
  expect(tab.emulation?.network).toBe('slow-3g')
  expect(tab.networkConditionState).toEqual({ application: 'confirmed', retainedRules: [] })
})
