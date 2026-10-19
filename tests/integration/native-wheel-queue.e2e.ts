import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { HronautApi } from '../../src/shared/types.js'
import { test, expect, text } from './capability-fixtures.js'
import { waitForSettledPageBounds } from './settled-page-bounds.js'

type QueueGate = { held: boolean; commands: string[]; baseline: number; release: () => void; restore: () => void }
type QueueScope = typeof globalThis & { wheelQueue?: QueueGate }

// A wheel refuses to start when main moves its page; let the toolbar settle
// after the fixture selects its tab.
test.beforeEach(async ({ capabilities, electronApp }) => {
  await waitForSettledPageBounds(electronApp, capabilities.fixtureUrl)
})

test('wheel captures geometry before waiting behind another debugger operation', async ({ capabilities, electronApp, appWindow }, testInfo) => {
  const { client, tabId, fixtureUrl } = capabilities
  await electronApp.evaluate(({ webContents }, url) => {
    const page = webContents.getAllWebContents().find(p => p.getURL() === url)!
    const send = page.debugger.sendCommand
    let release!: () => void
    const hold = new Promise<void>(resolve => { release = resolve })
    const gate: QueueGate = { held: false, commands: [], baseline: page.listenerCount('zoom-changed'), release, restore: () => { release(); if (!page.isDestroyed()) page.debugger.sendCommand = send } }
    ;(globalThis as QueueScope).wheelQueue = gate
    page.debugger.sendCommand = async (method, ...args) => {
      if (method === 'Storage.getUsageAndQuota' && !gate.held) { gate.held = true; await hold }
      if (method === 'Input.dispatchMouseEvent') gate.commands.push(String((args[0] as Record<string, unknown>)?.type))
      return send.call(page.debugger, method, ...args)
    }
  }, fixtureUrl)
  let preparation: Promise<CallToolResult> | undefined
  let wheel: Promise<CallToolResult> | undefined
  try {
    preparation = client.callTool({ name: 'browser_storage_usage', arguments: { tabId } }) as Promise<CallToolResult>
    await expect.poll(() => electronApp.evaluate(() => (globalThis as QueueScope).wheelQueue!.held)).toBe(true)
    wheel = client.callTool({ name: 'browser_wheel', arguments: { tabId, x: 150, y: 150, deltaX: 0, deltaY: 20 } }) as Promise<CallToolResult>
    await expect.poll(() => electronApp.evaluate(({ webContents }, url) => {
      const page = webContents.getAllWebContents().find(p => p.getURL() === url)!
      return page.listenerCount('zoom-changed') - (globalThis as QueueScope).wheelQueue!.baseline
    }, fixtureUrl)).toBe(1)
    await appWindow.evaluate(async id => {
      const api = (window as unknown as { hronaut: HronautApi }).hronaut
      await api.setZoom({ tabId: id, action: 'set', percent: 125 })
      await api.setZoom({ tabId: id, action: 'reset' })
    }, tabId)
    await electronApp.evaluate(() => (globalThis as QueueScope).wheelQueue!.release())
    const prepared = await preparation
    expect(prepared.isError, text(prepared)).not.toBe(true)
    const result = await wheel
    expect(result.isError, text(result)).toBe(true)
    expect(text(result)).toContain('environment changed')
    const commands = await electronApp.evaluate(() => (globalThis as QueueScope).wheelQueue!.commands)
    expect(commands).toEqual([])
    await testInfo.attach('wheel-queued-geometry', { body: JSON.stringify({ result, commands }), contentType: 'application/json' })
    // Invalidated calls do not poison a fresh default-geometry request.
    const fresh = await client.callTool({ name: 'browser_wheel', arguments: { tabId, x: 150, y: 150, deltaX: 0, deltaY: 20 } }) as CallToolResult
    expect(fresh.isError, text(fresh)).not.toBe(true)
  } finally {
    await electronApp.evaluate(() => { (globalThis as QueueScope).wheelQueue?.restore(); delete (globalThis as QueueScope).wheelQueue }).catch(() => undefined)
    await Promise.allSettled([preparation, wheel].filter((p): p is Promise<CallToolResult> => p !== undefined))
  }
})

for (const change of ['pause', 'cancel'] as const) {
  test(`wheel ${change} after a command was dispatched remains uncertain without replay`, async ({ capabilities, electronApp, appWindow }, testInfo) => {
    const { client, tabId, fixtureUrl } = capabilities
    await electronApp.evaluate(({ webContents }, url) => {
      const page = webContents.getAllWebContents().find(p => p.getURL() === url)!
      const send = page.debugger.sendCommand
      let release!: () => void
      const hold = new Promise<void>(resolve => { release = resolve })
      const gate: QueueGate = { held: false, commands: [], baseline: 0, release, restore: () => { release(); if (!page.isDestroyed()) page.debugger.sendCommand = send } }
      ;(globalThis as QueueScope).wheelQueue = gate
      page.debugger.sendCommand = async (method, ...args) => {
        const result = await send.call(page.debugger, method, ...args)
        if (method === 'Input.dispatchMouseEvent') {
          gate.commands.push(String((args[0] as Record<string, unknown>)?.type))
          gate.held = true
          await hold
        }
        return result
      }
    }, fixtureUrl)
    const transport = client.transport!
    const send = transport.send.bind(transport)
    let requestId: string | number | undefined
    transport.send = async (message, options) => {
      if ('method' in message && message.method === 'tools/call' && 'id' in message && message.params?.name === 'browser_wheel') requestId = message.id
      return send(message, options)
    }
    const abort = new AbortController()
    let pending: Promise<CallToolResult> | undefined
    try {
      pending = client.callTool({ name: 'browser_wheel', arguments: { tabId, x: 150, y: 150, deltaX: 0, deltaY: 20 } }, undefined, { signal: abort.signal }) as Promise<CallToolResult>
      if (change === 'cancel') pending = pending.catch(() => ({ isError: true, content: [{ type: 'text', text: 'Client cancelled' }] }))
      await expect.poll(() => electronApp.evaluate(() => (globalThis as QueueScope).wheelQueue!.held)).toBe(true)
      if (change === 'pause') await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.setTabAgentPaused(id, true), tabId)
      else {
        if (requestId === undefined) throw new Error('Missing dispatched wheel request ID')
        await client.notification({ method: 'notifications/cancelled', params: { requestId, reason: 'Controlled cancellation after raw wheel acknowledgement' } })
        abort.abort()
      }
      await electronApp.evaluate(() => (globalThis as QueueScope).wheelQueue!.release())
      const result = await pending
      const terminal = () => electronApp.evaluate(async ({ webContents }, id) => {
        const home = webContents.getAllWebContents().find(p => p.getURL().startsWith('hronaut://home'))!
        const state = await (await home.session.fetch('hronaut://home/api/status')).json() as { recentActivity: Array<{ toolName: string; tabId: string; result: unknown }> }
        return state.recentActivity.filter(activity => activity.toolName === 'browser_wheel' && activity.tabId === id)
      }, tabId)
      await expect.poll(terminal).toHaveLength(1)
      const activity = await terminal()
      const commands = await electronApp.evaluate(() => (globalThis as QueueScope).wheelQueue!.commands)
      await testInfo.attach('wheel-post-dispatch-uncertainty', { body: JSON.stringify({ change, result, commands, activity }), contentType: 'application/json' })
      expect(result.isError, text(result)).toBe(true)
      if (change === 'cancel') expect(activity).toMatchObject([{ result: { outcome: 'cancelled', dispatch: 'dispatched', effects: 'possible' } }])
      else expect(result.structuredContent).toMatchObject({ status: 'OUTCOME_UNKNOWN', retrySafe: false, effects: 'possible' })
      expect(commands).toEqual(['mouseWheel'])
    } finally {
      transport.send = send
      await electronApp.evaluate(() => { (globalThis as QueueScope).wheelQueue?.restore(); delete (globalThis as QueueScope).wheelQueue }).catch(() => undefined)
      await pending?.catch(() => undefined)
    }
  })
}
