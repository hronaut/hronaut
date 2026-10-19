import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { ElectronApplication } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import { expect, test, text } from './capability-fixtures.js'
import { closeFixtureServer } from './fixtures.js'

const AT = Date.UTC(2026, 11, 31, 23, 59, 30)
const call = (client: Client, name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args }) as Promise<CallToolResult>

// The app page reads Date in its first script, before anything renders, and
// embeds a same-origin frame, a cross-site frame, a frame it creates itself and a worker.
const appPage = (crossOrigin: string) => `<!doctype html><script>
window.startup = { now: Date.now(), made: new Date().getTime(), called: Date() }
</script><iframe id="same" src="/child"></iframe><iframe id="cross" src="${crossOrigin}/child"></iframe><script>
const made = document.createElement('iframe'); document.body.append(made); window.madeFrameNow = made.contentWindow.Date.now()
window.workerNow = new Promise(resolve => { const worker = new Worker(URL.createObjectURL(new Blob(['postMessage(Date.now())']))); worker.onmessage = event => resolve(event.data) })
</script>`

async function listen(handler: (url: string) => { location?: string; body?: string }): Promise<Server> {
  const server = createServer((request, response) => {
    const answer = handler(request.url ?? '/')
    if (answer.location) { response.writeHead(302, { location: answer.location }); response.end(); return }
    response.setHeader('content-type', 'text/html')
    response.end(answer.body ?? '')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return server
}

/** Two servers on different sites: 127.0.0.1 for the app and localhost for the cross-site frame and redirect target. */
async function sites(): Promise<{ app: string; other: string; close(): Promise<void> }> {
  let app = ''
  let other = ''
  const route = (url: string, crossOrigin: string) => url === '/app' ? { body: appPage(crossOrigin) }
    : url === '/child' ? { body: '<script>window.childNow = Date.now()</script>' }
    : url === '/redirect-same' ? { location: '/app' }
    : url === '/redirect-cross' ? { location: `${crossOrigin}/app` }
    : { body: '<p>other</p>' }
  const first = await listen(url => route(url, other))
  const second = await listen(url => route(url, app))
  app = `http://127.0.0.1:${(first.address() as { port: number }).port}`
  other = `http://localhost:${(second.address() as { port: number }).port}`
  return { app, other, close: async () => { await closeFixtureServer(first); await closeFixtureServer(second) } }
}

/** Runs a script in the main world of the tab's top-level document, or of one of its frames by URL. */
async function read(electronApp: ElectronApplication, pageUrl: string, script: string, frameUrl?: string): Promise<unknown> {
  return electronApp.evaluate(async ({ webContents }, { pageUrl, script, frameUrl }) => {
    const page = webContents.getAllWebContents().find(contents => contents.getURL() === pageUrl)
    if (!page) throw new Error(`No page at ${pageUrl}`)
    const frame = frameUrl ? page.mainFrame.framesInSubtree.find(candidate => candidate.url === frameUrl) : page.mainFrame
    if (!frame) throw new Error(`No frame at ${frameUrl}`)
    return frame.executeJavaScript(script)
  }, { pageUrl, script, frameUrl })
}

async function fixedDate(client: Client, tabId: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await call(client, 'browser_fixed_date', { tabId, ...args })
  expect(result.isError, text(result)).not.toBe(true)
  return JSON.parse(text(result)) as Record<string, unknown>
}

async function navigate(client: Client, tabId: string, url: string): Promise<void> {
  const result = await call(client, 'browser_navigate', { tabId, url })
  expect(result.isError, text(result)).not.toBe(true)
}

test('a staged fixed Date reaches the first script of the next same-origin document only, and timers keep running', async ({ capabilities, electronApp }) => {
  const { client, tabId } = capabilities
  const site = await sites()
  try {
    await navigate(client, tabId, `${site.app}/app`)
    expect(await read(electronApp, `${site.app}/app`, 'startup.now')).not.toBe(AT)
    expect(await fixedDate(client, tabId, { action: 'stage', at: '2026-12-31T23:59:30Z' })).toMatchObject({
      status: 'staged', armed: true, epochMs: AT, origin: site.app, currentDocument: 'native', reloadRequired: true
    })
    // Staging never reloads: the open document keeps the real clock.
    expect(await read(electronApp, `${site.app}/app`, 'Date.now()')).not.toBe(AT)
    await navigate(client, tabId, `${site.app}/app`)
    expect(await fixedDate(client, tabId, { action: 'status' })).toMatchObject({ status: 'active', currentDocument: 'fixed', reloadRequired: false })
    const startup = await read(electronApp, `${site.app}/app`, `({ ...startup, expected: new Date(${AT}).toString() })`) as Record<string, unknown>
    expect(startup).toMatchObject({ now: AT, made: AT, called: startup.expected })
    // Frames, a frame the page made and a worker keep the real clock.
    const real = Date.now()
    for (const value of [
      await read(electronApp, `${site.app}/app`, 'childNow', `${site.app}/child`),
      await read(electronApp, `${site.app}/app`, 'childNow', `${site.other}/child`),
      await read(electronApp, `${site.app}/app`, 'madeFrameNow'),
      await read(electronApp, `${site.app}/app`, 'workerNow')
    ]) expect(Math.abs((value as number) - real)).toBeLessThan(60_000)
    const timing = await read(electronApp, `${site.app}/app`, `(async () => {
      const start = performance.now(); await new Promise(resolve => setTimeout(resolve, 200))
      return { elapsed: performance.now() - start, now: Date.now() }
    })()`) as { elapsed: number; now: number }
    expect(timing.elapsed).toBeGreaterThanOrEqual(150)
    expect(timing.now).toBe(AT)
    // A same-origin redirect still installs it.
    await navigate(client, tabId, `${site.app}/redirect-same`)
    expect(await read(electronApp, `${site.app}/app`, 'startup.now')).toBe(AT)
  } finally { await site.close() }
})

test('a document of another origin disarms the fixed Date instead of receiving it', async ({ capabilities, electronApp }) => {
  const { client, tabId } = capabilities
  const site = await sites()
  try {
    await navigate(client, tabId, `${site.app}/app`)
    await fixedDate(client, tabId, { action: 'stage', epochMs: AT })
    await navigate(client, tabId, `${site.app}/redirect-cross`)
    expect(await read(electronApp, `${site.other}/app`, 'startup.now')).not.toBe(AT)
    expect(await fixedDate(client, tabId, { action: 'status' })).toMatchObject({
      status: 'disarmed', armed: false, origin: site.app, currentDocument: 'native', reloadRequired: false, disarmedReason: 'origin-changed'
    })
    await navigate(client, tabId, `${site.app}/app`)
    expect(await read(electronApp, `${site.app}/app`, 'startup.now')).not.toBe(AT)
  } finally { await site.close() }
})

test('human input on the page after staging disarms the fixed Date', async ({ capabilities, electronApp }) => {
  const { client, tabId } = capabilities
  const site = await sites()
  try {
    await navigate(client, tabId, `${site.app}/app`)
    await fixedDate(client, tabId, { action: 'stage', epochMs: AT })
    await electronApp.evaluate(({ webContents }, pageUrl) => {
      const page = webContents.getAllWebContents().find(contents => contents.getURL() === pageUrl)!
      page.sendInputEvent({ type: 'mouseDown', x: 5, y: 5, button: 'left', clickCount: 1 })
      page.sendInputEvent({ type: 'mouseUp', x: 5, y: 5, button: 'left', clickCount: 1 })
    }, `${site.app}/app`)
    await navigate(client, tabId, `${site.app}/app`)
    expect(await read(electronApp, `${site.app}/app`, 'startup.now')).not.toBe(AT)
    expect(await fixedDate(client, tabId, { action: 'status' })).toMatchObject({ status: 'disarmed', currentDocument: 'native', disarmedReason: 'authority-changed' })
  } finally { await site.close() }
})

test('reset leaves the fixed Date in the open document until it reloads', async ({ capabilities, electronApp }) => {
  const { client, tabId } = capabilities
  const site = await sites()
  try {
    await navigate(client, tabId, `${site.app}/app`)
    expect(await fixedDate(client, tabId, { action: 'status' })).toEqual({ status: 'off', armed: false, currentDocument: 'native', reloadRequired: false })
    await fixedDate(client, tabId, { action: 'stage', epochMs: AT })
    await navigate(client, tabId, `${site.app}/app`)
    expect(await fixedDate(client, tabId, { action: 'reset' })).toMatchObject({ status: 'reset-reload-required', armed: false, currentDocument: 'fixed', reloadRequired: true })
    expect(await read(electronApp, `${site.app}/app`, 'Date.now()')).toBe(AT)
    await navigate(client, tabId, `${site.app}/app`)
    expect(await read(electronApp, `${site.app}/app`, 'startup.now')).not.toBe(AT)
    expect(await fixedDate(client, tabId, { action: 'status' })).toEqual({ status: 'off', armed: false, currentDocument: 'native', reloadRequired: false })
  } finally { await site.close() }
})

test('time zone emulation applies to the fixed instant across midnight and a daylight-saving change', async ({ capabilities, electronApp }) => {
  const { client, tabId } = capabilities
  const site = await sites()
  try {
    await navigate(client, tabId, `${site.app}/app`)
    const emulated = await call(client, 'browser_emulate', { tabId, timezoneId: 'America/New_York' })
    expect(emulated.isError, text(emulated)).not.toBe(true)
    const local = async (at: string) => {
      await fixedDate(client, tabId, { action: 'stage', at })
      await navigate(client, tabId, `${site.app}/app`)
      return read(electronApp, `${site.app}/app`, '(() => { const now = new Date(); return [now.getDate(), now.getHours(), now.getTimezoneOffset()] })()')
    }
    // New York's daylight saving ends at 06:00 UTC on November 1, 2026.
    expect(await local('2026-11-01T05:59:59Z')).toEqual([1, 1, 240])
    expect(await local('2026-11-01T06:00:00Z')).toEqual([1, 1, 300])
    expect(await local('2027-01-01T04:59:59Z')).toEqual([31, 23, 300])
    expect(await local('2027-01-01T00:00:00-05:00')).toEqual([1, 0, 300])
  } finally { await site.close() }
})

test('staging needs a valid instant and an HTTP(S) page', async ({ capabilities }) => {
  const { client, tabId } = capabilities
  for (const args of [{ at: '2026-12-31' }, { at: '2026-12-31T23:59:30' }, { at: '2026-12-31T23:59:30Z', epochMs: AT }, {}, { epochMs: 8.64e15 + 1 }]) {
    const refused = await call(client, 'browser_fixed_date', { tabId, action: 'stage', ...args })
    expect(refused.isError, JSON.stringify(args)).toBe(true)
  }
  await navigate(client, tabId, 'about:blank')
  const blank = await call(client, 'browser_fixed_date', { tabId, action: 'stage', epochMs: AT })
  expect(blank.isError).toBe(true)
  expect(text(blank)).toContain('Open an HTTP(S) page')
  expect(await fixedDate(client, tabId, { action: 'status' })).toEqual({ status: 'off', armed: false, currentDocument: 'native', reloadRequired: false })
})
