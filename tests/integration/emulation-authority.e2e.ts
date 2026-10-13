import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { HronautApi, McpTabActivity } from '../../src/shared/types.js'
import { expect, test } from './capability-fixtures.js'

type AuthorityGate = { ready: boolean; released: boolean; commands: string[]; release(): void; restore(): void }
type AuthorityScope = typeof globalThis & { __emulationAuthority?: AuthorityGate }

for (const operation of ['apply', 'recover'] as const) {
  for (const phase of ['queue', 'after-media', 'after-final'] as const) {
    if (operation === 'recover' && phase === 'queue') continue
    for (const change of ['pause', 'cancel', 'access', 'navigation', 'close', 'workspace-close', 'detach'] as const) {
      test(`emulation ${operation} revalidates ${change} at ${phase}`, async ({ capabilities, appWindow, electronApp }) => {
        const { client, tabId, fixtureUrl } = capabilities
        if (operation === 'recover') {
          await electronApp.evaluate(({ webContents }, url) => {
            const page = webContents.getAllWebContents().find(p => p.getURL() === url)!
            const api = page.debugger, original = api.sendCommand
            ;(globalThis as AuthorityScope).__emulationAuthority = { ready: false, released: true, commands: [], release: () => {}, restore: () => { api.sendCommand = original } }
            api.sendCommand = async (method, ...args) => {
              if (method === 'Emulation.setEmulatedVisionDeficiency') throw new Error('Controlled initial partial emulation')
              return original.call(api, method, ...args)
            }
          }, fixtureUrl)
          const failed = await client.callTool({ name: 'browser_emulate', arguments: { tabId, colorScheme: 'dark' } }) as CallToolResult
          expect(failed.isError).toBe(true)
          await electronApp.evaluate(() => { (globalThis as AuthorityScope).__emulationAuthority!.restore() })
        }
        await electronApp.evaluate(({ webContents }, { fixtureUrl, phase }) => {
          const page = webContents.getAllWebContents().find(p => p.getURL() === fixtureUrl)!
          const api = page.debugger, original = api.sendCommand
          let release!: () => void
          const barrier = new Promise<void>(resolve => { release = resolve })
          const gate: AuthorityGate = { ready: false, released: false, commands: [], release: () => { gate.released = true; release() }, restore: () => { release(); if (!page.isDestroyed()) api.sendCommand = original } }
          ;(globalThis as AuthorityScope).__emulationAuthority = gate
          api.sendCommand = async (method, ...args) => {
            if (['Emulation.setEmulatedMedia','Emulation.setEmulatedVisionDeficiency','Overlay.disable'].includes(method)) gate.commands.push(method)
            const result = await original.call(api, method, ...args)
            const target = phase === 'queue' ? 'Network.setCacheDisabled' : phase === 'after-media' ? 'Emulation.setEmulatedMedia' : 'Overlay.disable'
            if (!gate.ready && method === target) { gate.ready = true; await barrier }
            return result
          }
        }, { fixtureUrl, phase })
        await appWindow.evaluate(() => {
          const scope = window as unknown as { hronaut: HronautApi; conditionActivities: McpTabActivity[]; stopConditions(): void }
          scope.conditionActivities = []
          scope.stopConditions = scope.hronaut.onMcpTabActivity(activity => { if (activity.toolName === 'browser_emulate') scope.conditionActivities.push(activity) })
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
            await expect.poll(() => electronApp.evaluate(() => (globalThis as AuthorityScope).__emulationAuthority!.ready)).toBe(true)
          }
          pending = (client.callTool({ name: 'browser_emulate', arguments: { tabId, ...(operation === 'recover' ? { recover: true } : { colorScheme: 'dark' }) } }, undefined, { signal: abort.signal }) as Promise<CallToolResult>).catch(() => ({ isError: true, content: [] }))
          await expect.poll(() => appWindow.evaluate(() => (window as unknown as { conditionActivities: McpTabActivity[] }).conditionActivities.some(a => a.phase === 'started'))).toBe(true)
          await expect.poll(() => electronApp.evaluate(() => (globalThis as AuthorityScope).__emulationAuthority!.ready)).toBe(true)
          if (change === 'pause') await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.setTabAgentPaused(id, true), tabId)
          if (change === 'access') await appWindow.evaluate(async id => { const api = (window as unknown as { hronaut: HronautApi }).hronaut; const group = (await api.getState()).tabs.find(t => t.id === id)!.mcpGroupId!; await api.updateTabGroup(group, { agentAccess: false }) }, tabId)
          if (change === 'navigation') await electronApp.evaluate(async ({ webContents }, url) => { await webContents.getAllWebContents().find(p => p.getURL() === url)!.loadURL('data:text/html,changed condition context') }, fixtureUrl)
          if (change === 'close') await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.closeTab(id), tabId)
          if (change === 'workspace-close') await appWindow.evaluate(async id => { const api = (window as unknown as { hronaut: HronautApi }).hronaut; const group = (await api.getState()).tabs.find(t => t.id === id)!.mcpGroupId!; await api.closeWorkspace(group) }, tabId)
          if (change === 'detach') await electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(p => p.getURL() === url)!.debugger.detach(), fixtureUrl)
          if (change === 'cancel') { abort.abort(); await expect.poll(() => cancellationDelivered).toBe(true) }
          // Cancellation settles the client transport, but must not release the native queue.
          expect(await electronApp.evaluate(() => (globalThis as AuthorityScope).__emulationAuthority!.released)).toBe(false)
          await electronApp.evaluate(() => (globalThis as AuthorityScope).__emulationAuthority!.release())
          await blocker
          const result = await pending
          expect(result.isError).toBe(true)
          if (change !== 'cancel') expect(result.structuredContent).toMatchObject({ status: phase === 'queue' ? 'NOT_DISPATCHED' : 'OUTCOME_UNKNOWN', effects: phase === 'queue' ? 'none' : 'possible', retrySafe: false })
          await expect.poll(() => appWindow.evaluate(() => (window as unknown as { conditionActivities: McpTabActivity[] }).conditionActivities.filter(a => a.phase === 'failed').at(-1)?.result)).toMatchObject({ dispatch: phase === 'queue' ? 'not-dispatched' : 'dispatched', effects: phase === 'queue' ? 'none' : 'possible' })
          const commands = await electronApp.evaluate(() => (globalThis as AuthorityScope).__emulationAuthority!.commands)
          if (phase === 'after-media') expect(commands).toEqual(['Emulation.setEmulatedMedia'])
          if (phase === 'after-final') expect(commands).toEqual(['Emulation.setEmulatedMedia', 'Emulation.setEmulatedVisionDeficiency', 'Overlay.disable'])
          const state = await appWindow.evaluate(async id => (await (window as unknown as { hronaut: HronautApi }).hronaut.getState()).tabs.find(t => t.id === id), tabId)
          if (change === 'close' || change === 'workspace-close') expect(state).toBeUndefined()
          else {
            const contextLost = change === 'detach' || change === 'navigation'
            const unknown = contextLost || phase === 'after-media'
            expect(state?.emulationState?.application ?? 'confirmed').toBe(unknown ? 'unknown' : 'confirmed')
            if (unknown) expect(state?.emulation).toBeUndefined()
          }
        } finally {
          transport.send = originalSend
          await electronApp.evaluate(() => { (globalThis as AuthorityScope).__emulationAuthority?.restore(); delete (globalThis as AuthorityScope).__emulationAuthority }).catch(() => undefined)
          await appWindow.evaluate(() => (window as unknown as { stopConditions(): void }).stopConditions()).catch(() => undefined)
          await Promise.allSettled([...(blocker ? [blocker] : []), ...(pending ? [pending] : [])])
        }
      })
    }
  }
}
