import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { HronautApi } from '../../src/shared/types.js'
import { test, expect, text } from './capability-fixtures.js'
import { setupHoldPage, observeHold, restoreHold, type HoldScope } from './key-hold-fixture.js'

// Electron never settles executeJavaScript once a page's renderer exits and
// holds renderer DevTools commands until the next load. Tools must settle
// instead of keeping the call, and its workspace, waiting on that renderer.
test('a held key settles when its renderer crashes during the hold', async ({ capabilities, electronApp }) => {
  const { client, tabId, fixtureUrl } = capabilities
  await setupHoldPage(electronApp, fixtureUrl)
  await observeHold(electronApp, fixtureUrl)
  const abort = new AbortController()
  let settled = false
  let result: CallToolResult | undefined
  const pending = (client.callTool({ name: 'browser_hold_key', arguments: { tabId, key: 'ArrowRight', durationMs: 4_000 } }, undefined, { signal: abort.signal, timeout: 60_000 }) as Promise<CallToolResult>)
    .then(value => { result = value }, () => undefined).finally(() => { settled = true })
  try {
    await expect.poll(() => electronApp.evaluate(() => (globalThis as HoldScope).holdProbe!.downAcknowledged)).toBe(true)
    await electronApp.evaluate(({ webContents }, url) => {
      webContents.getAllWebContents().find(page => page.getURL() === url)!.forcefullyCrashRenderer()
    }, fixtureUrl)
    await expect.poll(() => settled, { timeout: 15_000 }).toBe(true)
    expect(result, 'the call settled with a response').toBeDefined()
    expect(result!.structuredContent ?? JSON.parse(text(result!))).toMatchObject({ status: 'OUTCOME_UNKNOWN', retrySafe: false })
  } finally {
    abort.abort()
    await pending
    await restoreHold(electronApp)
  }
})

test('page tools fail at once on a crashed page and work again after it loads', async ({ capabilities, electronApp, appWindow }) => {
  const { client, tabId, fixtureUrl } = capabilities
  const call = (name: string, args: Record<string, unknown>) =>
    client.callTool({ name, arguments: { tabId, ...args } }, undefined, { timeout: 15_000 }) as Promise<CallToolResult>
  await electronApp.evaluate(async ({ webContents }, url) => {
    const page = webContents.getAllWebContents().find(candidate => candidate.getURL() === url)!
    const gone = new Promise(resolve => page.once('render-process-gone', resolve))
    page.forcefullyCrashRenderer()
    await gone
  }, fixtureUrl)

  for (const [name, args] of [['browser_snapshot', {}], ['browser_click', { x: 10, y: 10 }], ['browser_type', { selector: 'input', text: 'x' }]] as const) {
    const started = Date.now()
    const failed = await call(name, args)
    expect(failed.isError, `${name}: ${text(failed)}`).toBe(true)
    expect(text(failed), name).toContain('renderer exited')
    expect(Date.now() - started, name).toBeLessThan(5_000)
  }

  // The person can still lock and unlock the crashed page.
  const locked = (value: boolean) => appWindow.evaluate(async ([id, value]) => {
    await (window as unknown as { hronaut: HronautApi }).hronaut.setTabHumanInteractionLocked(id, value)
  }, [tabId, value] as const)
  await locked(true)
  await locked(false)

  // Loading the page again starts a new renderer, and the workspace was never left busy.
  const navigated = await call('browser_navigate', { url: fixtureUrl })
  expect(navigated.isError, text(navigated)).not.toBe(true)
  const snapshot = await call('browser_snapshot', {})
  expect(snapshot.isError, text(snapshot)).not.toBe(true)
  expect(text(snapshot)).toContain('Capability test page')
})
