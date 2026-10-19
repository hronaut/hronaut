import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { ElectronApplication, Page } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import { expect, test, text } from './capability-fixtures.js'
import { closeFixtureServer } from './fixtures.js'
import type { DomMutationSourceReport } from '../../src/shared/dom-mutation-source.js'

const call = (client: Client, name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args }) as Promise<CallToolResult>

const PAGE = `<!doctype html><title>Orders</title>
<button id="save">Save</button><div id="panel"><p>a</p></div><div id="dialog">Dialog</div><div id="other">Other</div>
<script src="/app.js?token=private-script-token"></script>`

// Line numbers matter: the captures name these functions at these 1-based lines.
const APP = [
  'window.beats = 0; setInterval(() => { window.beats += 1 }, 20)',
  'function disableSave() { document.getElementById(\'save\').setAttribute(\'disabled\', \'private-attribute-value\' + Math.random()) }',
  'function replacePanel() { document.getElementById(\'panel\').innerHTML = \'<p>private-markup</p>\' }',
  'function closeDialog() { document.getElementById(\'dialog\').remove() }',
  'function touchOther() { document.getElementById(\'other\').setAttribute(\'data-x\', \'1\') }',
  'function replaceSave() { const next = document.createElement(\'button\'); next.id = \'save\'; document.getElementById(\'save\').replaceWith(next) }',
  'function hitDebugger() { debugger; window.afterDebugger = (window.afterDebugger || 0) + 1 }',
  'function later(name) { setTimeout(function scheduled() { window[name]() }, 10) }'
].join('\n')

async function site(): Promise<{ server: Server; pageUrl: string }> {
  const server = createServer((request, response) => {
    const script = request.url?.startsWith('/app.js')
    response.setHeader('content-type', script ? 'text/javascript' : 'text/html')
    response.end(script ? APP : PAGE)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return { server, pageUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/orders?token=private-page-token` }
}

async function source(client: Client, tabId: string, args: Record<string, unknown>): Promise<DomMutationSourceReport> {
  const result = await call(client, 'browser_dom_mutation_source', { tabId, ...args })
  expect(result.isError, text(result)).not.toBe(true)
  return JSON.parse(text(result)) as DomMutationSourceReport
}

/** Runs page code from the main process, outside Hronaut's debugger session. */
async function run(electronApp: ElectronApplication, pageUrl: string, script: string): Promise<unknown> {
  return electronApp.evaluate(async ({ webContents }, { pageUrl, script }) => {
    const page = webContents.getAllWebContents().find(contents => contents.getURL() === pageUrl)
    if (!page) throw new Error(`No page at ${pageUrl}`)
    const timeout = new Promise(resolve => setTimeout(() => resolve('timeout'), 3_000))
    return Promise.race([page.mainFrame.executeJavaScript(script), timeout])
  }, { pageUrl, script })
}

/** The page keeps running: its 20 ms heartbeat advances. */
async function expectRunning(electronApp: ElectronApplication, pageUrl: string): Promise<void> {
  const before = await run(electronApp, pageUrl, 'window.beats') as number
  await expect.poll(async () => (await run(electronApp, pageUrl, 'window.beats') as number) - before, { timeout: 5_000 }).toBeGreaterThan(5)
}

async function ended(client: Client, tabId: string): Promise<DomMutationSourceReport> {
  await expect.poll(async () => (await source(client, tabId, { action: 'get' })).status, { timeout: 5_000 }).not.toBe('armed')
  return source(client, tabId, { action: 'get' })
}

async function open(client: Client, tabId: string): Promise<{ server: Server; pageUrl: string }> {
  const fixture = await site()
  const navigated = await call(client, 'browser_navigate', { tabId, url: fixture.pageUrl })
  expect(navigated.isError, text(navigated)).not.toBe(true)
  return fixture
}

test('captures the function behind an attribute change, a subtree change and a removal, and the page keeps running', async ({ capabilities, electronApp }) => {
  const { client, tabId } = capabilities
  const { server, pageUrl } = await open(client, tabId)
  try {
    const origin = new URL(pageUrl).origin
    const cases = [
      { selector: '#save', kind: 'attribute-modified', trigger: 'disableSave', change: 'attribute', line: 2 },
      { selector: '#panel', kind: 'subtree-modified', trigger: 'replacePanel', change: expect.stringMatching(/^child-(inserted|removed)$/), line: 3 },
      { selector: '#dialog', kind: 'node-removed', trigger: 'closeDialog', change: 'node-removed', line: 4 }
    ]
    for (const { selector, kind, trigger, change, line } of cases) {
      expect(await source(client, tabId, { action: 'arm', selector, kind })).toMatchObject({ status: 'armed', armed: { selector, kind } })
      // A change to an unrelated element does not complete the capture.
      await run(electronApp, pageUrl, 'touchOther()')
      expect(await source(client, tabId, { action: 'get' })).toMatchObject({ status: 'armed' })
      await run(electronApp, pageUrl, `later(${JSON.stringify(trigger)})`)
      const report = await ended(client, tabId)
      expect(report).toMatchObject({ status: 'captured', ended: { reason: 'captured', selector, kind }, capture: { kind, change } })
      const frames = report.capture!.frames
      expect(frames[0]).toEqual({ functionName: trigger, url: `${origin}/app.js?token=%5BREDACTED%5D`, lineNumber: line, columnNumber: expect.any(Number) })
      expect(frames[1]).toMatchObject({ functionName: 'scheduled', lineNumber: 8 })
      expect(frames).toContainEqual(expect.objectContaining({ functionName: 'later', asyncBoundary: 'setTimeout' }))
      expect(JSON.stringify(report)).not.toMatch(/private-(script-token|page-token|attribute-value|markup)/)
      await expectRunning(electronApp, pageUrl)
    }
    // Only the first change is kept: after a capture, a later change of the same element is not attributed.
    expect(await source(client, tabId, { action: 'arm', selector: '#save', kind: 'attribute-modified' })).toMatchObject({ status: 'armed' })
    await run(electronApp, pageUrl, 'disableSave(); later("disableSave")')
    const first = await ended(client, tabId)
    expect(first.capture!.frames[0]).toMatchObject({ functionName: 'disableSave', lineNumber: 2 })
    expect(first.capture!.frames[1]).not.toMatchObject({ functionName: 'scheduled' })
  } finally {
    await source(client, tabId, { action: 'cancel' }).catch(() => undefined)
    await closeFixtureServer(server)
  }
})

test('a debugger statement does not freeze the page while armed, and cancel and expiry remove the breakpoint', async ({ capabilities, electronApp }) => {
  const { client, tabId } = capabilities
  const { server, pageUrl } = await open(client, tabId)
  try {
    await source(client, tabId, { action: 'arm', selector: '#save', kind: 'attribute-modified' })
    await run(electronApp, pageUrl, 'later("hitDebugger")')
    await expect.poll(() => run(electronApp, pageUrl, 'window.afterDebugger'), { timeout: 5_000 }).toBe(1)
    await expectRunning(electronApp, pageUrl)
    expect(await source(client, tabId, { action: 'get' })).toMatchObject({ status: 'armed' })
    expect(await source(client, tabId, { action: 'cancel' })).toMatchObject({ status: 'cancelled', ended: { reason: 'cancelled' } })
    await run(electronApp, pageUrl, 'disableSave()')
    expect(await source(client, tabId, { action: 'get' })).toMatchObject({ status: 'cancelled' })
    await source(client, tabId, { action: 'arm', selector: '#panel', kind: 'subtree-modified', durationMs: 1_000 })
    expect(await ended(client, tabId)).toMatchObject({ status: 'expired', ended: { reason: 'expired' } })
    await run(electronApp, pageUrl, 'replacePanel(); hitDebugger()')
    expect(await run(electronApp, pageUrl, 'window.afterDebugger')).toBe(2)
    expect(await source(client, tabId, { action: 'get' })).toMatchObject({ status: 'expired' })
    await expectRunning(electronApp, pageUrl)
  } finally {
    await source(client, tabId, { action: 'cancel' }).catch(() => undefined)
    await closeFixtureServer(server)
  }
})

test('a replaced element, a navigation and a person clicking the page invalidate the capture', async ({ capabilities, electronApp }) => {
  const { client, tabId } = capabilities
  const { server, pageUrl } = await open(client, tabId)
  try {
    await source(client, tabId, { action: 'arm', selector: '#save', kind: 'attribute-modified' })
    await run(electronApp, pageUrl, 'replaceSave()')
    expect(await ended(client, tabId)).toMatchObject({ status: 'invalidated', ended: { reason: 'target-removed' } })
    // The replacement matches the same selector but is never captured.
    await run(electronApp, pageUrl, 'disableSave()')
    expect(await source(client, tabId, { action: 'get' })).not.toHaveProperty('capture')

    await source(client, tabId, { action: 'arm', selector: '#panel', kind: 'subtree-modified' })
    await call(client, 'browser_navigate', { tabId, url: pageUrl.replace('/orders', '/other') })
    expect(await ended(client, tabId)).toMatchObject({ status: 'invalidated', ended: { reason: 'navigation' } })

    const otherUrl = pageUrl.replace('/orders', '/other')
    await source(client, tabId, { action: 'arm', selector: '#panel', kind: 'subtree-modified' })
    await electronApp.evaluate(({ webContents }, pageUrl) => {
      const page = webContents.getAllWebContents().find(contents => contents.getURL() === pageUrl)!
      page.sendInputEvent({ type: 'mouseDown', x: 5, y: 5, button: 'left', clickCount: 1 })
      page.sendInputEvent({ type: 'mouseUp', x: 5, y: 5, button: 'left', clickCount: 1 })
    }, otherUrl)
    expect(await ended(client, tabId)).toMatchObject({ status: 'invalidated', ended: { reason: 'authority-changed' } })
  } finally {
    await source(client, tabId, { action: 'cancel' }).catch(() => undefined)
    await closeFixtureServer(server)
  }
})

test('refuses to share the debugger with code coverage, a CSS state preview or Developer Tools', async ({ capabilities, electronApp, appWindow }) => {
  const { client, tabId } = capabilities
  const { server, pageUrl } = await open(client, tabId)
  try {
    const coverage = await call(client, 'browser_code_coverage', { tabId, action: 'start', mode: 'function', reload: false })
    expect(coverage.isError, text(coverage)).not.toBe(true)
    const refused = await call(client, 'browser_dom_mutation_source', { tabId, action: 'arm', selector: '#save', kind: 'attribute-modified' })
    expect(refused.isError).toBe(true)
    expect(text(refused)).toContain('Stop code coverage')
    await call(client, 'browser_code_coverage', { tabId, action: 'clear' })

    await source(client, tabId, { action: 'arm', selector: '#save', kind: 'attribute-modified' })
    const coverageRefused = await call(client, 'browser_code_coverage', { tabId, action: 'start', reload: false })
    expect(coverageRefused.isError).toBe(true)
    expect(text(coverageRefused)).toContain('Cancel the DOM mutation source capture')
    const previewRefused = await call(client, 'browser_css_state_preview', { tabId, action: 'set', selector: '#other', states: ['hover'] })
    expect(previewRefused.isError).toBe(true)
    expect(text(previewRefused)).toContain('Cancel the DOM mutation source capture')

    await toggleDevTools(appWindow, tabId, true)
    expect(await ended(client, tabId)).toMatchObject({ status: 'invalidated', ended: { reason: 'devtools-opened' } })
    const whileOpen = await call(client, 'browser_dom_mutation_source', { tabId, action: 'arm', selector: '#save', kind: 'attribute-modified' })
    expect(whileOpen.isError).toBe(true)
    expect(text(whileOpen)).toContain('Developer Tools')
    await toggleDevTools(appWindow, tabId, false)
    await expectRunning(electronApp, pageUrl)
  } finally {
    await source(client, tabId, { action: 'cancel' }).catch(() => undefined)
    await call(client, 'browser_code_coverage', { tabId, action: 'clear' }).catch(() => undefined)
    await closeFixtureServer(server)
  }
})

async function toggleDevTools(appWindow: Page, tabId: string, opened: boolean): Promise<void> {
  expect(await appWindow.evaluate(`window.hronaut.toggleDevTools(${JSON.stringify(tabId)})`)).toBe(opened)
}
