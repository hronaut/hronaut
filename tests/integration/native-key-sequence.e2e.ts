import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { HronautApi } from '../../src/shared/types.js'
import { test, expect, text } from './capability-fixtures.js'
import { setupHoldPage, observeHold, holdObservation, restoreHold, type HoldScope } from './key-hold-fixture.js'

test.afterEach(async ({ electronApp }) => restoreHold(electronApp))

const DASH_JUMP = [
  { atMs: 0, type: 'down', key: 'ArrowRight' },
  { atMs: 60, type: 'down', key: 'Shift' },
  { atMs: 60, type: 'down', key: 'Space' },
  { atMs: 140, type: 'up', key: 'Space' },
  { atMs: 220, type: 'up', key: 'Shift' },
  { atMs: 320, type: 'up', key: 'ArrowRight' }
]

async function recordShift(electronApp: Parameters<typeof setupHoldPage>[0], url: string): Promise<void> {
  await electronApp.evaluate(async ({ webContents }, url) => webContents.getAllWebContents().find(p => p.getURL() === url)!.executeJavaScript(
    "window.shiftSeen=[];for(const type of ['keydown','keyup'])document.addEventListener(type,e=>window.shiftSeen.push([type,e.key,e.shiftKey]));void 0"), url)
}

async function shiftSeen(electronApp: Parameters<typeof setupHoldPage>[0], url: string): Promise<Array<[string, string, boolean]>> {
  return electronApp.evaluate(async ({ webContents }, url) => webContents.getAllWebContents().find(p => p.getURL() === url)!.executeJavaScript('window.shiftSeen'), url)
}

for (const locked of [false, true]) test(`key sequence plays a timed Shift chord and releases every key with lock ${locked}`, async ({ capabilities, electronApp, appWindow }, testInfo) => {
  const { client, tabId, fixtureUrl } = capabilities
  await setupHoldPage(electronApp, fixtureUrl)
  await recordShift(electronApp, fixtureUrl)
  await appWindow.evaluate(({ id, locked }) => (window as unknown as { hronaut: HronautApi }).hronaut.setTabHumanInteractionLocked(id, locked), { id: tabId, locked })
  await observeHold(electronApp, fixtureUrl)
  const result = await client.callTool({ name: 'browser_key_sequence', arguments: { tabId, events: DASH_JUMP } }) as CallToolResult
  await expect.poll(async () => (await holdObservation(electronApp)).effects?.events.length).toBe(6)
  const observed = await holdObservation(electronApp)
  const seen = await shiftSeen(electronApp, fixtureUrl)
  await testInfo.attach('native-key-sequence', { body: JSON.stringify({ locked, result, observed, seen }), contentType: 'application/json' })
  expect(result.isError, text(result)).not.toBe(true)
  const outcome = JSON.parse(text(result))
  expect(outcome).toMatchObject({ status: 'DISPATCH_ACKNOWLEDGED', events: 6, release: 'ACKNOWLEDGED' })
  expect(outcome.sentAtMs).toHaveLength(6)
  expect(Math.abs(outcome.startEpochMs - Date.now())).toBeLessThan(10_000)
  outcome.sentAtMs.forEach((sent: number, index: number) => expect(sent).toBeGreaterThanOrEqual(DASH_JUMP[index]!.atMs))
  expect(observed.commands.map(c => [c.type, c.key, c.params.modifiers])).toEqual([
    ['rawKeyDown', 'ArrowRight', 0], ['rawKeyDown', 'Shift', 8], ['rawKeyDown', ' ', 8], ['keyUp', ' ', 8], ['keyUp', 'Shift', 0], ['keyUp', 'ArrowRight', 0]
  ])
  expect(observed.commands.every(c => c.params.text === undefined && c.params.autoRepeat === undefined)).toBe(true)
  expect(seen).toEqual([
    ['keydown', 'ArrowRight', false], ['keydown', 'Shift', true], ['keydown', ' ', true], ['keyup', ' ', true], ['keyup', 'Shift', false], ['keyup', 'ArrowRight', false]
  ])
  expect(observed.effects!.events.every(e => e.trusted && !e.repeat)).toBe(true)
  const times = observed.effects!.events.map(e => e.time)
  expect(times[5]! - times[0]!).toBeGreaterThanOrEqual(300)
  expect(times[5]! - times[0]!).toBeLessThan(2300) // Observed tolerance, not a product deadline.
  expect(observed.effects!.held).toBe(false)
  // After confirmed release, holds and sequences stay available on the page.
  expect((await client.callTool({ name: 'browser_hold_key', arguments: { tabId, key: 'a', durationMs: 1 } }) as CallToolResult).isError).not.toBe(true)
  expect((await client.callTool({ name: 'browser_key_sequence', arguments: { tabId, events: [{ atMs: 0, type: 'down', key: 'e' }, { atMs: 10, type: 'up', key: 'e' }] } }) as CallToolResult).isError).not.toBe(true)
})

test('key sequence takes key codes and keeps its gaps after a slow first key, as a game starting its run', async ({ capabilities, electronApp }, testInfo) => {
  const { client, tabId, fixtureUrl } = capabilities
  await setupHoldPage(electronApp, fixtureUrl)
  // The first keydown handler runs for 400 ms, so that key's acknowledgement is late and the events due meanwhile wait.
  await electronApp.evaluate(async ({ webContents }, url) => webContents.getAllWebContents().find(p => p.getURL() === url)!.executeJavaScript(
    'window.codesSeen=[];for(const type of ["keydown","keyup"])document.addEventListener(type,e=>{window.codesSeen.push([type,e.code,e.location,e.shiftKey,performance.now()]);'
    + 'if(!window.slowStart){window.slowStart=true;const t=performance.now();while(performance.now()-t<400);}});void 0'), fixtureUrl)
  await observeHold(electronApp, fixtureUrl)
  const events = [
    { atMs: 0, type: 'down', key: 'KeyD' }, { atMs: 200, type: 'up', key: 'KeyD' },
    { atMs: 300, type: 'down', key: 'ShiftRight' }, { atMs: 300, type: 'down', key: 'Digit1' },
    { atMs: 400, type: 'up', key: 'Digit1' }, { atMs: 500, type: 'up', key: 'ShiftRight' }
  ]
  const result = await client.callTool({ name: 'browser_key_sequence', arguments: { tabId, events } }) as CallToolResult
  await expect.poll(async () => (await holdObservation(electronApp)).effects?.events.length).toBe(6)
  const observed = await holdObservation(electronApp)
  const seen = await electronApp.evaluate(async ({ webContents }, url) => webContents.getAllWebContents().find(p => p.getURL() === url)!
    .executeJavaScript('window.codesSeen'), fixtureUrl) as Array<[string, string, number, boolean, number]>
  await testInfo.attach('native-key-sequence-codes', { body: JSON.stringify({ result, observed, seen }), contentType: 'application/json' })
  expect(result.isError, text(result)).not.toBe(true)
  const outcome = JSON.parse(text(result))
  expect(outcome).toMatchObject({ status: 'DISPATCH_ACKNOWLEDGED', events: 6, release: 'ACKNOWLEDGED' })
  expect(outcome.scheduleShiftMs).toBeGreaterThanOrEqual(350)
  expect(seen.map(([type, code, location, shift]) => [type, code, location, shift])).toEqual([
    ['keydown', 'KeyD', 0, false], ['keyup', 'KeyD', 0, false], ['keydown', 'ShiftRight', 2, true],
    ['keydown', 'Digit1', 0, true], ['keyup', 'Digit1', 0, true], ['keyup', 'ShiftRight', 2, false]
  ])
  const at = seen.map(entry => entry[4])
  // Without the moved schedule, the up due at 200 ms and the events after it arrive together when the slow key returns.
  expect(at[1]! - at[0]!).toBeGreaterThanOrEqual(580)
  expect(at[2]! - at[1]!).toBeGreaterThanOrEqual(90)
  expect(at[4]! - at[3]!).toBeGreaterThanOrEqual(90)
  expect(at[5]! - at[4]!).toBeGreaterThanOrEqual(90)
  expect(observed.effects!.held).toBe(false)
})

for (const change of ['pause', 'tab-lock'] as const) test(`key sequence stops on ${change} and releases held keys once`, async ({ capabilities, electronApp, appWindow }, testInfo) => {
  const { client, tabId, fixtureUrl } = capabilities
  await setupHoldPage(electronApp, fixtureUrl)
  await observeHold(electronApp, fixtureUrl)
  const pending = client.callTool({ name: 'browser_key_sequence', arguments: { tabId, events: [
    { atMs: 0, type: 'down', key: 'Shift' }, { atMs: 0, type: 'down', key: 'ArrowRight' },
    { atMs: 4000, type: 'up', key: 'ArrowRight' }, { atMs: 4000, type: 'up', key: 'Shift' }
  ] } }) as Promise<CallToolResult>
  try {
    await expect.poll(async () => (await holdObservation(electronApp)).commands.length).toBe(2)
    const triggeredAt = Date.now()
    if (change === 'pause') await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.setTabAgentPaused(id, true), tabId)
    else await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.setTabHumanInteractionLocked(id, true), tabId)
    const result = await pending
    const observed = await holdObservation(electronApp)
    await testInfo.attach('native-key-sequence-stop', { body: JSON.stringify({ change, result, observed }), contentType: 'application/json' })
    expect(Date.now() - triggeredAt).toBeLessThan(3000)
    expect(result.isError).toBe(true)
    expect(JSON.parse(text(result))).toMatchObject({ status: 'OUTCOME_UNKNOWN', retrySafe: false, release: 'ACKNOWLEDGED' })
    expect(observed.commands.map(c => [c.type, c.key, c.params.modifiers])).toEqual([
      ['rawKeyDown', 'Shift', 8], ['rawKeyDown', 'ArrowRight', 8], ['keyUp', 'ArrowRight', 8], ['keyUp', 'Shift', 0]
    ])
    await expect.poll(async () => (await holdObservation(electronApp)).effects?.held).toBe(false)
  } finally {
    await electronApp.evaluate(() => (globalThis as HoldScope).holdProbe?.release())
    await pending.catch(() => undefined)
    await appWindow.evaluate(id => {
      const api = (window as unknown as { hronaut: HronautApi }).hronaut
      return Promise.all([api.setTabAgentPaused(id, false), api.setTabHumanInteractionLocked(id, false)])
    }, tabId)
  }
})

test('strict sequence wire schema rejects invalid input before any key', async ({ capabilities, electronApp }) => {
  const { client, tabId, fixtureUrl } = capabilities
  await setupHoldPage(electronApp, fixtureUrl)
  await observeHold(electronApp, fixtureUrl)
  for (const events of [[], [{ atMs: 0, type: 'down', key: 'a' }], [{ atMs: 0, type: 'down', key: 'Control' }, { atMs: 1, type: 'up', key: 'Control' }],
    [{ atMs: 5, type: 'down', key: 'a' }, { atMs: 1, type: 'up', key: 'a' }], [{ atMs: 0, type: 'down', key: 'Insert' }, { atMs: 1, type: 'up', key: 'Insert' }]]) {
    expect((await client.callTool({ name: 'browser_key_sequence', arguments: { tabId, events } }) as CallToolResult).isError).toBe(true)
  }
  expect((await holdObservation(electronApp)).commands).toEqual([])
})
