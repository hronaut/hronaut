import type { ElectronApplication } from '@playwright/test'
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

async function crashPage(electronApp: ElectronApplication, url: string): Promise<void> {
  await electronApp.evaluate(async ({ webContents }, url) => {
    const page = webContents.getAllWebContents().find(candidate => candidate.getURL() === url)!
    const gone = new Promise(resolve => page.once('render-process-gone', resolve))
    page.forcefullyCrashRenderer()
    await gone
  }, url)
}

test('an evaluation in flight settles when its renderer exits', async ({ capabilities, electronApp }) => {
  const { client, tabId, fixtureUrl } = capabilities
  const pending = client.callTool({ name: 'browser_evaluate', arguments: { tabId, script: '(window.__evaluating = true, new Promise(() => {}))' } }, undefined, { timeout: 15_000 }) as Promise<CallToolResult>
  await expect.poll(() => electronApp.evaluate(({ webContents }, url) =>
    webContents.getAllWebContents().find(page => page.getURL() === url)!.executeJavaScript('window.__evaluating === true'), fixtureUrl)).toBe(true)
  await crashPage(electronApp, fixtureUrl)
  const result = await pending
  expect(result.isError, text(result)).toBe(true)
  expect(text(result)).toContain('renderer exited')
})

test('page tools fail at once on a crashed page and work again after it loads', async ({ capabilities, electronApp, appWindow }) => {
  const { client, tabId, fixtureUrl } = capabilities
  const call = (name: string, args: Record<string, unknown>) =>
    client.callTool({ name, arguments: { tabId, ...args } }, undefined, { timeout: 15_000 }) as Promise<CallToolResult>
  // A request rule set before the crash still lets the page load again. Chromium has already replaced the crashed
  // frame when the request pauses, so the unit tests cover the Fetch commands sent while the page is gone.
  const routed = await call('browser_network_routes', {
    action: 'add', urlPattern: '*after-crash*',
    response: { status: 200, headers: { 'content-type': 'text/html' }, body: '<title>Routed</title><h1>Routed after crash</h1><button id="routed">Routed button</button>' }
  })
  expect(routed.isError, text(routed)).not.toBe(true)
  try {
    await crashPage(electronApp, fixtureUrl)

    // Without the guard the first three wait on the crashed renderer until the client times out, a screenshot
    // returns an image that is not the page, and printing to PDF ends the whole application.
    for (const [name, args] of [
      ['browser_snapshot', {}], ['browser_click', { x: 10, y: 10 }], ['browser_type', { selector: 'input', text: 'x' }],
      ['browser_screenshot', {}], ['browser_pdf_save', { filename: 'crashed page' }]
    ] as const) {
      const failed = await call(name, args)
      expect(failed.isError, `${name}: ${text(failed)}`).toBe(true)
      expect(text(failed), name).toContain('renderer exited')
    }
    expect(await electronApp.evaluate(({ app }) => app.isReady()), 'Hronaut is still running').toBe(true)
    // A native click reports its own outcome; nothing was pressed and nothing is left to clean up.
    const nativeClick = await call('browser_click', { selector: '#hover', native: true })
    expect(nativeClick.isError, text(nativeClick)).toBe(true)
    expect(JSON.parse(text(nativeClick))).toMatchObject({
      reason: 'TARGET_UNAVAILABLE', press: 'not-dispatched', progress: { inputCleanupFailed: false, downAttempted: 0, targetCleanup: 'confirmed' }
    })

    // The person can still lock and unlock the crashed page.
    const locked = (value: boolean) => appWindow.evaluate(async ([id, value]) => {
      await (window as unknown as { hronaut: HronautApi }).hronaut.setTabHumanInteractionLocked(id, value)
    }, [tabId, value] as const)
    await locked(true)
    await locked(false)

    // Loading the page again starts a new renderer, and the workspace was never left busy.
    const navigated = await call('browser_navigate', { url: `${fixtureUrl}&after-crash=1` })
    expect(navigated.isError, text(navigated)).not.toBe(true)
    const snapshot = await call('browser_snapshot', {})
    expect(snapshot.isError, text(snapshot)).not.toBe(true)
    expect(text(snapshot)).toContain('Routed after crash')
    const screenshot = await call('browser_screenshot', {})
    expect(screenshot.isError, text(screenshot)).not.toBe(true)
    const pdf = await call('browser_pdf_save', { filename: 'after crash' })
    expect(pdf.isError, text(pdf)).not.toBe(true)
    // The refused native click left nothing unconfirmed on the tab.
    const clicked = await call('browser_click', { selector: '#routed', native: true })
    expect(clicked.isError, text(clicked)).not.toBe(true)
  } finally {
    await call('browser_network_routes', { action: 'clear' }).catch(() => undefined)
  }
})

// A tab that is not on screen is presented offscreen and waits for a frame before a capture; a crashed page never
// presents one, so without the check that wait ran to its 15 s timeout with a misleading error.
test('captures of a crashed background tab fail at once', async ({ capabilities, electronApp }) => {
  const { client, fixtureUrl } = capabilities
  const backgroundUrl = `${fixtureUrl}&background=1`
  const opened = await client.callTool({ name: 'browser_new_tab', arguments: { url: backgroundUrl, active: false } }, undefined, { timeout: 15_000 }) as CallToolResult
  expect(opened.isError, text(opened)).not.toBe(true)
  const background = (JSON.parse(text(opened)) as { tabs: Array<{ id: string; url: string }> }).tabs.find(tab => tab.url.includes('background=1'))!
  await expect.poll(() => electronApp.evaluate(({ webContents }, url) =>
    webContents.getAllWebContents().some(page => page.getURL() === url && !page.isLoading()), backgroundUrl)).toBe(true)
  await crashPage(electronApp, backgroundUrl)
  for (const [name, args] of [['browser_screenshot', {}], ['browser_pdf_save', { filename: 'background crash' }]] as const) {
    const started = Date.now()
    const failed = await client.callTool({ name, arguments: { tabId: background.id, ...args } }, undefined, { timeout: 30_000 }) as CallToolResult
    expect(failed.isError, `${name}: ${text(failed)}`).toBe(true)
    expect(text(failed), name).toContain('renderer exited')
    expect(Date.now() - started, name).toBeLessThan(5_000)
  }
  expect(await electronApp.evaluate(({ app }) => app.isReady()), 'Hronaut is still running').toBe(true)
})
