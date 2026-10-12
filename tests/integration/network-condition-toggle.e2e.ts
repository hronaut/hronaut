import type { BrowserNetworkRouteSummary, HronautApi } from '../../src/shared/types.js'
import { expect, test } from './capability-fixtures.js'

type ToggleApi = HronautApi & { setNetworkRouteEnabled(tabId: string, routeId: string, enabled: boolean): Promise<BrowserNetworkRouteSummary[]> }

for (const behavior of ['abort', 'fulfill'] as const) {
  test(`retained ${behavior} condition enables, disables and re-enables without losing its budget`, async ({ capabilities, appWindow, electronApp }) => {
    const { tabId, fixtureUrl, fixtureOrigin, counters } = capabilities
    const added = await appWindow.evaluate(async ({ tabId, fixtureOrigin, behavior }) => (window as unknown as { hronaut: ToggleApi }).hronaut.addNetworkRoute(tabId, { urlPattern: `${fixtureOrigin}/route-target*`, times: 4, ...(behavior === 'abort' ? { abort: 'BlockedByClient' as const } : { response: { status: 409, headers: { 'x-private-toggle': 'retained' }, body: 'retained private fixture' } }) }), { tabId, fixtureOrigin, behavior })
    const id = added[0]!.id
    const fetch = () => electronApp.evaluate(async ({ webContents }, fixtureUrl) => {
      const page = webContents.getAllWebContents().find(p => p.getURL() === fixtureUrl)!
      return page.executeJavaScript(`fetch('/route-target?toggle',{cache:'no-store'}).then(async r=>({status:r.status,body:await r.text(),header:r.headers.get('x-private-toggle')})).catch(()=>({failed:true}))`)
    }, fixtureUrl) as Promise<{ status?: number; body?: string; header?: string; failed?: boolean }>
    const beforeHits = counters.routeRequests
    const enabled = await fetch()
    expect(enabled).toMatchObject(behavior === 'abort' ? { failed: true } : { status: 409, body: 'retained private fixture', header: 'retained' })
    await expect.poll(() => appWindow.evaluate(async id => (await (window as unknown as { hronaut: ToggleApi }).hronaut.getState()).tabs.find(t => t.id === id)?.networkConditionState?.application, tabId)).toBe('confirmed')
    const set = (enabled: boolean) => appWindow.evaluate(async ({ tabId, id, enabled }) => (window as unknown as { hronaut: ToggleApi }).hronaut.setNetworkRouteEnabled(tabId, id, enabled), { tabId, id, enabled })
    expect(counters.routeRequests).toBe(beforeHits)
    const disabled = await set(false)
    expect(disabled[0]).toMatchObject({ id, enabled: false, remainingMatches: 3, createdAt: added[0]!.createdAt })
    expect(await fetch()).toMatchObject({ status: 200 })
    expect(counters.routeRequests).toBe(beforeHits + 1)
    expect(await set(false)).toEqual(disabled)
    const resumed = await set(true)
    expect(resumed[0]).toMatchObject({ id, enabled: true, remainingMatches: 3 })
    expect(await fetch()).toMatchObject(enabled)
    expect(counters.routeRequests).toBe(beforeHits + 1)
    console.log(JSON.stringify({ scenario: `toggle-${behavior}`, idPreserved: resumed[0]!.id === id, remainingBeforeResume: resumed[0]!.remainingMatches, disabledStatus: 200, actualServerRequests: counters.routeRequests - beforeHits }))
  })
}
