import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { HronautApi } from '../../src/shared/types.js'
import { test, expect, text } from './capability-fixtures.js'
import { setupHoldPage, observeHold, holdObservation, restoreHold, type HoldScope } from './key-hold-fixture.js'

type HumanScope = typeof globalThis & { holdHuman?: { events: boolean[]; restore(): void } }
for (const locked of [false, true]) test(`hold preserves human mismatch accounting with lock ${locked}`, async ({ capabilities, electronApp, appWindow }, testInfo) => {
  const { client, tabId, fixtureUrl } = capabilities
  await setupHoldPage(electronApp, fixtureUrl)
  await appWindow.evaluate(({ id, locked }) => (window as unknown as { hronaut: HronautApi }).hronaut.setTabHumanInteractionLocked(id, locked), { id: tabId, locked })
  await electronApp.evaluate(({ webContents }, url) => {
    const page = webContents.getAllWebContents().find(p => p.getURL() === url)!
    page.focus() // Controlled native fixture setup, never tool setup.
    const events: boolean[] = []
    const listener = (event: Electron.Event, input: Electron.Input): void => { if (input.type === 'keyDown' && input.key === 'ArrowUp') events.push(event.defaultPrevented) }
    page.on('before-input-event', listener)
    ;(globalThis as HumanScope).holdHuman = { events, restore: () => page.removeListener('before-input-event', listener) }
  }, fixtureUrl)
  const generation = (): Promise<number> => appWindow.evaluate(async id => (await (window as unknown as { hronaut: HronautApi }).hronaut.getState()).tabs.find(t => t.id === id)!.humanInteractionGeneration ?? 0, tabId)
  const before = await generation()
  await observeHold(electronApp, fixtureUrl)
  let pending: Promise<CallToolResult> | undefined
  try {
    pending = client.callTool({ name: 'browser_hold_key', arguments: { tabId, key: 'ArrowRight', durationMs: locked ? 600 : 5000 } }) as Promise<CallToolResult>
    await expect.poll(() => electronApp.evaluate(() => (globalThis as HoldScope).holdProbe!.downAcknowledged)).toBe(true)
    const triggeredAt = Date.now()
    await electronApp.evaluate(({ webContents }) => {
      const page = webContents.fromId((globalThis as HoldScope).holdProbe!.pageId)!
      page.sendInputEvent({ type: 'keyDown', keyCode: 'Up' })
      page.sendInputEvent({ type: 'keyUp', keyCode: 'Up' })
    })
    if (!locked) await expect.poll(() => electronApp.evaluate(() => (globalThis as HumanScope).holdHuman!.events)).toEqual([false])
    const result = await pending
    expect(result.isError === true, text(result)).toBe(!locked)
    expect(await generation() - before).toBe(locked ? 0 : 1)
    expect(result.structuredContent ?? JSON.parse(text(result))).toMatchObject({ status: locked ? 'DISPATCH_ACKNOWLEDGED' : 'OUTCOME_UNKNOWN', release: 'ACKNOWLEDGED' })
    await expect.poll(async () => (await holdObservation(electronApp)).effects?.held).toBe(false)
    const observed = await holdObservation(electronApp)
    expect(observed.commands.map(c => c.type)).toEqual(['rawKeyDown', 'keyUp'])
    if (locked) {
      expect(observed.effects!.events.filter(e => e.key === 'ArrowUp')).toEqual([])
      expect(await electronApp.evaluate(() => (globalThis as HumanScope).holdHuman!.events)).toEqual([])
    }
    if (!locked) expect(observed.effects!.events.find(e => e.type === 'keyup' && e.key === 'ArrowRight')!.wallTime - triggeredAt).toBeLessThan(1500)
    await testInfo.attach('human-mismatch', { body: JSON.stringify({ locked, triggeredAt, result, observed }), contentType: 'application/json' })
  } finally {
    await restoreHold(electronApp)
    await electronApp.evaluate(() => { (globalThis as HumanScope).holdHuman?.restore(); delete (globalThis as HumanScope).holdHuman })
    await pending?.catch(() => undefined)
  }
})

test('overlapping hold is rejected without a second down and cleanup admits a fresh hold', async ({ capabilities, electronApp, appWindow }) => {
  const { client, tabId, fixtureUrl } = capabilities
  await setupHoldPage(electronApp, fixtureUrl)
  await observeHold(electronApp, fixtureUrl)
  let pending: Promise<CallToolResult> | undefined
  try {
    pending = client.callTool({ name: 'browser_hold_key', arguments: { tabId, key: 'ArrowRight', durationMs: 5000 } }) as Promise<CallToolResult>
    await expect.poll(() => electronApp.evaluate(() => (globalThis as HoldScope).holdProbe!.downAcknowledged)).toBe(true)
    const overlapping = await client.callTool({ name: 'browser_hold_key', arguments: { tabId, key: 'a', durationMs: 1 } }) as CallToolResult
    expect(overlapping.isError, text(overlapping)).toBe(true)
    expect((await holdObservation(electronApp)).commands.map(c => c.type)).toEqual(['rawKeyDown'])
    await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.setTabAgentPaused(id, true), tabId)
    expect((await pending).structuredContent).toMatchObject({ status: 'OUTCOME_UNKNOWN', release: 'ACKNOWLEDGED' })
    await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.setTabAgentPaused(id, false), tabId)
    await restoreHold(electronApp)
    expect((await client.callTool({ name: 'browser_press', arguments: { tabId, key: 'a' } })).isError).not.toBe(true)
    expect((await client.callTool({ name: 'browser_hold_key', arguments: { tabId, key: 'ArrowRight', durationMs: 1 } })).isError).not.toBe(true)
  } finally { await restoreHold(electronApp); await pending?.catch(() => undefined) }
})

for (const context of ['hidden', 'child-frame', 'devtools'] as const) test(`hold rejects unsupported ${context} context without input`, async ({ capabilities, electronApp, appWindow }, testInfo) => {
  const { client, tabId, fixtureUrl } = capabilities
  await setupHoldPage(electronApp, fixtureUrl)
  await observeHold(electronApp, fixtureUrl)
  try {
    if (context === 'hidden') await appWindow.evaluate(async id => {
      const api = (window as unknown as { hronaut: HronautApi }).hronaut
      const other = (await api.getState()).tabs.find(t => t.id !== id && !t.sleeping)!
      await api.selectTab(other.id)
    }, tabId)
    else if (context === 'devtools') {
      await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.toggleDevTools(id), tabId)
      expect(await electronApp.evaluate(({ webContents }) => webContents.fromId((globalThis as HoldScope).holdProbe!.pageId)!.isDevToolsOpened())).toBe(true)
    } else await electronApp.evaluate(async ({ webContents }) => {
      const page = webContents.fromId((globalThis as HoldScope).holdProbe!.pageId)!
      await page.executeJavaScript("document.body.appendChild(document.createElement('iframe'));void 0")
    })
    const before = await appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState())
    const result = await client.callTool({ name: 'browser_hold_key', arguments: { tabId, key: 'ArrowRight', durationMs: 1 } }) as CallToolResult
    await testInfo.attach('rejected-context', { body: JSON.stringify({ context, result, observed: await holdObservation(electronApp) }), contentType: 'application/json' })
    expect(result.structuredContent, text(result)).toMatchObject({ status: 'NOT_DISPATCHED', effects: 'none' })
    expect((await holdObservation(electronApp)).commands).toEqual([])
    const after = await appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState())
    expect(after.activeTabId).toBe(before.activeTabId)
    if (context === 'hidden') {
      await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.selectTab(id), tabId)
      // Trusted UI selection synchronously attaches the view, while renderer
      // toolbar layout can still settle on subsequent frames. Establish the
      // presentation precondition before testing a separate fresh call.
      await appWindow.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
      const presentation = await electronApp.evaluate(({ BrowserWindow, webContents }) => {
        const page = webContents.fromId((globalThis as HoldScope).holdProbe!.pageId)!
        const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('index.html'))!
        const view = win.contentView.children.find(v => 'webContents' in v && (v as Electron.WebContentsView).webContents === page)
        return { attached: Boolean(view), visible: view?.getVisible(), bounds: view?.getBounds(), windowVisible: win.isVisible() }
      })
      expect(presentation).toMatchObject({ attached: true, visible: true, windowVisible: true })
      expect(presentation.bounds!.width).toBeGreaterThan(0)
      expect(presentation.bounds!.height).toBeGreaterThan(0)
      await testInfo.attach('fresh-presentation', { body: JSON.stringify(presentation), contentType: 'application/json' })
      const fresh = await client.callTool({ name: 'browser_hold_key', arguments: { tabId, key: 'ArrowRight', durationMs: 1 } }) as CallToolResult
      await testInfo.attach('fresh-selection', { body: JSON.stringify(fresh), contentType: 'application/json' })
      expect(fresh.isError, text(fresh)).not.toBe(true)
    }
  } finally { await restoreHold(electronApp) }
})
