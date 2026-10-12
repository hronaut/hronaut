import type { HronautApi } from '../../src/shared/types.js'
import { expect, test } from './capability-fixtures.js'

type Gate = { commands: string[]; attaches: number; waiting: boolean; release(): void; restore(): void }
type Scope = typeof globalThis & { __toggleGuard?: Gate }

for (const phase of ['Fetch.disable', 'Network.emulateNetworkConditionsByRule', 'Network.overrideNetworkState', 'detached', 'detached-no-monitor'] as const) {
  test(`toggle rejects unconfirmed state without native setup and clear recovers: ${phase}`, async ({ capabilities, appWindow, electronApp }) => {
    const { tabId, fixtureOrigin, fixtureUrl, client } = capabilities
    const routes = await appWindow.evaluate(async ({ tabId, fixtureOrigin }) => (window as unknown as { hronaut: HronautApi }).hronaut.addNetworkRoute(tabId, { urlPattern: `${fixtureOrigin}/route-target*`, times: 4, abort: 'Failed' }), { tabId, fixtureOrigin })
    await electronApp.evaluate(({ webContents }, { fixtureUrl, phase }) => {
      const page = webContents.getAllWebContents().find(p => p.getURL() === fixtureUrl)!
      const api = page.debugger, send = api.sendCommand, attach = api.attach
      let release!: () => void
      const barrier = new Promise<void>(resolve => { release = resolve })
      const gate: Gate = { commands: [], attaches: 0, waiting: false, release, restore: () => { release(); api.sendCommand = send; api.attach = attach } }
      ;(globalThis as Scope).__toggleGuard = gate
      api.attach = (...args) => { gate.attaches++; if (phase === 'detached-no-monitor') throw new Error('Controlled independent monitor attachment rejection'); return attach.apply(api, args) }
      api.sendCommand = async (method, ...args) => {
        gate.commands.push(method)
        const result = await send.call(api, method, ...args)
        if (phase === 'detached' && method === 'Page.enable' && !gate.waiting) { gate.waiting = true; await barrier }
        if (!gate.waiting && method === phase) { gate.waiting = true; await barrier; throw new Error('Controlled lost toggle acknowledgement') }
        return result
      }
      if (phase.startsWith('detached')) api.detach()
    }, { fixtureUrl, phase })
    let changing: Promise<string> | undefined
    try {
      if (!phase.startsWith('detached')) {
        changing = appWindow.evaluate(async ({ tabId, routeId }) => { try { await (window as unknown as { hronaut: HronautApi }).hronaut.setNetworkRouteEnabled(tabId, routeId, false); return 'unexpected success' } catch (e) { return String(e) } }, { tabId, routeId: routes[0]!.id })
        await expect.poll(() => electronApp.evaluate(() => (globalThis as Scope).__toggleGuard!.waiting)).toBe(true)
      }
      if (phase === 'detached') await expect.poll(() => electronApp.evaluate(() => (globalThis as Scope).__toggleGuard!.waiting)).toBe(true)
      const handoff = await appWindow.evaluate(async id => { try { await (window as unknown as { hronaut: HronautApi }).hronaut.toggleDevTools(id); return 'unexpected handoff' } catch (e) { return String(e) } }, tabId)
      expect(handoff).not.toBe('unexpected handoff')
      const before = await electronApp.evaluate(() => ({ commands: [...(globalThis as Scope).__toggleGuard!.commands], attaches: (globalThis as Scope).__toggleGuard!.attaches }))
      for (const enabled of [true, false]) {
        const result = await client.callTool({ name: 'browser_network_routes', arguments: { action: 'set-enabled', tabId, routeId: routes[0]!.id, enabled } })
        expect(result.isError).toBe(true)
      }
      expect(await electronApp.evaluate(() => ({ commands: (globalThis as Scope).__toggleGuard!.commands, attaches: (globalThis as Scope).__toggleGuard!.attaches }))).toEqual(before)
      if (changing) {
        await electronApp.evaluate(() => (globalThis as Scope).__toggleGuard!.release())
        expect(await changing).toContain('Controlled lost toggle acknowledgement')
        for (const enabled of [false, true]) expect((await client.callTool({ name: 'browser_network_routes', arguments: { action: 'set-enabled', tabId, routeId: routes[0]!.id, enabled } })).isError).toBe(true)
        expect(await electronApp.evaluate(() => ({ commands: (globalThis as Scope).__toggleGuard!.commands, attaches: (globalThis as Scope).__toggleGuard!.attaches }))).toEqual(before)
      }
      const state = await appWindow.evaluate(async id => (await (window as unknown as { hronaut: HronautApi }).hronaut.getState()).tabs.find(t => t.id === id)!.networkConditionState!, tabId)
      expect(state.application).toBe('unknown')
      expect(state.retainedRules[0]).toMatchObject({ id: routes[0]!.id, enabled: phase.startsWith('detached'), remainingMatches: 4 })
      console.log(JSON.stringify({ scenario: `toggle-guard-${phase}`, rejectedAdditionalCommands: 0, rejectedAdditionalAttaches: 0, ownedCommands: before.commands }))
      await electronApp.evaluate(() => (globalThis as Scope).__toggleGuard!.restore())
      const cleared = await appWindow.evaluate(async id => (await (window as unknown as { hronaut: HronautApi }).hronaut.clearNetworkRoutes(id)).tabs.find(t => t.id === id)!.networkConditionState!, tabId)
      expect(cleared).toEqual({ application: 'confirmed', retainedRules: [] })
    } finally {
      await electronApp.evaluate(() => { (globalThis as Scope).__toggleGuard?.restore(); delete (globalThis as Scope).__toggleGuard }).catch(() => undefined)
      await Promise.allSettled(changing ? [changing] : [])
    }
  })
}

test('disabled records retain cap accounting and explicit set-enabled validates its input', async ({ capabilities, appWindow }) => {
  const { tabId, fixtureOrigin, client } = capabilities
  const result = await appWindow.evaluate(async ({ tabId, fixtureOrigin }) => {
    const api = (window as unknown as { hronaut: HronautApi }).hronaut
    let last = ''
    for (let i = 0; i < 50; i++) {
      const routes = await api.addNetworkRoute(tabId, { urlPattern: `${fixtureOrigin}/never/${i}`, abort: 'Failed' })
      last = routes.at(-1)!.id
      await api.setNetworkRouteEnabled(tabId, last, false)
    }
    let error = ''
    try { await api.addNetworkRoute(tabId, { urlPattern: `${fixtureOrigin}/over-limit`, abort: 'Failed' }) } catch (e) { error = String(e) }
    return { error, routes: await api.listNetworkRoutes(tabId), last }
  }, { tabId, fixtureOrigin })
  expect(result.error).toContain('limit reached (50)')
  expect(result.routes).toHaveLength(50)
  expect(result.routes.every(r => !r.enabled)).toBe(true)
  for (const input of [{}, { enabled: null }, { enabled: 'false' }, { enabled: 0 }]) expect((await client.callTool({ name: 'browser_network_routes', arguments: { action: 'set-enabled', tabId, routeId: result.last, ...input } })).isError).toBe(true)
  expect((await client.callTool({ name: 'browser_network_routes', arguments: { action: 'set-enabled', tabId, enabled: true } })).isError).toBe(true)
  const enabled = await client.callTool({ name: 'browser_network_routes', arguments: { action: 'set-enabled', tabId, routeId: result.last, enabled: true } })
  expect(enabled.isError).not.toBe(true)
})

for (const invalidation of ['detach', 'remove', 'exhaust'] as const) {
  test(`queued toggle cannot restore ${invalidation === 'detach' ? 'unknown detached state' : invalidation === 'remove' ? 'a removed rule' : 'an exhausted rule'}`, async ({ capabilities, appWindow, electronApp }) => {
    const { tabId, fixtureOrigin, fixtureUrl, client } = capabilities
    const routes = await appWindow.evaluate(async ({ tabId, fixtureOrigin, invalidation }) => (window as unknown as { hronaut: HronautApi }).hronaut.addNetworkRoute(tabId, { urlPattern: `${fixtureOrigin}/route-target*`, abort: 'Failed', times: invalidation === 'exhaust' ? 1 : 3 }), { tabId, fixtureOrigin, invalidation })
    await electronApp.evaluate(({ webContents }, { fixtureUrl, invalidation }) => {
      const page = webContents.getAllWebContents().find(p => p.getURL() === fixtureUrl)!, api = page.debugger, send = api.sendCommand, attach = api.attach
      let release!: () => void
      const barrier = new Promise<void>(resolve => { release = resolve })
      const gate: Gate = { commands: [], attaches: 0, waiting: false, release, restore: () => { release(); api.sendCommand = send; api.attach = attach } }
      ;(globalThis as Scope).__toggleGuard = gate
      api.attach = (...args) => { gate.attaches++; if (invalidation === 'detach') throw new Error('Controlled independent monitor rejection'); return attach.apply(api, args) }
      api.sendCommand = async (method, ...args) => {
        gate.commands.push(method)
        const result = await send.call(api, method, ...args)
        if (!gate.waiting && method === 'Network.setCacheDisabled') { gate.waiting = true; await barrier }
        return result
      }
    }, { fixtureUrl, invalidation })
    const blocker = appWindow.evaluate(async id => (window as unknown as { hronaut: HronautApi }).hronaut.setTabViewport(id, { width: 900, height: 700, deviceScaleFactor: 1, mobile: false, touch: false, orientation: 'landscape' }), tabId).catch(() => undefined)
    let removed: Promise<unknown> | undefined, toggle: Promise<unknown> | undefined
    try {
      await expect.poll(() => electronApp.evaluate(() => (globalThis as Scope).__toggleGuard!.waiting)).toBe(true)
      // Same-renderer transport queues remove before toggle, without retiring it via recovery.
      if (invalidation === 'remove') removed = appWindow.evaluate(async ({ tabId, id }) => (window as unknown as { hronaut: HronautApi }).hronaut.removeNetworkRoute(tabId, id), { tabId, id: routes[0]!.id })
      toggle = appWindow.evaluate(async ({ tabId, id }) => { try { await (window as unknown as { hronaut: HronautApi }).hronaut.setNetworkRouteEnabled(tabId, id, false); return 'unexpected success' } catch (e) { return String(e) } }, { tabId, id: routes[0]!.id })
      await appWindow.evaluate(async () => (window as unknown as { hronaut: HronautApi }).hronaut.getState())
      if (invalidation === 'exhaust') expect(await electronApp.evaluate(async ({ webContents }, fixtureUrl) => webContents.getAllWebContents().find(p => p.getURL() === fixtureUrl)!.executeJavaScript("fetch('/route-target').then(r=>r.status).catch(()=>0)"), fixtureUrl)).toBe(0)
      if (invalidation === 'detach') await electronApp.evaluate(({ webContents }, fixtureUrl) => webContents.getAllWebContents().find(p => p.getURL() === fixtureUrl)!.debugger.detach(), fixtureUrl)
      const before = await electronApp.evaluate(() => ({ attaches: (globalThis as Scope).__toggleGuard!.attaches, setup: (globalThis as Scope).__toggleGuard!.commands.filter(c => /^(Page|Runtime|Log)\./.test(c)) }))
      await electronApp.evaluate(() => (globalThis as Scope).__toggleGuard!.release())
      await blocker; await removed
      expect(await toggle).not.toBe('unexpected success')
      const after = await electronApp.evaluate(() => ({ attaches: (globalThis as Scope).__toggleGuard!.attaches, setup: (globalThis as Scope).__toggleGuard!.commands.filter(c => /^(Page|Runtime|Log)\./.test(c)) }))
      expect(after).toEqual(before)
      if (invalidation === 'exhaust') await expect.poll(() => appWindow.evaluate(async id => (await (window as unknown as { hronaut: HronautApi }).hronaut.getState()).tabs.find(t => t.id === id)!.networkConditionState!.application, tabId)).toBe('confirmed')
      const health = await appWindow.evaluate(async id => (await (window as unknown as { hronaut: HronautApi }).hronaut.getState()).tabs.find(t => t.id === id)!.networkConditionState!, tabId)
      expect(health.application).toBe(invalidation === 'detach' ? 'unknown' : 'confirmed')
      expect(health.retainedRules).toHaveLength(invalidation === 'detach' ? 1 : 0)
      console.log(JSON.stringify({ scenario: `toggle-queued-${invalidation}`, additionalAttaches: after.attaches - before.attaches, additionalSetupCommands: after.setup.length - before.setup.length, application: health.application }))
      await electronApp.evaluate(() => (globalThis as Scope).__toggleGuard!.restore())
      expect((await client.callTool({ name: 'browser_network_routes', arguments: { tabId, action: 'clear' } })).isError).not.toBe(true)
    } finally {
      await electronApp.evaluate(() => { (globalThis as Scope).__toggleGuard?.restore(); delete (globalThis as Scope).__toggleGuard }).catch(() => undefined)
      await Promise.allSettled([blocker, ...(removed ? [removed] : []), ...(toggle ? [toggle] : [])])
    }
  })
}
