import type { HronautApi } from '../../src/shared/types.js'
import { expect, test } from './capability-fixtures.js'

type Gate = { waiting: boolean; dispositions: string[]; paused: number; release(): void; restore(): void }
type Scope = typeof globalThis & { __conditionDisposition?: Gate }

for (const mode of ['failure-during-application', 'clear-after-submit', 'clear-after-lost-ack', 'clear-before-queued', 'add-before-lost-ack', 'remove-before-lost-ack', 'move-before-lost-ack'] as const) {
  test(`request-condition disposition ownership ${mode}`, async ({ capabilities, electronApp, appWindow }) => {
    const { tabId, fixtureUrl, fixtureOrigin } = capabilities
    const routes = await appWindow.evaluate(async ({ tabId, fixtureOrigin }) =>
      (window as unknown as { hronaut: HronautApi }).hronaut.addNetworkRoute(tabId, {
        urlPattern: `${fixtureOrigin}/route-target*`, times: 3, response: { status: 409, body: 'bounded synthetic mock' }
      }), { tabId, fixtureOrigin })
    if (mode === 'move-before-lost-ack') await appWindow.evaluate(async ({ tabId, fixtureOrigin }) => (window as unknown as { hronaut: HronautApi }).hronaut.addNetworkRoute(tabId, { urlPattern: `${fixtureOrigin}/other*`, abort: 'Failed' }), { tabId, fixtureOrigin })
    await electronApp.evaluate(({ webContents }, { fixtureUrl, mode }) => {
      const page = webContents.getAllWebContents().find(p => p.getURL() === fixtureUrl)!
      const api = page.debugger, original = api.sendCommand
      let release!: () => void
      const barrier = new Promise<void>(resolve => { release = resolve })
      const listener = (_event: Electron.Event, method: string): void => { if (method === 'Fetch.requestPaused') gate.paused++ }
      const gate: Gate = { waiting: false, dispositions: [], paused: 0, release, restore: () => { release(); api.sendCommand = original; api.removeListener('message', listener) } }
      ;(globalThis as Scope).__conditionDisposition = gate
      api.on('message', listener)
      api.sendCommand = async (method, ...args) => {
        if (['Fetch.fulfillRequest','Fetch.failRequest','Fetch.continueRequest'].includes(method)) gate.dispositions.push(method)
        const result = await original.call(api, method, ...args)
        if (mode === 'failure-during-application' && method === 'Fetch.fulfillRequest') throw new Error('Controlled lost disposition acknowledgement')
        const target = mode === 'failure-during-application' ? 'Network.overrideNetworkState' : 'Fetch.fulfillRequest'
        if (!gate.waiting && method === target) {
          gate.waiting = true
          await barrier
          if (mode === 'clear-after-lost-ack' || mode.endsWith('before-lost-ack')) throw new Error('Controlled lost disposition acknowledgement after clear')
        }
        return result
      }
    }, { fixtureUrl, mode })
    const fetch = () => electronApp.evaluate(async ({ webContents }, fixtureUrl) => {
      const page = webContents.getAllWebContents().find(p => p.getURL() === fixtureUrl)!
      return page.executeJavaScript("fetch('/route-target',{cache:'no-store'}).then(async r=>{await r.text();return r.status}).catch(()=>0)") as Promise<number>
    }, fixtureUrl)
    const health = () => appWindow.evaluate(async id =>
      (await (window as unknown as { hronaut: HronautApi }).hronaut.getState()).tabs.find(t => t.id === id)!.networkConditionState, tabId)
    let applying: Promise<unknown> | undefined
    let first: Promise<number> | undefined
    let second: Promise<number> | undefined
    try {
      if (mode === 'failure-during-application') {
        applying = appWindow.evaluate(async ({ tabId, routeId }) => {
          try { return await (window as unknown as { hronaut: HronautApi }).hronaut.moveNetworkRoute(tabId, routeId, 'up') }
          catch (error) { return String(error) }
        }, { tabId, routeId: routes[0]!.id })
        await expect.poll(() => electronApp.evaluate(() => (globalThis as Scope).__conditionDisposition!.waiting)).toBe(true)
        expect(await fetch()).toBe(409)
        await expect.poll(async () => (await health())?.application).toBe('unknown')
        await electronApp.evaluate(() => (globalThis as Scope).__conditionDisposition!.release())
        expect(await applying).toContain('retired configuration')
        expect((await health())?.application).toBe('unknown')
        expect((await health())?.retainedRules[0]?.remainingMatches).toBe(2)
        await appWindow.evaluate(async id => (window as unknown as { hronaut: HronautApi }).hronaut.clearNetworkRoutes(id), tabId)
      } else {
        first = fetch()
        await expect.poll(() => electronApp.evaluate(() => (globalThis as Scope).__conditionDisposition!.waiting)).toBe(true)
        if (mode === 'clear-before-queued') {
          second = fetch()
          await expect.poll(() => electronApp.evaluate(() => (globalThis as Scope).__conditionDisposition!.paused)).toBe(2)
        }
        await appWindow.evaluate(async ({ tabId, routeId, fixtureOrigin, mode }) => {
          const api = (window as unknown as { hronaut: HronautApi }).hronaut
          if (mode === 'add-before-lost-ack') await api.addNetworkRoute(tabId, { urlPattern: `${fixtureOrigin}/other*`, abort: 'Failed' })
          else if (mode === 'remove-before-lost-ack') await api.removeNetworkRoute(tabId, routeId)
          else if (mode === 'move-before-lost-ack') await api.moveNetworkRoute(tabId, routeId, 'down')
          else await api.clearNetworkRoutes(tabId)
        }, { tabId, routeId: routes[0]!.id, fixtureOrigin, mode })
        expect((await health())?.application).toBe('confirmed')
        await electronApp.evaluate(() => (globalThis as Scope).__conditionDisposition!.release())
        expect(await first).toBe(409)
        if (mode.endsWith('before-lost-ack')) {
          await expect.poll(async () => (await health())?.application).toBe('unknown')
          expect((await health())?.retainedRules.find(r => r.id === routes[0]!.id)?.remainingMatches).toBe(mode === 'remove-before-lost-ack' ? undefined : 2)
          await appWindow.evaluate(async id => (window as unknown as { hronaut: HronautApi }).hronaut.clearNetworkRoutes(id), tabId)
        }
        if (second) expect([0, 200]).toContain(await second) // Clear does not promise to undo/complete in-flight traffic.
      }
      expect(await fetch()).toBe(200)
      expect(await health()).toEqual({ application: 'confirmed', retainedRules: [] })
      expect(await electronApp.evaluate(() => (globalThis as Scope).__conditionDisposition!.dispositions)).toEqual(['Fetch.fulfillRequest'])
    } finally {
      await electronApp.evaluate(() => { (globalThis as Scope).__conditionDisposition?.restore(); delete (globalThis as Scope).__conditionDisposition }).catch(() => undefined)
      await Promise.allSettled([...(applying ? [applying] : []), ...(first ? [first] : []), ...(second ? [second] : [])])
    }
  })
}
