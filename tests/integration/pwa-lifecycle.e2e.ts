import { CallToolResultSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { PwaLifecycleReport } from '../../src/shared/pwa-lifecycle.js'
import { createServer } from 'node:http'
import { test, expect, text } from './capability-fixtures.js'
import { closeFixtureServer } from './fixtures.js'

test('observes bounded worker versions and late registrations without lifecycle mutations', async ({ capabilities, electronApp, appWindow }) => {
  let version = 'A'
  let workerRequests = 0
  const server = createServer((request, response) => {
    if (request.url === '/sw.js') {
      workerRequests++
      response.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' })
      response.end(`const version=${JSON.stringify(version)};self.addEventListener('install',event=>{if(version==='C')event.waitUntil(Promise.reject(new Error('fixture install failure')))});self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));self.addEventListener('message',event=>{if(event.data==='activate')self.skipWaiting()});self.addEventListener('fetch',()=>{});`)
      return
    }
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>Worker lifecycle prototype</title><button id="focus">Focus</button><script>navigator.serviceWorker.register("/sw.js").then(()=>navigator.serviceWorker.ready).then(()=>document.title="Ready")</script>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address(); if (!address || typeof address === 'string') throw Error('Missing fixture address')
  const url = `http://127.0.0.1:${address.port}/`
  const { client, tabId } = capabilities
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await client.callTool({ name, arguments: { tabId, ...args } }) as CallToolResult
    expect(r.isError, text(r)).not.toBe(true)
    return r
  }

  try {
    await call('browser_navigate', { url })
    await expect.poll(() => electronApp.context().pages().some(p => p.url() === url)).toBe(true)
    const page = electronApp.context().pages().find(p => p.url() === url)!
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.state)).toBe('activated')
    await page.locator('#focus').focus()
    const before = await page.evaluate(() => ({ html: document.documentElement.outerHTML, focus: document.activeElement?.id, x: scrollX, y: scrollY }))
    const selectedBefore = await appWindow.evaluate('window.hronaut.getState().then(state=>state.activeTabId)')
    const beforeRequests = workerRequests
    await electronApp.evaluate(async ({ webContents }, url) => {
      const contents = webContents.getAllWebContents().find(c => c.getURL() === url)!
      await contents.executeJavaScriptInIsolatedWorld(1019, [{ code: `(() => {
        globalThis.__workerMutationAttempts = 0;
        for (const [prototype, names] of [[ServiceWorker.prototype, ['postMessage']], [ServiceWorkerRegistration.prototype, ['update', 'unregister', 'showNotification']]]) {
          for (const name of names) Object.defineProperty(prototype, name, { value() { globalThis.__workerMutationAttempts++; throw new Error('Observer mutation prohibited'); } });
        }
        return true;
      })()` }])
    }, url)
    await call('browser_pwa_lifecycle', { action: 'start' })
    expect(workerRequests).toBe(beforeRequests)
    const read = async (): Promise<PwaLifecycleReport> => JSON.parse(text(await call('browser_pwa_lifecycle', { action: 'get' })))
    const initial = await read()
    await page.evaluate(()=>navigator.serviceWorker.register('/sw.js',{scope:'/late/'}))
    await expect.poll(async()=>(await read()).events.some(e=>e.kind==='registration-discovered'&&e.scope?.endsWith('/late/'))).toBe(true)
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration('/late/'))!.unregister())
    await expect.poll(async () => (await read()).events.some(event => event.kind === 'registration-removed' && event.scope?.endsWith('/late/'))).toBe(true)
    version = 'B'
    // Fixture actions intentionally drive lifecycle; the isolated observer cannot call these APIs.
    await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration())!.update() })
    await expect.poll(async () => (await read()).events.some(e => e.worker?.state === 'installed' && e.waiting?.id === e.worker.id)).toBe(true)
    const waiting = await read()
    const oldId = initial.events.find(e => e.kind === 'initial')!.controller!.id
    const waitingId = waiting.events.find(e => e.worker?.state === 'installed' && e.waiting?.id === e.worker.id)!.worker!.id
    expect(waitingId).not.toBe(oldId)
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())!.waiting!.postMessage('activate'))
    await expect.poll(async () => (await read()).events.some(e => e.kind === 'controllerchange' && e.controller?.id === waitingId)).toBe(true)
    await expect.poll(async () => (await read()).events.some(e => e.worker?.id === waitingId && e.worker?.state === 'activated')).toBe(true)
    version = 'C'
    await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration())!.update() })
    await expect.poll(async () => (await read()).events.some(e => e.worker?.state === 'redundant' && e.worker.id !== oldId)).toBe(true)
    const final = await read()
    expect(final.active).toBe(true)
    expect(new Set(final.events.flatMap(e => e.worker ? [e.worker.scriptUrl] : [])).size).toBe(1)
    expect(await page.evaluate(() => ({ html: document.documentElement.outerHTML, focus: document.activeElement?.id, x: scrollX, y: scrollY }))).toEqual(before)
    expect(await appWindow.evaluate('window.hronaut.getState().then(state=>state.activeTabId)')).toBe(selectedBefore)
    await call('browser_pwa_lifecycle', { action: 'stop' })
    const stopped = await read()
    version = 'D'
    await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration())!.update() })
    await expect.poll(() => page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration())?.waiting))).toBe(true)
    expect((await read()).events).toEqual(stopped.events)
    expect((await read()).active).toBe(false)
    expect((await read()).missingHistory).toBe(true)
    expect((await read()).coverage).toBe('observed-only')
    expect(await electronApp.evaluate(async ({ webContents }, url) => {
      const contents = webContents.getAllWebContents().find(c => c.getURL() === url)!
      return contents.executeJavaScriptInIsolatedWorld(1019, [{ code: '({ mutations: globalThis.__workerMutationAttempts, retainedPageObserver: Boolean(globalThis.__hronautPwaLifecycle) })' }])
    }, url)).toEqual({ mutations: 0, retainedPageObserver: false })

  } finally {
    await client.callTool({ name: 'browser_pwa_lifecycle', arguments: { tabId, action: 'stop' } }).catch(() => undefined)
    await closeFixtureServer(server)
  }
})

for (const boundary of ['reload', 'navigation', 'closure', 'debugger', 'ownership', 'trusted-stop'] as const) {
  test(`retains worker evidence after ${boundary}`, async ({ capabilities, electronApp, appWindow }) => {
    const { client, tabId, fixtureUrl } = capabilities
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = await client.callTool({ name, arguments: args }) as CallToolResult
      expect(result.isError, text(result)).not.toBe(true)
      return JSON.parse(text(result))
    }
    const capture = await call('browser_pwa_lifecycle', { tabId, action: 'start' })
    expect(capture.active).toBe(true)
    expect(capture.events.length).toBeGreaterThan(0)
    await expect(appWindow.getByRole('button', { name: 'Stop observing workers', exact: true })).toBeVisible()
    let readerTabId = tabId
    if (boundary === 'closure') {
      const opened = await call('browser_new_tab', { url: fixtureUrl })
      readerTabId = opened.activeTabId
      await call('browser_close_tab', { tabId })
    } else if (boundary === 'reload') {
      await call('browser_history', { tabId, action: 'reload' })
    } else if (boundary === 'navigation') {
      await call('browser_navigate', { tabId, url: fixtureUrl + '?next=1' })
    } else if (boundary === 'debugger') {
      await electronApp.evaluate(({ webContents }, url) => {
        const contents = webContents.getAllWebContents().find(c => c.getURL() === url)!
        if (!contents.debugger.isAttached()) contents.debugger.attach('1.3')
        contents.debugger.detach()
      }, fixtureUrl)
    } else if (boundary === 'ownership') {
      const workspaceId = await appWindow.evaluate<string>(`window.hronaut.getState().then(state => state.tabs.find(tab => tab.id === ${JSON.stringify(tabId)}).mcpGroupId)`)
      await call('browser_workspaces', { action: 'release-ownership', workspaceId })
    } else {
      await appWindow.getByRole('button', { name: 'Stop observing workers', exact: true }).click()
    }
    await expect.poll(async () => (await call('browser_pwa_lifecycle', { tabId: readerTabId, captureId: capture.captureId, action: 'get' })).active).toBe(false)
    const retained = await call('browser_pwa_lifecycle', { tabId: readerTabId, captureId: capture.captureId, action: 'get' })
    expect(retained.captureId).toBe(capture.captureId)
    expect(retained.events).toEqual(capture.events)
    expect(retained.interrupted).toBe(boundary !== 'trusted-stop')
    expect(retained.missingHistory).toBe(true)
    await expect(appWindow.getByRole('button', { name: 'Stop observing workers', exact: true })).toHaveCount(0)
  })
}

test('rejects a retained capture from another authorized workspace', async ({ capabilities }) => {
  const { client, tabId, fixtureUrl } = capabilities
  const started = await client.callTool({ name: 'browser_pwa_lifecycle', arguments: { tabId, action: 'start' } }) as CallToolResult
  expect(started.isError, text(started)).not.toBe(true)
  const capture = JSON.parse(text(started)) as PwaLifecycleReport
  const created = await client.callTool({ name: 'browser_workspaces', arguments: { action: 'create', storage: 'scratch', name: 'Independent worker observer' } }) as CallToolResult
  expect(created.isError, text(created)).not.toBe(true)
  const workspaceId = (JSON.parse(text(created)) as { id: string }).id
  const opened = await client.request({ method: 'tools/call', params: { name: 'browser_new_tab', arguments: { workspaceId, url: fixtureUrl } } }, CallToolResultSchema)
  expect(opened.isError, text(opened)).not.toBe(true)
  const otherTabId = (JSON.parse(text(opened)) as { activeTabId: string }).activeTabId
  const other = await client.request({ method: 'tools/call', params: { name: 'browser_pwa_lifecycle', arguments: { workspaceId, tabId: otherTabId, action: 'start' } } }, CallToolResultSchema)
  expect(other.isError, text(other)).not.toBe(true)
  for (const action of ['get', 'stop', 'clear']) {
    const denied = await client.request({ method: 'tools/call', params: { name: 'browser_pwa_lifecycle', arguments: { workspaceId, tabId: otherTabId, captureId: capture.captureId, action } } }, CallToolResultSchema)
    expect(denied.isError).toBe(true)
    expect(text(denied)).toContain('different workspace')
  }
  const own = await client.callTool({ name: 'browser_pwa_lifecycle', arguments: { tabId, action: 'get' } }) as CallToolResult
  expect(JSON.parse(text(own))).toMatchObject({ captureId: capture.captureId, active: true })
})

test('trusted Offline panel starts, refreshes and clears worker observations', async ({ capabilities, appWindow }, testInfo) => {
  await capabilities.openPageTool('Site storage for 127.0.0.1')
  const panel = appWindow.getByRole('dialog', { name: /Site storage/ })
  await panel.getByRole('button', { name: 'Offline', exact: true }).click()
  await panel.getByRole('button', { name: 'Observe for 2 minutes', exact: true }).click()
  await expect(panel.getByRole('status')).toContainText('Observing workers')
  await expect(panel).toContainText('initial')
  await appWindow.screenshot({ path: testInfo.outputPath('pwa-lifecycle.png') })
  await panel.getByRole('button', { name: 'Stop observing workers', exact: true }).click()
  await expect(panel.getByRole('status')).toContainText('Capture stopped')
  await panel.getByRole('button', { name: 'Clear history', exact: true }).click()
  await expect(panel.getByRole('status')).toHaveCount(0)
})

test('retains evidence on explicit freeze without resuming the page', async ({ capabilities }) => {
  const { client, tabId } = capabilities
  const call = async (name: string, action: string) => {
    const result = await client.callTool({ name, arguments: { tabId, action } }) as CallToolResult
    expect(result.isError, text(result)).not.toBe(true)
    return JSON.parse(text(result))
  }
  await call('browser_pwa_lifecycle', 'start')
  try {
    await call('browser_page_lifecycle', 'freeze')
    await expect.poll(async () => (await call('browser_pwa_lifecycle', 'get')).active).toBe(false)
    expect(await call('browser_pwa_lifecycle', 'get')).toMatchObject({ interrupted: true, missingHistory: true })
    expect(await call('browser_page_lifecycle', 'status')).toMatchObject({ state: 'frozen' })
    const rejected = await client.callTool({ name: 'browser_pwa_lifecycle', arguments: { tabId, action: 'start' } }) as CallToolResult
    expect(rejected.isError).toBe(true)
    expect(text(rejected)).toContain('awake and unfrozen')
    expect(await call('browser_page_lifecycle', 'status')).toMatchObject({ state: 'frozen' })
  } finally { await call('browser_page_lifecycle', 'resume') }
})
