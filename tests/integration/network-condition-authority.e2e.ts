import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { HronautApi, McpTabActivity } from '../../src/shared/types.js'
import { expect, test } from './capability-fixtures.js'

type Gate = { ready: boolean; released: boolean; commands: string[]; release(): void; restore(): void }
type Scope = typeof globalThis & { __conditionAuthority?: Gate }

for (const phase of ['queue', 'after-fetch', 'after-rules'] as const) {
  for (const change of ['pause', 'cancel', 'access', 'navigation', 'close', 'workspace-close', 'detach'] as const) {
    test(`condition recovery revalidates ${change} at ${phase}`, async ({ capabilities, appWindow, electronApp }) => {
      const { client, tabId, fixtureUrl } = capabilities
      await electronApp.evaluate(({ webContents }, { fixtureUrl, phase }) => {
        const page = webContents.getAllWebContents().find(p => p.getURL() === fixtureUrl)!
        const api = page.debugger, original = api.sendCommand
        let release!: () => void
        const barrier = new Promise<void>(resolve => { release = resolve })
        const gate: Gate = { ready: false, released: false, commands: [], release: () => { gate.released = true; release() }, restore: () => { release(); if (!page.isDestroyed()) api.sendCommand = original } }
        ;(globalThis as Scope).__conditionAuthority = gate
        api.sendCommand = async (method, ...args) => {
          if (['Fetch.disable','Fetch.enable','Network.emulateNetworkConditionsByRule','Network.overrideNetworkState','Network.emulateNetworkConditions'].includes(method)) gate.commands.push(method)
          const result = await original.call(api, method, ...args)
          const target = phase === 'queue' ? 'Network.setCacheDisabled' : phase === 'after-fetch' ? 'Fetch.disable' : 'Network.emulateNetworkConditionsByRule'
          if (!gate.ready && method === target) { gate.ready = true; await barrier }
          return result
        }
      }, { fixtureUrl, phase })
      await appWindow.evaluate(() => {
        const scope = window as unknown as { hronaut: HronautApi; conditionActivities: McpTabActivity[]; stopConditions(): void }
        scope.conditionActivities = []
        scope.stopConditions = scope.hronaut.onMcpTabActivity(activity => { if (activity.toolName === 'browser_network_routes') scope.conditionActivities.push(activity) })
      })
      const abort = new AbortController()
      const transport = client.transport!, originalSend = transport.send.bind(transport)
      let cancellationDelivered = false
      transport.send = async (message, options) => { await originalSend(message, options); if ('method' in message && message.method === 'notifications/cancelled') cancellationDelivered = true }
      let blocker: Promise<unknown> | undefined
      let pending: Promise<CallToolResult> | undefined
      try {
        if (phase === 'queue') {
          blocker = appWindow.evaluate(async tabId => (window as unknown as { hronaut: HronautApi }).hronaut.setTabViewport(tabId, { width: 900, height: 700, deviceScaleFactor: 1, mobile: false, touch: false, orientation: 'landscape' }), tabId).catch(() => undefined)
          await expect.poll(() => electronApp.evaluate(() => (globalThis as Scope).__conditionAuthority!.ready)).toBe(true)
        }
        pending = (client.callTool({ name: 'browser_network_routes', arguments: { action: 'clear', tabId } }, undefined, { signal: abort.signal }) as Promise<CallToolResult>).catch(() => ({ isError: true, content: [] }))
        await expect.poll(() => appWindow.evaluate(() => (window as unknown as { conditionActivities: McpTabActivity[] }).conditionActivities.some(a => a.phase === 'started'))).toBe(true)
        await expect.poll(() => electronApp.evaluate(() => (globalThis as Scope).__conditionAuthority!.ready)).toBe(true)
        if (change === 'pause') await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.setTabAgentPaused(id, true), tabId)
        if (change === 'access') await appWindow.evaluate(async id => { const api = (window as unknown as { hronaut: HronautApi }).hronaut; const group = (await api.getState()).tabs.find(t => t.id === id)!.mcpGroupId!; await api.updateTabGroup(group, { agentAccess: false }) }, tabId)
        if (change === 'navigation') await electronApp.evaluate(async ({ webContents }, url) => { await webContents.getAllWebContents().find(p => p.getURL() === url)!.loadURL('data:text/html,changed condition context') }, fixtureUrl)
        if (change === 'close') await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.closeTab(id), tabId)
        if (change === 'workspace-close') await appWindow.evaluate(async id => { const api = (window as unknown as { hronaut: HronautApi }).hronaut; const group = (await api.getState()).tabs.find(t => t.id === id)!.mcpGroupId!; await api.closeWorkspace(group) }, tabId)
        if (change === 'detach') await electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(p => p.getURL() === url)!.debugger.detach(), fixtureUrl)
        if (change === 'cancel') { abort.abort(); await expect.poll(() => cancellationDelivered).toBe(true) }
        // Cancellation settles the client transport, but must not release the native queue.
        expect(await electronApp.evaluate(() => (globalThis as Scope).__conditionAuthority!.released)).toBe(false)
        await electronApp.evaluate(() => (globalThis as Scope).__conditionAuthority!.release())
        await blocker
        const result = await pending
        expect(result.isError).toBe(true)
        if (change !== 'cancel') expect(result.structuredContent).toMatchObject({ status: phase === 'queue' ? 'NOT_DISPATCHED' : 'OUTCOME_UNKNOWN', effects: phase === 'queue' ? 'none' : 'possible', retrySafe: false })
        await expect.poll(() => appWindow.evaluate(() => (window as unknown as { conditionActivities: McpTabActivity[] }).conditionActivities.filter(a => a.phase === 'failed').at(-1)?.result)).toMatchObject({ dispatch: phase === 'queue' ? 'not-dispatched' : 'dispatched', effects: phase === 'queue' ? 'none' : 'possible' })
        const commands = await electronApp.evaluate(() => (globalThis as Scope).__conditionAuthority!.commands)
        expect(commands.filter(c => c.startsWith('Fetch.'))).toHaveLength(phase === 'queue' ? 0 : 1)
        if (phase !== 'queue') expect(commands).toEqual(phase === 'after-fetch' ? ['Fetch.disable'] : ['Fetch.disable', 'Network.emulateNetworkConditionsByRule'])
        const state = await appWindow.evaluate(async id => (await (window as unknown as { hronaut: HronautApi }).hronaut.getState()).tabs.find(t => t.id === id)?.networkConditionState, tabId)
        if (change === 'close' || change === 'workspace-close') expect(state).toBeUndefined()
        else expect(state?.application).toBe(phase === 'queue' && change !== 'detach' ? 'confirmed' : 'unknown')
      } finally {
        transport.send = originalSend
        await electronApp.evaluate(() => { (globalThis as Scope).__conditionAuthority?.restore(); delete (globalThis as Scope).__conditionAuthority }).catch(() => undefined)
        await appWindow.evaluate(() => (window as unknown as { stopConditions(): void }).stopConditions()).catch(() => undefined)
        await Promise.allSettled([...(blocker ? [blocker] : []), ...(pending ? [pending] : [])])
      }
    })
  }
}

test('cancelled condition command retains queue ownership until native settlement', async ({ capabilities, appWindow, electronApp }) => {
  const { client, tabId, fixtureUrl } = capabilities
  await electronApp.evaluate(({ webContents }, fixtureUrl) => {
    const page = webContents.getAllWebContents().find(p => p.getURL() === fixtureUrl)!
    const api = page.debugger, original = api.sendCommand
    let release!: () => void
    const barrier = new Promise<void>(resolve => { release = resolve })
    const gate: Gate = { ready: false, released: false, commands: [], release: () => { gate.released = true; release() }, restore: () => { release(); api.sendCommand = original } }
    ;(globalThis as Scope).__conditionAuthority = gate
    api.sendCommand = async (method, ...args) => {
      if (['Fetch.disable','Network.emulateNetworkConditionsByRule','Network.overrideNetworkState'].includes(method)) gate.commands.push(method)
      const result = await original.call(api, method, ...args)
      if (method === 'Fetch.disable' && !gate.ready) { gate.ready = true; await barrier }
      return result
    }
  }, fixtureUrl)
  const transport = client.transport!, originalSend = transport.send.bind(transport)
  let delivered = false
  transport.send = async (message, options) => { await originalSend(message, options); if ('method' in message && message.method === 'notifications/cancelled') delivered = true }
  const abort = new AbortController()
  const pending = client.callTool({ name: 'browser_network_routes', arguments: { action: 'clear', tabId } }, undefined, { signal: abort.signal }).catch(() => undefined)
  try {
    await expect.poll(() => electronApp.evaluate(() => (globalThis as Scope).__conditionAuthority!.ready)).toBe(true)
    abort.abort()
    await expect.poll(() => delivered).toBe(true)
    await pending
    await appWindow.evaluate(id => {
      const scope = window as unknown as { hronaut: HronautApi; laterRecovery?: string }
      scope.laterRecovery = 'pending'
      void scope.hronaut.clearNetworkRoutes(id).then(() => { scope.laterRecovery = 'confirmed' }, () => { scope.laterRecovery = 'failed' })
    }, tabId)
    // getState uses the same renderer IPC transport after the later clear was
    // submitted; it does not share the native command queue.
    const health = await appWindow.evaluate(async id => (await (window as unknown as { hronaut: HronautApi }).hronaut.getState()).tabs.find(t => t.id === id)!.networkConditionState, tabId)
    expect(health?.application).toBe('pending')
    expect(await appWindow.evaluate(() => (window as unknown as { laterRecovery: string }).laterRecovery)).toBe('pending')
    expect(await electronApp.evaluate(() => (globalThis as Scope).__conditionAuthority!.commands)).toEqual(['Fetch.disable'])
    await electronApp.evaluate(() => (globalThis as Scope).__conditionAuthority!.release())
    await expect.poll(() => appWindow.evaluate(() => (window as unknown as { laterRecovery: string }).laterRecovery)).toBe('confirmed')
    expect(await electronApp.evaluate(() => (globalThis as Scope).__conditionAuthority!.commands)).toEqual(['Fetch.disable','Fetch.disable','Network.emulateNetworkConditionsByRule','Network.overrideNetworkState'])
  } finally {
    transport.send = originalSend
    await electronApp.evaluate(() => { (globalThis as Scope).__conditionAuthority?.restore(); delete (globalThis as Scope).__conditionAuthority }).catch(() => undefined)
    await pending
  }
})
