import type { ElectronApplication, Page } from '@playwright/test'
import type { HronautApi } from '../../src/shared/types.js'
import { expect, test } from './capability-fixtures.js'

type UsedUpGate = { waiting: boolean; hold(): void; release(): void; restore(): void }
type Scope = typeof globalThis & { __usedUpGate?: UsedUpGate }
type Fixtures = { capabilities: { tabId: string; fixtureUrl: string; fixtureOrigin: string }; appWindow: Page; electronApp: ElectronApplication }

// A request that uses up a rule leaves the rules pending until a refresh shortly after the page's paused requests
// drain. Holding Hronaut's acknowledgement of the fulfilled request keeps that window open: the page already has its
// response, and the rules wait for their refresh.
async function usedUpWindow({ capabilities, appWindow, electronApp }: Fixtures, use: (kept: string) => Promise<void>): Promise<void> {
  const { tabId, fixtureUrl, fixtureOrigin } = capabilities
  await electronApp.evaluate(({ webContents }, fixtureUrl) => {
    const api = webContents.getAllWebContents().find(p => p.getURL() === fixtureUrl)!.debugger, send = api.sendCommand
    let armed = false
    let release = (): void => {}
    const gate: UsedUpGate = {
      waiting: false,
      hold: () => { armed = true },
      release: () => { gate.waiting = false; release() },
      restore: () => { gate.release(); api.sendCommand = send }
    }
    api.sendCommand = async (method, ...args) => {
      const result = await send.call(api, method, ...args)
      if (method === 'Fetch.fulfillRequest' && armed) {
        armed = false
        gate.waiting = true
        await new Promise<void>(resolve => { release = resolve })
      }
      return result
    }
    ;(globalThis as Scope).__usedUpGate = gate
  }, fixtureUrl)
  try {
    const routes = await appWindow.evaluate(async ({ tabId, fixtureOrigin }) => {
      const api = (window as unknown as { hronaut: HronautApi }).hronaut
      await api.addNetworkRoute(tabId, { urlPattern: `${fixtureOrigin}/used-up-rule`, times: 1, response: { status: 409, body: 'one-time mock' } })
      return api.addNetworkRoute(tabId, { urlPattern: `${fixtureOrigin}/kept-rule`, abort: 'Failed' })
    }, { tabId, fixtureOrigin })
    await expect.poll(() => application(appWindow, tabId)).toBe('confirmed')
    await electronApp.evaluate(() => (globalThis as Scope).__usedUpGate!.hold())
    const response = await electronApp.evaluate(async ({ webContents }, fixtureUrl) => webContents.getAllWebContents().find(p => p.getURL() === fixtureUrl)!.executeJavaScript("fetch('/used-up-rule',{cache:'no-store'}).then(async r=>({status:r.status,body:await r.text()}))"), fixtureUrl)
    expect(response).toEqual({ status: 409, body: 'one-time mock' })
    await expect.poll(() => electronApp.evaluate(() => (globalThis as Scope).__usedUpGate!.waiting)).toBe(true)
    expect(await application(appWindow, tabId)).toBe('pending')
    await use(routes.find(route => route.urlPattern.endsWith('/kept-rule'))!.id)
    await electronApp.evaluate(() => (globalThis as Scope).__usedUpGate!.release())
    await expect.poll(() => application(appWindow, tabId)).toBe('confirmed')
  } finally {
    await electronApp.evaluate(() => { (globalThis as Scope).__usedUpGate?.restore(); delete (globalThis as Scope).__usedUpGate }).catch(() => undefined)
  }
}

function application(appWindow: Page, tabId: string) {
  return appWindow.evaluate(async id => (await (window as unknown as { hronaut: HronautApi }).hronaut.getState()).tabs.find(t => t.id === id)!.networkConditionState!.application, tabId)
}

test('emulation changes while a rule used up by a request waits for its refresh', async ({ capabilities, appWindow, electronApp }) => {
  const { tabId } = capabilities
  await usedUpWindow({ capabilities, appWindow, electronApp }, async () => {
    // Refused before as if the rules had to be recovered: "Recover Network conditions in Request conditions first".
    await appWindow.evaluate(async id => (window as unknown as { hronaut: HronautApi }).hronaut.setTabViewport(id, { width: 900, height: 700, deviceScaleFactor: 1, mobile: false, touch: false, orientation: 'landscape' }), tabId)
    const tab = await appWindow.evaluate(async id => (await (window as unknown as { hronaut: HronautApi }).hronaut.getState()).tabs.find(t => t.id === id)!, tabId)
    expect(tab.emulation?.viewport?.width).toBe(900)
    // The used-up rule still waits for the refresh that takes it out of the interception patterns.
    expect(tab.networkConditionState?.application).toBe('pending')
  })
})

test('a rule turns off while another rule used up by a request waits for its refresh', async ({ capabilities, appWindow, electronApp }) => {
  const { tabId } = capabilities
  await usedUpWindow({ capabilities, appWindow, electronApp }, async kept => {
    // Refused before as "must be confirmed … Explicitly clear unknown conditions to recover".
    const toggled = await appWindow.evaluate(async ({ tabId, kept }) => (window as unknown as { hronaut: HronautApi }).hronaut.setNetworkRouteEnabled(tabId, kept, false), { tabId, kept })
    expect(toggled.map(route => ({ id: route.id, enabled: route.enabled }))).toEqual([{ id: kept, enabled: false }])
    // Turning the rule off applied the rules that remain, which settles them before the refresh.
    expect(await application(appWindow, tabId)).toBe('confirmed')
  })
  expect(await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.listNetworkRoutes(id), tabId)).toEqual([expect.objectContaining({ enabled: false, urlPattern: expect.stringMatching(/\/kept-rule$/) })])
})
