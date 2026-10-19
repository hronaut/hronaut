import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { ElectronApplication } from '@playwright/test'
import { createServer } from 'node:http'
import { expect, test, text } from './capability-fixtures.js'
import { closeFixtureServer } from './fixtures.js'

const call = (client: Client, name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args }) as Promise<CallToolResult>

// Every tick runs a debugger statement first, so a page that pauses on it stops counting.
const PAGE = '<!doctype html><title>Ticks</title><script>window.state = { document: Math.random(), ticks: 0 }; setInterval(() => { debugger; window.state.ticks += 1 }, 20)</script>'

interface PageState { document: number; ticks: number }

/** The document's identity and tick count, or undefined before its script runs or when the page does not answer. */
async function pageState(electronApp: ElectronApplication, pageUrl: string): Promise<PageState | undefined> {
  return electronApp.evaluate(async ({ webContents }, pageUrl) => {
    const page = webContents.getAllWebContents().find(contents => contents.getURL() === pageUrl)
    if (!page) throw new Error(`No page at ${pageUrl}`)
    const timeout = new Promise<undefined>(resolve => setTimeout(() => resolve(undefined), 3_000))
    return Promise.race([page.mainFrame.executeJavaScript('window.state && { ...window.state }') as Promise<PageState | undefined>, timeout])
  }, pageUrl)
}

test('recording code coverage does not pause the page on a debugger statement', async ({ capabilities, electronApp }) => {
  const { client, tabId } = capabilities
  const server = createServer((_request, response) => {
    response.setHeader('content-type', 'text/html')
    response.end(PAGE)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const pageUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/ticks`
  try {
    const navigated = await call(client, 'browser_navigate', { tabId, url: pageUrl })
    expect(navigated.isError, text(navigated)).not.toBe(true)
    await expect.poll(async () => (await pageState(electronApp, pageUrl))?.ticks ?? 0, { timeout: 10_000 }).toBeGreaterThan(0)
    const before = (await pageState(electronApp, pageUrl))!.document
    const started = await call(client, 'browser_code_coverage', { tabId, action: 'start', mode: 'function', reload: true })
    expect(started.isError, text(started)).not.toBe(true)
    // Coverage starts with a reload; wait for the new document's script.
    await expect.poll(async () => { const state = await pageState(electronApp, pageUrl); return state !== undefined && state.document !== before }, { timeout: 10_000 }).toBe(true)
    // Without deactivating breakpoints, the first tick of the new document stays paused on its debugger statement.
    await expect.poll(async () => (await pageState(electronApp, pageUrl))?.ticks ?? 0, { timeout: 10_000 }).toBeGreaterThan(5)
    const stopped = await call(client, 'browser_code_coverage', { tabId, action: 'stop' })
    expect(stopped.isError, text(stopped)).not.toBe(true)
    expect(JSON.parse(text(stopped))).toMatchObject({ status: 'complete' })
  } finally {
    await call(client, 'browser_code_coverage', { tabId, action: 'clear' }).catch(() => undefined)
    await closeFixtureServer(server)
  }
})
