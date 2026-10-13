import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { BrowserEmulationResult, HronautApi } from '../../src/shared/types.js'
import { expect, test, text } from './capability-fixtures.js'

type Gate = { commands: string[]; fail: boolean; restore(): void }
type Scope = typeof globalThis & { __emulationApplication?: Gate }

for (const clear of [false, true]) {
  test(`reports native media ${clear ? 'clear' : 'apply'} uncertainty and explicitly restores committed settings`, async ({ capabilities, electronApp, appWindow }) => {
    const { client, tabId, fixtureUrl } = capabilities
    const call = async (options: Record<string, unknown> = {}) => await client.callTool({ name: 'browser_emulate', arguments: { tabId, ...options } }) as CallToolResult
    const read = async () => JSON.parse(text(await call())) as BrowserEmulationResult
    const nativeDark = () => electronApp.evaluate(async ({ webContents }, url) => await webContents.getAllWebContents().find(p => p.getURL() === url)!.executeJavaScript("matchMedia('(prefers-color-scheme: dark)').matches"), fixtureUrl)
    const before = await call({ colorScheme: clear ? 'dark' : 'auto', locale: 'fr-FR', extraHttpHeaders: { 'X-Emulation-Private': 'never-public' }, viewportPreset: 'phone' })
    expect(before.isError, text(before)).not.toBe(true)
    const committed = JSON.parse(text(before))
    const route = await client.callTool({ name: 'browser_network_routes', arguments: { tabId, action: 'add', urlPattern: '*emulation-unchanged*', abort: 'Failed' } }) as CallToolResult
    expect(route.isError, text(route)).not.toBe(true)
    await electronApp.evaluate(({ webContents }, url) => {
      const page = webContents.getAllWebContents().find(p => p.getURL() === url)!
      const api = page.debugger, original = api.sendCommand
      const gate: Gate = { commands: [], fail: true, restore: () => { api.sendCommand = original } }
      ;(globalThis as Scope).__emulationApplication = gate
      api.sendCommand = async (method, ...args) => {
        gate.commands.push(method)
        if (gate.fail && method === 'Emulation.setEmulatedVisionDeficiency') throw new Error('Controlled failure after native media application')
        return original.call(api, method, ...args)
      }
    }, fixtureUrl)
    try {
      const failed = await call(clear ? { reset: true } : { colorScheme: 'dark' })
      expect(failed.isError).toBe(true)
      expect(failed.structuredContent).toMatchObject({ status: 'OUTCOME_UNKNOWN', effects: 'possible', retrySafe: false })
      expect(await nativeDark()).toBe(!clear)
      const retained = await read()
      expect(retained).toEqual({ application: 'unknown', retainedSettings: committed, recovery: 'restore-committed' })
      expect(JSON.stringify(retained)).not.toContain('never-public')
      const state = await appWindow.evaluate(async id => (await (window as unknown as { hronaut: HronautApi }).hronaut.getState()).tabs.find(t => t.id === id)!, tabId)
      expect(state.emulation).toBeUndefined()
      expect(state.emulationState).toEqual(retained)
      expect(state.networkConditionState?.application).toBe('confirmed')
      expect(await electronApp.evaluate(() => (globalThis as Scope).__emulationApplication!.commands.filter(m => m === 'Emulation.setEmulatedMedia'))).toHaveLength(1)
      const commandsBefore = await electronApp.evaluate(() => (globalThis as Scope).__emulationApplication!.commands.length)
      for (const options of [{ colorScheme: committed.colorScheme }, { reset: true }, { recover: true, colorScheme: 'light' }]) {
        expect((await call(options)).isError).toBe(true)
      }
      expect(await electronApp.evaluate(() => (globalThis as Scope).__emulationApplication!.commands.length)).toBe(commandsBefore)
      // Recovery can itself partially apply and fail. It remains unknown and
      // cannot relabel the retained settings as the native browser state.
      expect((await call({ recover: true })).isError).toBe(true)
      expect(await read()).toEqual(retained)
      expect(await nativeDark()).toBe(clear)
      await electronApp.evaluate(() => { (globalThis as Scope).__emulationApplication!.fail = false })
      const restored = await call({ recover: true })
      expect(restored.isError, text(restored)).not.toBe(true)
      expect(JSON.parse(text(restored))).toEqual(committed)
      expect(await nativeDark()).toBe(clear)
      const routes = await client.callTool({ name: 'browser_network_routes', arguments: { tabId } }) as CallToolResult
      expect(JSON.parse(text(routes))).toEqual(JSON.parse(text(route)))
      const actualHeader = await electronApp.evaluate(async ({ webContents }, url) => await webContents.getAllWebContents().find(p => p.getURL() === url)!.executeJavaScript("navigator.language"), fixtureUrl)
      expect(actualHeader).toBe('fr-FR')
    } finally {
      await electronApp.evaluate(() => { (globalThis as Scope).__emulationApplication?.restore(); delete (globalThis as Scope).__emulationApplication }).catch(() => undefined)
    }
  })
}

test('failed throttle changes require independent Network recovery before emulation restoration', async ({ capabilities, electronApp }) => {
  const { client, tabId, fixtureUrl } = capabilities
  await electronApp.evaluate(({ webContents }, url) => {
    const page = webContents.getAllWebContents().find(p => p.getURL() === url)!
    const api = page.debugger, original = api.sendCommand
    const gate: Gate = { commands: [], fail: true, restore: () => { api.sendCommand = original } }
    ;(globalThis as Scope).__emulationApplication = gate
    api.sendCommand = async (method, ...args) => {
      gate.commands.push(method)
      if (gate.fail && method === 'Emulation.setEmulatedVisionDeficiency') throw new Error('Controlled media failure')
      return original.call(api, method, ...args)
    }
  }, fixtureUrl)
  try {
    const failed = await client.callTool({ name: 'browser_emulate', arguments: { tabId, network: 'slow-3g', colorScheme: 'dark' } }) as CallToolResult
    expect(failed.isError).toBe(true)
    expect((await client.callTool({ name: 'browser_network_routes', arguments: { tabId } }) as CallToolResult).isError).toBe(true)
    expect((await client.callTool({ name: 'browser_emulate', arguments: { tabId, recover: true } }) as CallToolResult).isError).toBe(true)
    const cleared = await client.callTool({ name: 'browser_network_routes', arguments: { tabId, action: 'clear' } }) as CallToolResult
    expect(cleared.isError, text(cleared)).not.toBe(true)
    const retained = await client.callTool({ name: 'browser_emulate', arguments: { tabId } }) as CallToolResult
    expect(JSON.parse(text(retained))).toMatchObject({ application: 'unknown', retainedSettings: { network: 'none', colorScheme: 'auto' } })
    await electronApp.evaluate(() => { (globalThis as Scope).__emulationApplication!.fail = false })
    const restored = await client.callTool({ name: 'browser_emulate', arguments: { tabId, recover: true } }) as CallToolResult
    expect(restored.isError, text(restored)).not.toBe(true)
    expect(JSON.parse(text(restored))).toMatchObject({ network: 'none', colorScheme: 'auto' })
  } finally {
    await electronApp.evaluate(() => { (globalThis as Scope).__emulationApplication?.restore(); delete (globalThis as Scope).__emulationApplication }).catch(() => undefined)
  }
})

test('acknowledged emulation survives navigation but renderer recreation requires explicit restoration', async ({ capabilities, electronApp, appWindow }) => {
  const { client, tabId, fixtureUrl } = capabilities
  const first = await client.callTool({ name: 'browser_emulate', arguments: { tabId, colorScheme: 'dark' } }) as CallToolResult
  expect(first.isError, text(first)).not.toBe(true)
  await electronApp.evaluate(async ({ webContents }, url) => { await webContents.getAllWebContents().find(p => p.getURL() === url)!.loadURL(url) }, fixtureUrl)
  let read = await client.callTool({ name: 'browser_emulate', arguments: { tabId } }) as CallToolResult
  expect(JSON.parse(text(read))).toMatchObject({ colorScheme: 'dark' })
  expect(await electronApp.evaluate(async ({ webContents }, url) => await webContents.getAllWebContents().find(p => p.getURL() === url)!.executeJavaScript("matchMedia('(prefers-color-scheme: dark)').matches"), fixtureUrl)).toBe(true)
  await electronApp.evaluate(async ({ webContents }, url) => {
    const page = webContents.getAllWebContents().find(p => p.getURL() === url)!
    await new Promise<void>(resolve => { page.once('render-process-gone', () => resolve()); page.forcefullyCrashRenderer() })
    await page.loadURL(url)
  }, fixtureUrl)
  read = await client.callTool({ name: 'browser_emulate', arguments: { tabId } }) as CallToolResult
  expect(JSON.parse(text(read))).toMatchObject({ application: 'unknown', retainedSettings: { colorScheme: 'dark' } })
  const state = await appWindow.evaluate(async id => (await (window as unknown as { hronaut: HronautApi }).hronaut.getState()).tabs.find(t => t.id === id), tabId)
  expect(state?.emulation).toBeUndefined()
  expect(state?.emulationState?.application).toBe('unknown')
  // Renderer loss may detach the debugger too. Network recovery is explicit and
  // cannot clear the independent emulation uncertainty.
  await appWindow.evaluate(async id => { await (window as unknown as { hronaut: HronautApi }).hronaut.clearNetworkRoutes(id) }, tabId)
  read = await client.callTool({ name: 'browser_emulate', arguments: { tabId } }) as CallToolResult
  expect(JSON.parse(text(read)).application).toBe('unknown')
  const recovered = await client.callTool({ name: 'browser_emulate', arguments: { tabId, recover: true } }) as CallToolResult
  expect(recovered.isError, text(recovered)).not.toBe(true)
  expect(JSON.parse(text(recovered))).toMatchObject({ colorScheme: 'dark' })
})

for (const scenario of ['cancel-known-network', 'cancel-changed-network', 'crash-changed-network'] as const) {
  const changedNetwork = scenario !== 'cancel-known-network'
  const crash = scenario === 'crash-changed-network'
  test(`pending emulation retains ownership and independent health: ${scenario}`, async ({ capabilities, electronApp, appWindow }) => {
    const { client, tabId, fixtureUrl } = capabilities
    type PendingGate = { held: boolean; count: number; release(): void; restore(): void }
    type PendingScope = typeof globalThis & { __pendingEmulation?: PendingGate }
    type Renderer = { hronaut: HronautApi; recovery?: 'pending' | 'confirmed' | 'failed' }
    await electronApp.evaluate(({ webContents }, url) => {
      const page = webContents.getAllWebContents().find(p => p.getURL() === url)!
      const api = page.debugger, original = api.sendCommand
      let release!: () => void
      const barrier = new Promise<void>(resolve => { release = resolve })
      const gate: PendingGate = { held: false, count: 0, release, restore: () => { release(); api.sendCommand = original } }
      ;(globalThis as PendingScope).__pendingEmulation = gate
      api.sendCommand = async (method, ...args) => {
        gate.count++
        const result = await original.call(api, method, ...args)
        if (!gate.held && method === 'Emulation.setEmulatedMedia') { gate.held = true; await barrier }
        return result
      }
    }, fixtureUrl)
    const abort = new AbortController()
    const transport = client.transport!, originalSend = transport.send.bind(transport)
    let delivered = false
    transport.send = async (message, options) => { await originalSend(message, options); if ('method' in message && message.method === 'notifications/cancelled') delivered = true }
    const pending = client.callTool({ name: 'browser_emulate', arguments: { tabId, colorScheme: 'dark', ...(changedNetwork ? { network: 'slow-3g' } : {}) } }, undefined, { signal: abort.signal }).catch(() => undefined)
    try {
      await expect.poll(() => electronApp.evaluate(() => (globalThis as PendingScope).__pendingEmulation!.held)).toBe(true)
      const state = await appWindow.evaluate(async id => (await (window as unknown as Renderer).hronaut.getState()).tabs.find(t => t.id === id)!, tabId)
      expect(state.emulation).toBeUndefined()
      expect(state.emulationState).toMatchObject({ application: 'pending', retainedSettings: { colorScheme: 'auto', network: 'none' } })
      expect(state.networkConditionState?.application).toBe(changedNetwork ? 'pending' : 'confirmed')
      if (crash) {
        await electronApp.evaluate(async ({ webContents }, url) => {
          const page = webContents.getAllWebContents().find(p => p.getURL() === url)!
          await new Promise<void>(resolve => { page.once('render-process-gone', () => resolve()); page.forcefullyCrashRenderer() })
          await page.loadURL(url)
        }, fixtureUrl)
      }
      abort.abort()
      await expect.poll(() => delivered).toBe(true)
      await pending
      await appWindow.evaluate(id => {
        const scope = window as unknown as Renderer
        scope.recovery = 'pending'
        void scope.hronaut.recoverTabEmulation(id).then(() => { scope.recovery = 'confirmed' }, () => { scope.recovery = 'failed' })
      }, tabId)
      const count = await electronApp.evaluate(() => (globalThis as PendingScope).__pendingEmulation!.count)
      const barrier = await appWindow.evaluate(async () => { await (window as unknown as Renderer).hronaut.getState(); return (window as unknown as Renderer).recovery })
      expect(barrier).toBe(crash ? 'failed' : 'pending')
      if (!crash) expect(await electronApp.evaluate(() => (globalThis as PendingScope).__pendingEmulation!.count)).toBe(count)
      await electronApp.evaluate(() => (globalThis as PendingScope).__pendingEmulation!.release())
      await expect.poll(() => appWindow.evaluate(() => (window as unknown as Renderer).recovery)).toBe(changedNetwork ? 'failed' : 'confirmed')
      const after = await appWindow.evaluate(async id => (await (window as unknown as Renderer).hronaut.getState()).tabs.find(t => t.id === id)!, tabId)
      if (changedNetwork) {
        expect(after.networkConditionState?.application).toBe('unknown')
        expect(after.emulationState?.application).toBe('unknown')
      } else {
        expect(after.emulationState).toBeUndefined()
        const native = await electronApp.evaluate(async ({ webContents }, url) => await webContents.getAllWebContents().find(p => p.getURL() === url)!.executeJavaScript("matchMedia('(prefers-color-scheme: dark)').matches"), fixtureUrl)
        expect(native).toBe(false)
      }
    } finally {
      transport.send = originalSend
      await electronApp.evaluate(() => { (globalThis as PendingScope).__pendingEmulation?.restore(); delete (globalThis as PendingScope).__pendingEmulation }).catch(() => undefined)
      await pending
    }
  })
}
