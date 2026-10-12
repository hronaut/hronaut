import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { test, expect, text } from './capability-fixtures.js'
import { setupHoldPage, observeHold, restoreHold, type HoldScope } from './key-hold-fixture.js'

type CleanupScope = HoldScope & { cleanupProbe?: {
  entered: boolean; acknowledged: boolean; destroyed: boolean; release: () => void; restore: () => void
} }

for (const mode of ['destroy', 'live'] as const) {
  test(`native input cleanup ${mode === 'destroy' ? 'settles when its original page is destroyed' : 'waits for the live document'}`, async ({ capabilities, electronApp }, testInfo) => {
    const { client, tabId, fixtureUrl } = capabilities
    await setupHoldPage(electronApp, fixtureUrl)
    await observeHold(electronApp, fixtureUrl)
    const focusable = await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isFocusable())
    await electronApp.evaluate(({ webContents }, { url, mode }) => {
      const page = webContents.getAllWebContents().find(p => p.getURL() === url)!
      const original = page.executeJavaScript
      let release!: () => void
      const barrier = new Promise<void>(resolve => { release = resolve })
      const destroyed = () => { probe.destroyed = true }
      const probe = { entered: false, acknowledged: false, destroyed: false, release, restore: () => {
        release(); page.removeListener('destroyed', destroyed)
        if (!page.isDestroyed()) page.executeJavaScript = original
      } }
      ;(globalThis as CleanupScope).cleanupProbe = probe
      page.once('destroyed', destroyed)
      page.executeJavaScript = async (script, ...args) => {
        if (script !== 'delete window.__hronautAgentInputActive') return original.call(page, script, ...args)
        // Dispatch the real Electron evaluation before destruction. Electron can
        // leave this promise pending when its original target disappears.
        const evaluating = original.call(page, script, ...args)
        probe.entered = true
        if (mode === 'destroy') page.close()
        const result = await evaluating
        probe.acknowledged = true
        if (mode === 'live') await barrier
        return result
      }
    }, { url: fixtureUrl, mode })
    const abort = new AbortController()
    let settled = false
    let result: CallToolResult | undefined
    let rejected = false
    const pending = (client.callTool({ name: 'browser_hold_key', arguments: { tabId, key: 'ArrowRight', durationMs: 200 } }, undefined, { signal: abort.signal }) as Promise<CallToolResult>).then(value => { result = value; settled = true }, () => { rejected = true; settled = true })
    const observation = () => electronApp.evaluate(() => {
      const hold = (globalThis as CleanupScope).holdProbe!
      const cleanup = (globalThis as CleanupScope).cleanupProbe!
      return { commands: hold.commands.map(c => c.type), downAcknowledged: hold.downAcknowledged, upAcknowledged: hold.upAcknowledged, entered: cleanup.entered, cleanupAcknowledged: cleanup.acknowledged, destroyed: cleanup.destroyed }
    })
    try {
      await expect.poll(async () => (await observation()).entered).toBe(true)
      if (mode === 'live') {
        await expect.poll(async () => (await observation()).cleanupAcknowledged).toBe(true)
        expect(settled).toBe(false)
        await electronApp.evaluate(() => (globalThis as CleanupScope).cleanupProbe!.release())
      }
      await expect.poll(() => settled).toBe(true)
      expect(rejected).toBe(false)
      const observed = await observation()
      expect(observed).toMatchObject({ commands: ['rawKeyDown', 'keyUp'], downAcknowledged: true, upAcknowledged: true, destroyed: mode === 'destroy' })
      expect(result!.structuredContent ?? JSON.parse(text(result!))).toMatchObject(mode === 'destroy'
        ? { status: 'OUTCOME_UNKNOWN', retrySafe: false, release: 'ACKNOWLEDGED' }
        : { status: 'DISPATCH_ACKNOWLEDGED', release: 'ACKNOWLEDGED' })
      expect(result?.isError === true).toBe(mode === 'destroy')
      const terminal = () => electronApp.evaluate(async ({ webContents }, id) => {
        const home = webContents.getAllWebContents().find(p => p.getURL().startsWith('hronaut://home'))!
        const state = await (await home.session.fetch('hronaut://home/api/status')).json() as { recentActivity: Array<{ toolName: string; tabId: string; result: { outcome: string; effects: string; dispatch: string } }> }
        return state.recentActivity.filter(a => a.toolName === 'browser_hold_key' && a.tabId === id).map(a => a.result)
      }, tabId)
      await expect.poll(terminal).toHaveLength(1)
      expect((await terminal())[0]).toMatchObject(mode === 'destroy' ? { outcome: 'outcome-unknown', effects: 'possible', dispatch: 'dispatched' } : { outcome: 'succeeded', dispatch: 'dispatched' })
      expect(await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isFocusable())).toBe(focusable)
    } finally {
      // Preserve the failing state before aborting or deleting either probe.
      await testInfo.attach('input-cleanup-state', { body: JSON.stringify({ mode, settled, rejected, observed: await observation().catch(() => null), result: result ? result.structuredContent ?? JSON.parse(text(result)) : null }), contentType: 'application/json' })
      await electronApp.evaluate(() => (globalThis as CleanupScope).cleanupProbe?.restore()).catch(() => undefined)
      abort.abort()
      await pending
      await restoreHold(electronApp)
      await electronApp.evaluate(() => { delete (globalThis as CleanupScope).cleanupProbe }).catch(() => undefined)
    }
  })
}
