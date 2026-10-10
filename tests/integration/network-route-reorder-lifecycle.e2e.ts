import type { HronautApi } from '../../src/shared/types.js'
import { expect, test } from './capability-fixtures.js'

type RouteGate = { ready: boolean; release(): void; restore(): void }
type RouteGlobal = typeof globalThis & { __routeReorderGate?: RouteGate }

for (const action of ['clear', 'remove-moving', 'remove-neighbor', 'add', 'move', 'unchanged'] as const) {
  test(`failed network reorder preserves ${action} while native application is pending`, async ({ capabilities, appWindow, electronApp }) => {
    const { tabId, fixtureUrl, fixtureOrigin } = capabilities
    const routes = await appWindow.evaluate(async ({ tabId, origin }) => {
      const api = (window as unknown as { hronaut: HronautApi }).hronaut
      await api.addNetworkRoute(tabId, { urlPattern: `${origin}/route-target`, response: { status: 409, body: 'retained mock' }, times: 2 })
      return api.addNetworkRoute(tabId, { urlPattern: `${origin}/route-target`, response: { status: 418, body: 'moving mock' }, times: 2 })
    }, { tabId, origin: fixtureOrigin })
    const [neighbor, moving] = routes
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
        later = appWindow.evaluate(async ({ tabId, action, movingId, neighborId, origin }) => {
          const api = (window as unknown as { hronaut: HronautApi }).hronaut
          if (action === 'clear') return api.clearNetworkRoutes(tabId)
          if (action === 'remove-moving') return api.removeNetworkRoute(tabId, movingId)
          if (action === 'remove-neighbor') return api.removeNetworkRoute(tabId, neighborId)
          if (action === 'move') return api.moveNetworkRoute(tabId, movingId, 'down')
          return api.addNetworkRoute(tabId, { urlPattern: `${origin}/another-route`, abort: 'Failed' })
        }, { tabId, action, movingId: moving!.id, neighborId: neighbor!.id, origin: fixtureOrigin })
        // Observe the later intent through the real trusted-shell API while its
        // native application waits behind the deliberately held command.
        const expected = action === 'clear' ? []
          : action === 'remove-moving' ? [neighbor!.id]
            : action === 'remove-neighbor' ? [moving!.id]
              : action === 'move' ? [neighbor!.id, moving!.id] : [moving!.id, neighbor!.id]
        await expect.poll(() => appWindow.evaluate(async ({ tabId, action }) => {
          const current = await (window as unknown as { hronaut: HronautApi }).hronaut.listNetworkRoutes(tabId)
          return (action === 'add' ? current.slice(0, 2) : current).map(route => route.id)
        }, { tabId, action })).toEqual(expected)
        if (action === 'add') await expect.poll(() => appWindow.evaluate(async tabId =>
          (await (window as unknown as { hronaut: HronautApi }).hronaut.listNetworkRoutes(tabId)).length, tabId)).toBe(3)
      }
      await electronApp.evaluate(() => (globalThis as RouteGlobal).__routeReorderGate!.release())
      expect(await pending).toContain('Controlled native route application failure')
      await later
      const current = await appWindow.evaluate(async tabId =>
        (window as unknown as { hronaut: HronautApi }).hronaut.listNetworkRoutes(tabId), tabId)
      const expectedIds = action === 'clear' ? []
        : action === 'remove-moving' ? [neighbor!.id]
          : action === 'remove-neighbor' ? [moving!.id]
            : action === 'add' ? [moving!.id, neighbor!.id, current[2]!.id] : [neighbor!.id, moving!.id]
      expect(current.map(route => route.id)).toEqual(expectedIds)
      expect(current.filter(route => route.behavior === 'fulfill').map(route => route.remainingMatches)).toEqual(
        expectedIds.filter(id => id === moving!.id || id === neighbor!.id).map(() => 2)
      )
      await electronApp.evaluate(() => (globalThis as RouteGlobal).__routeReorderGate!.restore())
      const status = await electronApp.evaluate(async ({ webContents }, url) => {
        const contents = webContents.getAllWebContents().find(page => page.getURL() === url)!
        return contents.executeJavaScript("fetch('/route-target').then(response => response.status)")
      }, fixtureUrl)
      expect(status).toBe(action === 'clear' ? 200 : action === 'remove-neighbor' || action === 'add' ? 418 : 409)
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
