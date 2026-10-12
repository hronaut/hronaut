import type { HronautApi } from '../../src/shared/types.js'
import { expect, test } from './capability-fixtures.js'

type Probe = {
  armed: boolean
  failures: number
  ruleCalls: number
  legacyCalls: number
  appliedRuleIds: string[]
  requests: Map<string, string>
  extras: Map<string, string | null>
  restore(): void
}
type Scope = typeof globalThis & { __conditionNativeProbe?: Probe }

// Real native application health and explicit recovery, including lost acknowledgements.
for (const scenario of ['add-before-rules', 'add-after-rules', 'add-before-override', 'remove-before-rules', 'remove-after-rules'] as const) {
  test(`request-condition uncertainty and explicit recovery after ${scenario}`, async ({ capabilities, appWindow, electronApp }) => {
    const { tabId, fixtureUrl, fixtureOrigin, client, openPageTool } = capabilities
    const ruleMethod = 'Network.emulateNetworkConditionsByRule'
    await electronApp.evaluate(({ webContents }, { fixtureUrl, scenario, ruleMethod }) => {
      const page = webContents.getAllWebContents().find(candidate => candidate.getURL() === fixtureUrl)!
      const api = page.debugger
      const original = api.sendCommand
      const probe: Probe = {
        armed: false, failures: 0, ruleCalls: 0, legacyCalls: 0, appliedRuleIds: [], requests: new Map(), extras: new Map(),
        restore: () => { api.sendCommand = original; api.removeListener('message', listener) }
      }
      const listener = (_event: Electron.Event, method: string, params: Record<string, unknown>): void => {
        if (method === 'Network.requestWillBeSent') {
          const request = params.request as { url?: string }
          if (request.url?.includes('/route-target')) probe.requests.set(String(params.requestId), request.url)
        }
        if (method === 'Network.requestWillBeSentExtraInfo') {
          probe.extras.set(String(params.requestId), typeof params.appliedNetworkConditionsId === 'string' ? params.appliedNetworkConditionsId : null)
        }
      }
      api.on('message', listener)
      api.sendCommand = async (method, ...args) => {
        if (method === 'Network.emulateNetworkConditions') probe.legacyCalls++
        if (probe.armed && method === ruleMethod) probe.ruleCalls++
        const before = probe.armed && probe.failures === 0 && (
          (scenario.endsWith('before-rules') && method === ruleMethod)
          || (scenario.endsWith('before-override') && method === 'Network.overrideNetworkState'))
        if (before) { probe.failures++; throw new Error('Controlled native application rejection: method not found -32601') }
        const result = await original.call(api, method, ...args)
        if (method === ruleMethod) probe.appliedRuleIds = (result as { ruleIds: string[] }).ruleIds
        if (probe.armed && probe.failures === 0 && scenario.endsWith('after-rules') && method === ruleMethod) {
          probe.failures++
          throw new Error('Controlled lost acknowledgement after native rule application')
        }
        return result
      }
      ;(globalThis as Scope).__conditionNativeProbe = probe
    }, { fixtureUrl, scenario, ruleMethod })
    const fetchProbe = async () => {
      const path = '/route-target'
      await electronApp.evaluate(() => {
        const probe = (globalThis as Scope).__conditionNativeProbe!
        probe.requests.clear(); probe.extras.clear()
      })
      const result = await electronApp.evaluate(async ({ webContents }, { fixtureUrl, path }) => {
        const page = webContents.getAllWebContents().find(candidate => candidate.getURL() === fixtureUrl)!
        return page.executeJavaScript(`(async()=>{const start=performance.now();const response=await fetch(${JSON.stringify(path)},{cache:'no-store'});await response.text();return {status:response.status,elapsedMs:performance.now()-start}})()`)
      }, { fixtureUrl, path }) as { status: number; elapsedMs: number }
      expect(result.status).toBe(200)
      await expect.poll(() => electronApp.evaluate((_electron, path) => {
        const probe = (globalThis as Scope).__conditionNativeProbe!
        const id = [...probe.requests].find(([, url]) => url.endsWith(path))?.[0]
        return id !== undefined && probe.extras.has(id)
      }, path)).toBe(true)
      const conditionId = await electronApp.evaluate((_electron, path) => {
        const probe = (globalThis as Scope).__conditionNativeProbe!
        const id = [...probe.requests].find(([, url]) => url.endsWith(path))![0]
        return probe.extras.get(id)!
      }, path)
      return { ...result, conditionId }
    }
    try {
      const initial = await fetchProbe()
      expect(initial.conditionId).toBeNull()
      let routeId = ''
      let active: Awaited<ReturnType<typeof fetchProbe>> | undefined
      if (scenario.startsWith('remove')) {
        const routes = await appWindow.evaluate(async ({ tabId, fixtureOrigin }) =>
          (window as unknown as { hronaut: HronautApi }).hronaut.addNetworkRoute(tabId, {
            urlPattern: `${fixtureOrigin}/route-target*`, throttle: 'slow-3g'
          }), { tabId, fixtureOrigin })
        routeId = routes[0]!.id
        active = await fetchProbe()
        expect(active.conditionId).toBeTruthy()
        expect(active.elapsedMs).toBeGreaterThanOrEqual(1500)
      }
      await electronApp.evaluate(() => { (globalThis as Scope).__conditionNativeProbe!.armed = true })
      const error = await appWindow.evaluate(async ({ tabId, fixtureOrigin, routeId, scenario }) => {
        const api = (window as unknown as { hronaut: HronautApi }).hronaut
        try {
          if (scenario.startsWith('remove')) await api.removeNetworkRoute(tabId, routeId)
          else await api.addNetworkRoute(tabId, { urlPattern: `${fixtureOrigin}/route-target*`, throttle: 'slow-3g' })
          return 'unexpected success'
        } catch (error) { return String(error) }
      }, { tabId, fixtureOrigin, routeId, scenario })
      expect(error).toContain('Controlled')
      const health = await appWindow.evaluate(async tabId =>
        (await (window as unknown as { hronaut: HronautApi }).hronaut.getState()).tabs.find(tab => tab.id === tabId)!.networkConditionState, tabId)
      expect(health?.application).toBe('unknown')
      const routes = health!.retainedRules
      expect(routes).toHaveLength(scenario.startsWith('add') ? 1 : 0)
      const inspection = await client.callTool({ name: 'browser_network_routes', arguments: { action: 'list', tabId } })
      expect(inspection.isError).toBe(true)
      expect(inspection.structuredContent).toMatchObject({ status: 'NETWORK_CONDITIONS_UNCONFIRMED', application: 'unknown', retrySafe: false })
      const observed = await fetchProbe()
      const remainsActive = scenario === 'add-after-rules' || scenario === 'add-before-override' || scenario === 'remove-before-rules'
      const receipt = await electronApp.evaluate(() => {
        const probe = (globalThis as Scope).__conditionNativeProbe!
        return { failures: probe.failures, ruleCalls: probe.ruleCalls, legacyCalls: probe.legacyCalls, appliedRuleIds: probe.appliedRuleIds }
      })
      expect(receipt.failures).toBe(1)
      expect(receipt.ruleCalls).toBe(1)
      expect(receipt.legacyCalls).toBe(0)
      if (remainsActive) {
        expect(observed.conditionId).toBeTruthy()
        expect(receipt.appliedRuleIds).toContain(observed.conditionId)
        expect(observed.elapsedMs).toBeGreaterThanOrEqual(1500)
      } else expect(observed.conditionId).toBeNull()
      // A failed explicit recovery stays unknown, even when its native clear
      // may already have applied. No legacy fallback can certify that result.
      await electronApp.evaluate(() => { (globalThis as Scope).__conditionNativeProbe!.failures = 0 })
      const failedRecovery = await client.callTool({ name: 'browser_network_routes', arguments: { action: 'clear', tabId } })
      expect(failedRecovery.isError).toBe(true)
      expect(failedRecovery.structuredContent).toMatchObject({ status: 'OUTCOME_UNKNOWN', application: 'unknown', retrySafe: false })
      expect(await electronApp.evaluate(() => {
        const p = (globalThis as Scope).__conditionNativeProbe!
        return { ruleCalls: p.ruleCalls, legacyCalls: p.legacyCalls }
      })).toEqual({ ruleCalls: 2, legacyCalls: 0 })
      // Explicit cleanup is a new requested operation, never implicit replay.
      await electronApp.evaluate(() => { (globalThis as Scope).__conditionNativeProbe!.armed = false })
      if (scenario === 'remove-before-rules') {
        await openPageTool(/Request conditions/)
        await expect(appWindow.getByRole('status').filter({ hasText: 'Request-condition application is unconfirmed.' })).toBeVisible()
        await appWindow.getByRole('button', { name: 'Clear conditions and recover', exact: true }).click()
        await expect.poll(() => appWindow.evaluate(async tabId =>
          (await (window as unknown as { hronaut: HronautApi }).hronaut.getState()).tabs.find(tab => tab.id === tabId)!.networkConditionState?.application, tabId)).toBe('confirmed')
      } else await appWindow.evaluate(async tabId => (window as unknown as { hronaut: HronautApi }).hronaut.clearNetworkRoutes(tabId), tabId)
      const recovered = await client.callTool({ name: 'browser_network_routes', arguments: { action: 'list', tabId } })
      expect(recovered.isError).not.toBe(true)
      expect(recovered.content).toEqual([{ type: 'text', text: '[]' }])
      const cleared = await fetchProbe()
      expect(cleared.conditionId).toBeNull()
      console.log(JSON.stringify({ scenario, retainedRoutes: routes.length, initial, active, observed, cleared, receipt }))
    } finally {
      await electronApp.evaluate(() => { (globalThis as Scope).__conditionNativeProbe?.restore(); delete (globalThis as Scope).__conditionNativeProbe }).catch(() => undefined)
    }
  })
}
