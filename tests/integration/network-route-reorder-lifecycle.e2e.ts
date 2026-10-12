import type { HronautApi } from '../../src/shared/types.js'
import { expect, test } from './capability-fixtures.js'

type RouteGate = { ready: boolean; release(): void; restore(): void }
type RouteGlobal = typeof globalThis & { __routeReorderGate?: RouteGate }

for (const action of ['clear', 'remove-moving', 'remove-neighbor', 'remove-unknown', 'remove-stale', 'add', 'move', 'unchanged'] as const) {
  test(`failed network reorder preserves ${action} while native application is pending`, async ({ capabilities, appWindow, electronApp }) => {
    const { tabId, fixtureUrl, fixtureOrigin } = capabilities
    const routes = await appWindow.evaluate(async ({ tabId, origin }) => {
      const api = (window as unknown as { hronaut: HronautApi }).hronaut
      await api.addNetworkRoute(tabId, { urlPattern: `${origin}/route-target`, response: { status: 409, body: 'retained mock' }, times: 2 })
      return api.addNetworkRoute(tabId, { urlPattern: `${origin}/route-target`, response: { status: 418, body: 'moving mock' }, times: 2 })
    }, { tabId, origin: fixtureOrigin })
    const [neighbor, moving] = routes
    const missingId = action === 'remove-stale' ? await appWindow.evaluate(async ({ tabId, origin }) => {
      const api = (window as unknown as { hronaut: HronautApi }).hronaut
      const added = await api.addNetworkRoute(tabId, { urlPattern: `${origin}/retired-route`, abort: 'Failed' })
      const staleId = added.at(-1)!.id
      await api.removeNetworkRoute(tabId, staleId)
      return staleId
    }, { tabId, origin: fixtureOrigin }) : '00000000-0000-4000-8000-000000000000'
    await electronApp.evaluate(({ webContents }, url) => {
      const contents = webContents.getAllWebContents().find(page => page.getURL() === url)!
      const debuggerApi = contents.debugger
      const original = debuggerApi.sendCommand
      let release!: () => void
      const barrier = new Promise<void>(resolve => { release = resolve })
      const gate: RouteGate = { ready: false, release, restore: () => { debuggerApi.sendCommand = original } }
      ;(globalThis as RouteGlobal).__routeReorderGate = gate
      debuggerApi.sendCommand = async (method, ...args) => {
        if (method === 'Fetch.enable' && !gate.ready) {
          gate.ready = true
          await barrier
          throw new Error('Controlled native route application failure')
        }
        return original.call(debuggerApi, method, ...args)
      }
    }, fixtureUrl)
    let later: Promise<unknown> | undefined
    const pending = appWindow.evaluate(async ({ tabId, routeId }) => {
      try {
        await (window as unknown as { hronaut: HronautApi }).hronaut.moveNetworkRoute(tabId, routeId, 'up')
        return 'unexpected success'
      } catch (error) { return String(error) }
    }, { tabId, routeId: moving!.id })
    try {
      await expect.poll(() => electronApp.evaluate(() => (globalThis as RouteGlobal).__routeReorderGate?.ready)).toBe(true)
      if (action !== 'unchanged') {
        later = appWindow.evaluate(async ({ tabId, action, movingId, neighborId, missingId, origin }) => {
          const api = (window as unknown as { hronaut: HronautApi }).hronaut
          try {
            if (action === 'clear') return await api.clearNetworkRoutes(tabId)
            if (action === 'remove-unknown' || action === 'remove-stale') return await api.removeNetworkRoute(tabId, missingId)
            if (action === 'remove-moving') return await api.removeNetworkRoute(tabId, movingId)
            if (action === 'remove-neighbor') return await api.removeNetworkRoute(tabId, neighborId)
            if (action === 'move') return await api.moveNetworkRoute(tabId, movingId, 'down')
            return await api.addNetworkRoute(tabId, { urlPattern: `${origin}/another-route`, abort: 'Failed' })
          } catch (error) { return String(error) }
        }, { tabId, action, movingId: moving!.id, neighborId: neighbor!.id, missingId, origin: fixtureOrigin })
      }
      // Later edits wait for queue admission. The earlier proposed order is
      // explicitly pending, never exposed as confirmed by the array endpoint.
      const pendingState = await appWindow.evaluate(async tabId =>
        (await (window as unknown as { hronaut: HronautApi }).hronaut.getState()).tabs.find(tab => tab.id === tabId)!.networkConditionState, tabId)
      expect(pendingState?.application).toBe('pending')
      expect(pendingState?.retainedRules.map(route => route.id)).toEqual([moving!.id, neighbor!.id])
      await electronApp.evaluate(() => (globalThis as RouteGlobal).__routeReorderGate!.release())
      expect(await pending).toContain('Controlled native route application failure')
      const laterResult = await later
      if (later && action !== 'clear') expect(laterResult).toContain('unknown')
      const current = await appWindow.evaluate(async tabId =>
        (await (window as unknown as { hronaut: HronautApi }).hronaut.getState()).tabs.find(tab => tab.id === tabId)!.networkConditionState, tabId)
      expect(current?.application).toBe(action === 'clear' ? 'confirmed' : 'unknown')
      expect(current?.retainedRules.map(route => route.id)).toEqual(action === 'clear' ? [] : [moving!.id, neighbor!.id])
      expect(current?.retainedRules.map(route => route.remainingMatches)).toEqual(action === 'clear' ? [] : [2, 2])
      await electronApp.evaluate(() => (globalThis as RouteGlobal).__routeReorderGate!.restore())
      if (action !== 'clear') await appWindow.evaluate(async tabId =>
        (window as unknown as { hronaut: HronautApi }).hronaut.clearNetworkRoutes(tabId), tabId)
      const status = await electronApp.evaluate(async ({ webContents }, url) => {
        const contents = webContents.getAllWebContents().find(page => page.getURL() === url)!
        return contents.executeJavaScript("fetch('/route-target').then(response => response.status)")
      }, fixtureUrl)
      expect(status).toBe(200)
    } finally {
      await electronApp.evaluate(() => {
        const gate = (globalThis as RouteGlobal).__routeReorderGate
        gate?.release()
        gate?.restore()
        delete (globalThis as RouteGlobal).__routeReorderGate
      })
      await Promise.allSettled([pending, ...(later ? [later] : [])])
    }
  })
}
