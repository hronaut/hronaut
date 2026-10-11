import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { HronautApi } from '../../src/shared/types.js'
import { test, expect, text } from './capability-fixtures.js'
import { setupHoldPage, observeHold, holdObservation, restoreHold, type HoldScope } from './key-hold-fixture.js'

test.afterEach(async ({ electronApp }) => restoreHold(electronApp))

for (const { locked, durationMs } of [{ locked: false, durationMs: 180 }, { locked: true, durationMs: 180 }, { locked: false, durationMs: 5000 }]) test(`native hold ${durationMs}ms advances a canvas and releases without repeat with lock ${locked}`, async ({ capabilities, electronApp, appWindow }, testInfo) => {
  const { client, tabId, fixtureUrl } = capabilities
  await setupHoldPage(electronApp, fixtureUrl)
  await appWindow.evaluate(({ id, locked }) => (window as unknown as { hronaut: HronautApi }).hronaut.setTabHumanInteractionLocked(id, locked), { id: tabId, locked })
  await observeHold(electronApp, fixtureUrl)
  const result = await client.callTool({ name: 'browser_hold_key', arguments: { tabId, key: 'ArrowRight', durationMs } }) as CallToolResult
  await expect.poll(async () => (await holdObservation(electronApp)).effects?.events.length).toBe(2)
  const observed = await holdObservation(electronApp)
  await testInfo.attach('native-key-hold', { body: JSON.stringify({ locked, result, observed }), contentType: 'application/json' })
  expect(result.isError, text(result)).not.toBe(true)
  expect(JSON.parse(text(result))).toMatchObject({ status: 'DISPATCH_ACKNOWLEDGED', durationMs, release: 'ACKNOWLEDGED' })
  expect(observed.commands.map(c => c.type)).toEqual(['rawKeyDown', 'keyUp'])
  expect(observed.commands.every(c => c.params.modifiers === 0 && c.params.text === undefined && c.params.autoRepeat === undefined)).toBe(true)
  expect(observed.effects!.events.map(e => [e.type, e.key, e.trusted, e.repeat])).toEqual([['keydown', 'ArrowRight', true, false], ['keyup', 'ArrowRight', true, false]])
  const elapsed = observed.effects!.events[1]!.time - observed.effects!.events[0]!.time
  expect(elapsed).toBeGreaterThanOrEqual(durationMs - 20)
  expect(elapsed).toBeLessThan(durationMs + 2000) // Observed tolerance, not a product deadline.
  expect(observed.effects!.held).toBe(false)
  expect(observed.effects!.frames).toBeGreaterThan(2)
  await electronApp.evaluate(async ({ webContents }, url) => webContents.getAllWebContents().find(p => p.getURL() === url)!.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))'), fixtureUrl)
  expect((await holdObservation(electronApp)).effects!.frames).toBe(observed.effects!.frames)
  await electronApp.evaluate(async ({ webContents }, url) => webContents.getAllWebContents().find(p => p.getURL() === url)!.executeJavaScript("document.querySelector('#text').focus();void 0"), fixtureUrl)
  for (const key of ['x', 'Control+a', 'y']) expect((await client.callTool({ name: 'browser_press', arguments: { tabId, key } }) as CallToolResult).isError).not.toBe(true)
  expect(await electronApp.evaluate(async ({ webContents }, url) => webContents.getAllWebContents().find(p => p.getURL() === url)!.executeJavaScript("document.querySelector('#text').value"), fixtureUrl)).toBe('y')
  expect((await client.callTool({ name: 'browser_hold_key', arguments: { tabId, key: 'a', durationMs: 1 } }) as CallToolResult).isError).not.toBe(true)
  expect(await electronApp.evaluate(async ({ webContents }, url) => webContents.getAllWebContents().find(p => p.getURL() === url)!.executeJavaScript("document.querySelector('#text').value"), fixtureUrl)).toBe('y')
})

test('hold duration begins after a delayed down acknowledgement', async ({ capabilities, electronApp }, testInfo) => {
  const { client, tabId, fixtureUrl } = capabilities
  await setupHoldPage(electronApp, fixtureUrl)
  await observeHold(electronApp, fixtureUrl, 'delayed-ack')
  const pending = client.callTool({ name: 'browser_hold_key', arguments: { tabId, key: 'ArrowRight', durationMs: 120 } }) as Promise<CallToolResult>
  try {
    await expect.poll(() => electronApp.evaluate(() => (globalThis as HoldScope).holdProbe!.ready)).toBe(true)
    await electronApp.evaluate(() => new Promise(resolve => setTimeout(resolve, 180)))
    const releasedAt = Date.now()
    await electronApp.evaluate(() => (globalThis as HoldScope).holdProbe!.release())
    const result = await pending
    await expect.poll(async () => (await holdObservation(electronApp)).effects?.events.length).toBe(2)
    const observed = await holdObservation(electronApp)
    expect(result.isError, text(result)).not.toBe(true)
    expect(observed.commands[1]!.at - releasedAt).toBeGreaterThanOrEqual(100)
    expect(observed.effects!.events[1]!.time - observed.effects!.events[0]!.time).toBeGreaterThanOrEqual(280)
    await testInfo.attach('delayed-down-ack', { body: JSON.stringify({ result, releasedAt, observed }), contentType: 'application/json' })
  } finally { await electronApp.evaluate(() => (globalThis as HoldScope).holdProbe?.release()); await pending.catch(() => undefined) }
})

test('strict hold wire schema rejects invalid input and permits a fresh valid hold', async ({ capabilities, electronApp }) => {
  const { client, tabId, fixtureUrl } = capabilities
  await setupHoldPage(electronApp, fixtureUrl)
  await observeHold(electronApp, fixtureUrl)
  const valid = { tabId, key: 'ArrowRight', durationMs: 10 }
  for (const input of [{ ...valid, durationMs: 0 }, { ...valid, durationMs: 5001 }, { ...valid, durationMs: 1.5 }, { ...valid, key: 'Shift' }, { ...valid, key: 'Control+a' }, { ...valid, repeat: true }, { ...valid, modifiers: 0 }, { ...valid, ref: 'ref-1' }, { key: 'ArrowRight', durationMs: 10 }]) {
    expect((await client.callTool({ name: 'browser_hold_key', arguments: input }) as CallToolResult).isError).toBe(true)
  }
  expect((await holdObservation(electronApp)).commands).toEqual([])
  expect((await client.callTool({ name: 'browser_hold_key', arguments: valid }) as CallToolResult).isError).not.toBe(true)
  expect((await holdObservation(electronApp)).commands.map(c => c.type)).toEqual(['rawKeyDown', 'keyUp'])
})
