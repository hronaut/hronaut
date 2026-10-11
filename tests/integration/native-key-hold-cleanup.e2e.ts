import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { HronautApi } from '../../src/shared/types.js'
import { test, expect, text } from './capability-fixtures.js'
import { setupHoldPage, observeHold, holdObservation, restoreHold, type HoldFailure, type HoldScope } from './key-hold-fixture.js'

test.afterEach(async ({ electronApp }) => restoreHold(electronApp))

for (const failure of ['down-ack', 'release', 'relock', 'persistent-relock', 'emergency-preparation', 'final-restoration'] as HoldFailure[]) {
  test(`hold cleanup retains possible effects and restores focus guard: ${failure}`, async ({ capabilities, electronApp, appWindow }, testInfo) => {
    const { client, tabId, fixtureUrl } = capabilities
    await setupHoldPage(electronApp, fixtureUrl)
    await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.setTabHumanInteractionLocked(id, true), tabId)
    const before = await electronApp.evaluate(({ BrowserWindow, webContents }, url) => {
      const page = webContents.getAllWebContents().find(p => p.getURL() === url)!
      const owner = BrowserWindow.getAllWindows().find(w => w.contentView.children.some(v => 'webContents' in v && v.webContents === page))!
      owner.blur()
      return { focusable: owner.isFocusable(), blurListeners: owner.listenerCount('blur') }
    }, fixtureUrl)
    await observeHold(electronApp, fixtureUrl, failure)
    const result = await client.callTool({ name: 'browser_hold_key', arguments: { tabId, key: 'ArrowRight', durationMs: 30 } }) as CallToolResult
    const unconfirmed = failure === 'release' || failure === 'emergency-preparation'
    await expect.poll(async () => (await holdObservation(electronApp)).effects?.events.length).toBe(unconfirmed ? 1 : 2)
    const observed = await holdObservation(electronApp)
    const after = await electronApp.evaluate(({ BrowserWindow, webContents }, url) => {
      const page = webContents.getAllWebContents().find(p => p.getURL() === url)!
      const owner = BrowserWindow.getAllWindows().find(w => w.contentView.children.some(v => 'webContents' in v && v.webContents === page))!
      return { focusable: owner.isFocusable(), blurListeners: owner.listenerCount('blur') }
    }, fixtureUrl)
    await testInfo.attach('key-hold-cleanup', { body: JSON.stringify({ failure, result, observed, before, after }), contentType: 'application/json' })
    expect(result.isError, text(result)).toBe(true)
    expect(result.structuredContent).toMatchObject({ status: 'OUTCOME_UNKNOWN', retrySafe: false, effects: 'possible', release: unconfirmed ? 'UNCONFIRMED' : 'ACKNOWLEDGED' })
    expect(observed.commands.map(c => c.type)).toEqual(failure === 'emergency-preparation' ? ['rawKeyDown'] : ['rawKeyDown', 'keyUp'])
    expect(observed.effects!.held).toBe(unconfirmed)
    expect(after).toEqual(before)
    if (failure === 'emergency-preparation') expect(observed.unlocks).toBe(2) // Down preparation + exactly one emergency cleanup preparation.
    if (failure === 'persistent-relock') expect(observed.relocks).toBe(3)
    await electronApp.evaluate(() => (globalThis as HoldScope).holdProbe!.restore())
    if (unconfirmed) {
      for (const navigate of [false, true]) {
        if (navigate) await electronApp.evaluate(async ({ webContents }, url) => webContents.getAllWebContents().find(p => p.getURL() === url)!.executeJavaScript("location.hash='release-unconfirmed';void 0"), fixtureUrl)
        const rejected = await client.callTool({ name: 'browser_hold_key', arguments: { tabId, key: 'ArrowRight', durationMs: 1 } }) as CallToolResult
        expect(rejected.isError).toBe(true)
        expect(text(rejected)).toContain('release is unconfirmed')
      }
      await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.closeTab(id), tabId)
    } else {
      const next = await client.callTool({ name: 'browser_press', arguments: { tabId, key: 'ArrowRight' } }) as CallToolResult
      expect(next.isError, text(next)).not.toBe(true)
      expect((await client.callTool({ name: 'browser_hold_key', arguments: { tabId, key: 'ArrowRight', durationMs: 1 } }) as CallToolResult).isError).not.toBe(true)
      expect((await holdObservation(electronApp)).effects!.held).toBe(false)
    }
  })
}
