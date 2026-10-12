import type { HronautApi } from '../../src/shared/types.js'
import { expect, test } from './capability-fixtures.js'

type Receipt = { ruleIds: string[]; applied: Map<string, string | null>; requests: Map<string, string>; restore(): void }
type Scope = typeof globalThis & { __toggleNative?: Receipt }

test('enabled precedence covers mock, abort and throttle while native IDs track disabled projections', async ({ capabilities, appWindow, electronApp }) => {
  const { tabId, fixtureUrl, fixtureOrigin, counters, client } = capabilities
  await electronApp.evaluate(({ webContents }, fixtureUrl) => {
    const page = webContents.getAllWebContents().find(p => p.getURL() === fixtureUrl)!, api = page.debugger, send = api.sendCommand
    const receipt: Receipt = { ruleIds: [], applied: new Map(), requests: new Map(), restore: () => { api.sendCommand = send; api.removeListener('message', listener) } }
    const listener = (_event: Electron.Event, method: string, params: Record<string, unknown>): void => {
      if (method === 'Network.requestWillBeSent') receipt.requests.set(String(params.requestId), (params.request as { url: string }).url)
      if (method === 'Network.requestWillBeSentExtraInfo') receipt.applied.set(String(params.requestId), typeof params.appliedNetworkConditionsId === 'string' ? params.appliedNetworkConditionsId : null)
    }
    api.on('message', listener)
    api.sendCommand = async (method, ...args) => { const result = await send.call(api, method, ...args); if (method === 'Network.emulateNetworkConditionsByRule') receipt.ruleIds = (result as { ruleIds: string[] }).ruleIds; return result }
    ;(globalThis as Scope).__toggleNative = receipt
  }, fixtureUrl)
  const set = (routeId: string, enabled: boolean) => appWindow.evaluate(async ({ tabId, routeId, enabled }) => (window as unknown as { hronaut: HronautApi }).hronaut.setNetworkRouteEnabled(tabId, routeId, enabled), { tabId, routeId, enabled })
  const ready = () => expect.poll(() => appWindow.evaluate(async id => (await (window as unknown as { hronaut: HronautApi }).hronaut.getState()).tabs.find(t => t.id === id)!.networkConditionState!.application, tabId)).toBe('confirmed')
  let serial = 0
  const fetch = async () => {
    const path = `/route-target?native-toggle=${serial++}`
    const response = await electronApp.evaluate(async ({ webContents }, { fixtureUrl, path }) => webContents.getAllWebContents().find(p => p.getURL() === fixtureUrl)!.executeJavaScript(`fetch(${JSON.stringify(path)},{cache:'no-store'}).then(async r=>({status:r.status,body:await r.text()})).catch(()=>({failed:true}))`), { fixtureUrl, path }) as { status?: number; body?: string; failed?: boolean }
    if (response.status === 200) await expect.poll(() => electronApp.evaluate((_electron, path) => { const r = (globalThis as Scope).__toggleNative!; const id = [...r.requests].find(([,url]) => url.endsWith(path))?.[0]; return id !== undefined && r.applied.has(id) }, path)).toBe(true)
    const receipt = await electronApp.evaluate((_electron, path) => { const r = (globalThis as Scope).__toggleNative!; const id = [...r.requests].find(([,url]) => url.endsWith(path))?.[0]; return { conditionId: id ? r.applied.get(id) ?? null : null, ruleIds: r.ruleIds } }, path)
    await ready()
    return { ...response, ...receipt }
  }
  try {
    const routes = await appWindow.evaluate(async ({ tabId, fixtureOrigin }) => {
      const api = (window as unknown as { hronaut: HronautApi }).hronaut, urlPattern = `${fixtureOrigin}/route-target*`
      await api.addNetworkRoute(tabId, { urlPattern, times: 5, response: { status: 409, body: 'first private mock' } })
      await api.addNetworkRoute(tabId, { urlPattern, times: 5, abort: 'Failed' })
      return api.addNetworkRoute(tabId, { urlPattern, throttle: 'fast-4g' })
    }, { tabId, fixtureOrigin })
    expect(await fetch()).toMatchObject({ status: 409, body: 'first private mock' })
    await set(routes[0]!.id, false)
    expect(await fetch()).toMatchObject({ failed: true })
    await set(routes[1]!.id, false)
    const throttled = await fetch()
    expect(throttled.status).toBe(200)
    expect(throttled.ruleIds).toHaveLength(1) // Disabled mock/abort must not leave neutral priority entries.
    expect(throttled.ruleIds).toContain(throttled.conditionId)
    await set(routes[2]!.id, false)
    const disabled = await fetch()
    expect(disabled).toMatchObject({ status: 200, conditionId: null, ruleIds: [] })
    // An unrelated emulation refresh must not restore disabled per-rule effects.
    await appWindow.evaluate(async id => (window as unknown as { hronaut: HronautApi }).hronaut.setTabViewport(id, { width: 900, height: 700, deviceScaleFactor: 1, mobile: false, touch: false, orientation: 'landscape' }), tabId)
    expect(await fetch()).toMatchObject({ status: 200, conditionId: null, ruleIds: [] })
    expect((await client.callTool({ name: 'browser_emulate', arguments: { tabId, network: 'fast-4g' } })).isError).not.toBe(true)
    const tabWide = await fetch()
    expect(tabWide.ruleIds).toHaveLength(1)
    expect(tabWide.ruleIds).toContain(tabWide.conditionId)
    await set(routes[2]!.id, true)
    const combined = await fetch()
    expect(combined.ruleIds).toHaveLength(2)
    expect(combined.conditionId).toBe(combined.ruleIds[0])
    await set(routes[2]!.id, false)
    const tabWideAfterToggle = await fetch()
    expect(tabWideAfterToggle.ruleIds).toHaveLength(1)
    expect(tabWideAfterToggle.conditionId).toBe(tabWideAfterToggle.ruleIds[0])
    expect((await appWindow.evaluate(async id => (await (window as unknown as { hronaut: HronautApi }).hronaut.getState()).tabs.find(t => t.id === id)!.emulation?.network, tabId))).toBe('fast-4g')
    expect((await client.callTool({ name: 'browser_emulate', arguments: { tabId, network: 'none' } })).isError).not.toBe(true)
    await set(routes[2]!.id, true)
    const resumed = await fetch()
    expect(resumed.ruleIds).toContain(resumed.conditionId)
    await set(routes[0]!.id, true)
    expect(await fetch()).toMatchObject({ status: 409 })
    const retained = await appWindow.evaluate(async id => (window as unknown as { hronaut: HronautApi }).hronaut.listNetworkRoutes(id), tabId)
    expect(retained.map(r => r.id)).toEqual(routes.map(r => r.id))
    expect(retained.map(r => r.remainingMatches)).toEqual([3, 4, undefined])
    console.log(JSON.stringify({ scenario: 'toggle-throttle-precedence', throttled, disabled, tabWide, combined, tabWideAfterToggle, resumed, actualServerRequests: counters.routeRequests, retainedOrder: true }))
    expect(counters.routeRequests).toBe(7)
    for (const route of retained) await set(route.id, false)
    await appWindow.evaluate(async id => (window as unknown as { hronaut: HronautApi }).hronaut.toggleDevTools(id), tabId)
    const handoff = await appWindow.evaluate(async id => (await (window as unknown as { hronaut: HronautApi }).hronaut.getState()).tabs.find(t => t.id === id)!.networkConditionState!, tabId)
    expect(handoff.retainedRules).toEqual([])
    expect(handoff.application).toBe('unknown') // Detachment still requires explicit recovery.
  } finally {
    await electronApp.evaluate(() => { (globalThis as Scope).__toggleNative?.restore(); delete (globalThis as Scope).__toggleNative }).catch(() => undefined)
  }
})
