import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { ElectronApplication } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import { expect, test, text } from './capability-fixtures.js'
import { closeFixtureServer } from './fixtures.js'
import type { WorkerEvaluationReport, WorkerListReport } from '../../src/shared/worker-evaluation.js'

const call = (client: Client, name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args }) as Promise<CallToolResult>

const PAGE = `<!doctype html><title>Workers</title><h1>Workers</h1>
<script>
window.marker = 'page'
window.classic = new Worker('/classic.js?token=private-worker-token')
window.module = new Worker('/module.js', { type: 'module', name: 'module-worker' })
window.blob = new Worker(URL.createObjectURL(new Blob(['self.marker = "blob"'], { type: 'text/javascript' })))
window.restartClassic = () => { window.classic.terminate(); window.classic = new Worker('/classic.js?token=private-worker-token') }
</script>
<iframe id="chosen" src="/frame"></iframe>`
const FRAME = '<!doctype html><h1>Framed sentinel</h1><script>window.framed = new Worker("/classic.js?frame=1")</script>'
// The classic worker also starts a nested worker, which is never listed.
const CLASSIC = `self.marker = new URL(location.href).searchParams.has('frame') ? 'framed' : 'classic'
self.counter = 0
if (self.marker === 'classic') self.nested = new Worker('/nested.js')`
const MODULE = 'self.marker = \'module\'; export const loaded = true'
const NESTED = 'self.marker = \'nested\''

async function site(): Promise<{ server: Server; pageUrl: string; origin: string }> {
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://fixture').pathname
    const scripts: Record<string, string> = { '/classic.js': CLASSIC, '/module.js': MODULE, '/nested.js': NESTED }
    response.setHeader('content-type', scripts[path] ? 'text/javascript' : 'text/html')
    response.end(scripts[path] ?? (path === '/frame' ? FRAME : PAGE))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  return { server, origin, pageUrl: `${origin}/app` }
}

async function workers(client: Client, tabId: string, args: { action: 'list' }): Promise<WorkerListReport>
async function workers(client: Client, tabId: string, args: { action: 'evaluate'; worker: string; script: string }): Promise<WorkerEvaluationReport>
async function workers(client: Client, tabId: string, args: Record<string, unknown>): Promise<WorkerListReport | WorkerEvaluationReport> {
  const result = await call(client, 'browser_workers', { tabId, ...args })
  expect(result.isError, text(result)).not.toBe(true)
  return JSON.parse(text(result)) as WorkerListReport | WorkerEvaluationReport
}

async function failure(client: Client, tabId: string, args: Record<string, unknown>): Promise<string> {
  const result = await call(client, 'browser_workers', { tabId, ...args })
  expect(result.isError, text(result)).toBe(true)
  return text(result)
}

/** Runs page code from the main process, outside Hronaut's debugger session. */
function run(electronApp: ElectronApplication, pageUrl: string, script: string): Promise<unknown> {
  return electronApp.evaluate(({ webContents }, { pageUrl, script }) => {
    const page = webContents.getAllWebContents().find(contents => contents.getURL() === pageUrl)
    if (!page) throw new Error(`No page at ${pageUrl}`)
    return page.mainFrame.executeJavaScript(script)
  }, { pageUrl, script })
}

/**
 * How many workers Hronaut's debugger session attaches when the page starts a new one: none once auto-attach is off
 * again. Target.getTargets cannot tell, since Playwright's own connection attaches to every worker.
 */
function attachmentsOfNewWorker(electronApp: ElectronApplication, pageUrl: string, withAutoAttach = false): Promise<number> {
  return electronApp.evaluate(async ({ webContents }, { pageUrl, withAutoAttach }) => {
    const page = webContents.getAllWebContents().find(contents => contents.getURL() === pageUrl)
    if (!page) throw new Error(`No page at ${pageUrl}`)
    let attached = 0
    const listener = (_event: unknown, method: string, _params: unknown, sessionId?: string): void => {
      if (!sessionId && method === 'Target.attachedToTarget') attached++
    }
    page.debugger.on('message', listener)
    const autoAttach = (on: boolean) => page.debugger.sendCommand('Target.setAutoAttach', {
      autoAttach: on, waitForDebuggerOnStart: false, flatten: true, ...(on ? { filter: [{ type: 'worker' }] } : {})
    })
    try {
      // The control case: with auto-attach on, the new worker is counted.
      if (withAutoAttach) await autoAttach(true)
      attached = 0
      await page.mainFrame.executeJavaScript('window.late = new Worker("/module.js", { type: "module" }); true')
      await new Promise(resolve => setTimeout(resolve, 500))
      return attached
    } finally {
      if (withAutoAttach) await autoAttach(false)
      page.debugger.removeListener('message', listener)
    }
  }, { pageUrl, withAutoAttach })
}

async function open(client: Client, tabId: string): Promise<{ server: Server; pageUrl: string; origin: string }> {
  const fixture = await site()
  const navigated = await call(client, 'browser_navigate', { tabId, url: fixture.pageUrl })
  expect(navigated.isError, text(navigated)).not.toBe(true)
  return fixture
}

/** Lists until the page's workers have all started; they load after the page does. */
async function listed(client: Client, tabId: string): Promise<WorkerListReport> {
  await expect.poll(async () => {
    const report = await workers(client, tabId, { action: 'list' })
    return [report.workers.length, report.omitted.frameWorkers, report.omitted.otherScripts]
  }, { timeout: 10_000 }).toEqual([2, 1, 1])
  return workers(client, tabId, { action: 'list' })
}

test('lists the page\'s own workers and evaluates in exactly the selected one, leaving page tools and frame reads as they were', async ({ capabilities, electronApp }) => {
  const { client, tabId } = capabilities
  const { server, pageUrl, origin } = await open(client, tabId)
  try {
    const report = await listed(client, tabId)
    expect(report).toMatchObject({ action: 'list', tabId, origin, omitted: { frameWorkers: 1, otherScripts: 1, overLimit: 0 } })
    const classic = report.workers.find(worker => worker.path === '/classic.js')!
    const module = report.workers.find(worker => worker.path === '/module.js')!
    expect(classic).toEqual({ handle: expect.any(String), path: '/classic.js' })
    expect(module).toEqual({ handle: expect.any(String), path: '/module.js', name: 'module-worker' })
    expect(text(await call(client, 'browser_workers', { tabId, action: 'list' }))).not.toContain('private-worker-token')

    const listedAgain = await workers(client, tabId, { action: 'list' })
    const classicHandle = listedAgain.workers.find(worker => worker.path === '/classic.js')!.handle
    const moduleHandle = listedAgain.workers.find(worker => worker.path === '/module.js')!.handle
    expect(await workers(client, tabId, { action: 'evaluate', worker: classicHandle, script: '[self.marker, typeof document]' }))
      .toMatchObject({ resultKind: 'json', result: ['classic', 'undefined'], worker: { path: '/classic.js' } })
    expect((await workers(client, tabId, { action: 'evaluate', worker: moduleHandle, script: 'self.marker' })).result).toBe('module')
    // State changes stay in the selected worker; a returned promise is awaited.
    expect((await workers(client, tabId, { action: 'evaluate', worker: classicHandle, script: 'self.counter = 41; Promise.resolve(self.counter + 1)' })).result).toBe(42)
    expect((await workers(client, tabId, { action: 'evaluate', worker: moduleHandle, script: 'typeof self.counter' })).result).toBe('undefined')
    expect((await workers(client, tabId, { action: 'evaluate', worker: classicHandle, script: 'self.counter' })).result).toBe(41)
    expect(await workers(client, tabId, { action: 'evaluate', worker: classicHandle, script: '"x".repeat(200000)' }))
      .toMatchObject({ resultKind: 'truncated', resultChars: 200_002, resultPreview: expect.stringMatching(/^"x+$/) })
    expect(await failure(client, tabId, { action: 'evaluate', worker: classicHandle, script: 'throw new Error("worker boom")' })).toContain('The worker script threw: Error: worker boom')

    // Page evaluation still targets the page, and nothing stays attached to the workers.
    const page = await call(client, 'browser_evaluate', { tabId, script: 'window.marker' })
    expect(text(page)).toContain('page')
    expect(await attachmentsOfNewWorker(electronApp, pageUrl)).toBe(0)
    expect(await attachmentsOfNewWorker(electronApp, pageUrl, true)).toBe(1)
    // Frame reads keep their document history: the worker sessions were no gap in it.
    const frame = await call(client, 'browser_snapshot', { tabId, frameSelector: '#chosen' })
    expect(frame.isError, text(frame)).not.toBe(true)
    expect(text(frame)).toContain('Framed sentinel')
    expect(await failure(client, tabId, { action: 'evaluate', worker: 'not-a-handle', script: '1' })).toContain('Unknown worker handle')
  } finally {
    await closeFixtureServer(server)
  }
})

test('retires handles when a worker is recreated at the same address or the page reloads, and in other tabs', async ({ capabilities, electronApp }) => {
  const { client, tabId } = capabilities
  const { server, pageUrl } = await open(client, tabId)
  try {
    let report = await listed(client, tabId)
    let classic = report.workers.find(worker => worker.path === '/classic.js')!.handle
    await run(electronApp, pageUrl, 'restartClassic(); true')
    expect(await failure(client, tabId, { action: 'evaluate', worker: classic, script: 'self.marker' })).toContain('worker behind this handle ended')

    report = await listed(client, tabId)
    classic = report.workers.find(worker => worker.path === '/classic.js')!.handle
    // The same page in another tab of the workspace has workers of its own; this tab's handle reaches none of them.
    const other = await call(client, 'browser_new_tab', { url: `${pageUrl}?tab=other` })
    expect(other.isError, text(other)).not.toBe(true)
    const otherTabId = (JSON.parse(text(other)) as { tabs: Array<{ id: string }> }).tabs.find(tab => tab.id !== tabId)!.id
    expect(await failure(client, otherTabId, { action: 'evaluate', worker: classic, script: 'self.marker' })).toContain('Unknown worker handle')
    await call(client, 'browser_close_tab', { tabId: otherTabId })

    const reloaded = await call(client, 'browser_navigate', { tabId, url: pageUrl })
    expect(reloaded.isError, text(reloaded)).not.toBe(true)
    expect(await failure(client, tabId, { action: 'evaluate', worker: classic, script: 'self.marker' })).toMatch(/handle expired|Unknown worker handle/)
  } finally {
    await closeFixtureServer(server)
  }
})

test('stops a looping script at its deadline and the worker keeps answering', async ({ capabilities, electronApp }) => {
  const { client, tabId } = capabilities
  const { server, pageUrl } = await open(client, tabId)
  try {
    const report = await listed(client, tabId)
    const classic = report.workers.find(worker => worker.path === '/classic.js')!.handle
    const result = await call(client, 'browser_workers', { tabId, action: 'evaluate', worker: classic, script: 'while (true) {}', timeoutMs: 500 })
    expect(result.isError).toBe(true)
    expect(result.structuredContent).toMatchObject({ status: 'OUTCOME_UNKNOWN', reason: 'SCRIPT_TIMEOUT', dispatch: 'dispatched', retrySafe: false })
    expect((await workers(client, tabId, { action: 'evaluate', worker: classic, script: 'self.marker' })).result).toBe('classic')
    expect(await attachmentsOfNewWorker(electronApp, pageUrl)).toBe(0)
    expect(await run(electronApp, pageUrl, 'window.marker')).toBe('page')

    // A worker that ends while its script waits settles the call at once, and Hronaut keeps running.
    const closing = await call(client, 'browser_workers', { tabId, action: 'evaluate', worker: classic, script: 'setTimeout(() => self.close(), 100); new Promise(() => {})', timeoutMs: 20_000 })
    expect(closing.structuredContent).toMatchObject({ status: 'OUTCOME_UNKNOWN', reason: 'WORKER_ENDED', dispatch: 'dispatched' })
    expect(await failure(client, tabId, { action: 'evaluate', worker: classic, script: 'self.marker' })).toContain('worker behind this handle ended')
    expect(await run(electronApp, pageUrl, 'window.marker')).toBe('page')
  } finally {
    await closeFixtureServer(server)
  }
})

test('reports a renderer exit during a script as unknown, and the reloaded page\'s workers stay unattached', async ({ capabilities, electronApp }) => {
  const { client, tabId } = capabilities
  const { server, pageUrl } = await open(client, tabId)
  try {
    const report = await listed(client, tabId)
    const classic = report.workers.find(worker => worker.path === '/classic.js')!.handle
    const pending = call(client, 'browser_workers', { tabId, action: 'evaluate', worker: classic, script: 'new Promise(() => {})', timeoutMs: 20_000 })
    // The script is waiting in the worker when the renderer goes.
    await new Promise(resolve => setTimeout(resolve, 500))
    await electronApp.evaluate(({ webContents }, pageUrl) => {
      webContents.getAllWebContents().find(contents => contents.getURL() === pageUrl)!.forcefullyCrashRenderer()
    }, pageUrl)
    const result = await pending
    expect(result.isError).toBe(true)
    expect(result.structuredContent).toMatchObject({ status: 'OUTCOME_UNKNOWN', reason: 'WORKER_ENDED', dispatch: 'dispatched' })
    const reloaded = await call(client, 'browser_navigate', { tabId, url: pageUrl })
    expect(reloaded.isError, text(reloaded)).not.toBe(true)
    const fresh = await listed(client, tabId)
    const handle = fresh.workers.find(worker => worker.path === '/classic.js')!.handle
    expect((await workers(client, tabId, { action: 'evaluate', worker: handle, script: 'self.marker' })).result).toBe('classic')
    // Auto-attach ended with the call, although the renderer was gone when it ended.
    expect(await attachmentsOfNewWorker(electronApp, pageUrl)).toBe(0)
  } finally {
    await closeFixtureServer(server)
  }
})
