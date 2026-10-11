import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { HronautApi } from '../../src/shared/types.js'
import { test, expect, text } from './capability-fixtures.js'

type QueueGate = { held: boolean; commands: string[]; baseline: number; release: () => void; restore: () => void }
type QueueScope = typeof globalThis & { holdQueue?: QueueGate }

test('hold captures authority before waiting behind a read-only debugger operation', async ({ capabilities, electronApp, appWindow }, testInfo) => {
  const { client, tabId, fixtureUrl } = capabilities
  await electronApp.evaluate(({ webContents }, url) => {
    const page = webContents.getAllWebContents().find(p => p.getURL() === url)!
    const send = page.debugger.sendCommand
    let release!: () => void
    const hold = new Promise<void>(resolve => { release = resolve })
    const gate: QueueGate = { held: false, commands: [], baseline: page.listenerCount('frame-created'), release, restore: () => { release(); if (!page.isDestroyed()) page.debugger.sendCommand = send } }
    ;(globalThis as QueueScope).holdQueue = gate
    page.debugger.sendCommand = async (method, ...args) => {
      if (method === 'Storage.getUsageAndQuota' && !gate.held) { gate.held = true; await hold }
      if (method === 'Input.dispatchKeyEvent') gate.commands.push(String((args[0] as Record<string, unknown>)?.type))
      return send.call(page.debugger, method, ...args)
    }
  }, fixtureUrl)
  let preparation: Promise<CallToolResult> | undefined
  let hold: Promise<CallToolResult> | undefined
  try {
    preparation = client.callTool({ name: 'browser_storage_usage', arguments: { tabId } }) as Promise<CallToolResult>
    await expect.poll(() => electronApp.evaluate(() => (globalThis as QueueScope).holdQueue!.held)).toBe(true)
    hold = client.callTool({ name: 'browser_hold_key', arguments: { tabId, key: 'ArrowRight', durationMs: 1 } }) as Promise<CallToolResult>
    await expect.poll(() => electronApp.evaluate(({ webContents }, url) => {
      const page = webContents.getAllWebContents().find(p => p.getURL() === url)!
      return page.listenerCount('frame-created') - (globalThis as QueueScope).holdQueue!.baseline
    }, fixtureUrl)).toBe(1)
    await appWindow.evaluate(async id => {
      const api = (window as unknown as { hronaut: HronautApi }).hronaut
      const other = (await api.getState()).tabs.find(t => t.id !== id && !t.sleeping)!
      await api.selectTab(other.id)
      await api.selectTab(id)
    }, tabId)
    await electronApp.evaluate(() => (globalThis as QueueScope).holdQueue!.release())
    const prepared = await preparation
    expect(prepared.isError, text(prepared)).not.toBe(true)
    const result = await hold
    expect(result.isError, text(result)).toBe(true)
    expect(result.structuredContent).toMatchObject({ status: 'NOT_DISPATCHED', effects: 'none' })
    const commands = await electronApp.evaluate(() => (globalThis as QueueScope).holdQueue!.commands)
    expect(commands).toEqual([])
    await testInfo.attach('hold-queued-authority', { body: JSON.stringify({ result, commands }), contentType: 'application/json' })
    // Invalidated calls do not poison a fresh hold request.
    const fresh = await client.callTool({ name: 'browser_hold_key', arguments: { tabId, key: 'ArrowRight', durationMs: 1 } }) as CallToolResult
    expect(fresh.isError, text(fresh)).not.toBe(true)
  } finally {
    await electronApp.evaluate(() => { (globalThis as QueueScope).holdQueue?.restore(); delete (globalThis as QueueScope).holdQueue }).catch(() => undefined)
    await Promise.allSettled([preparation, hold].filter((p): p is Promise<CallToolResult> => p !== undefined))
  }
})
