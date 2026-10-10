import { createServer } from 'node:http'
import type { BrowserState, HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

test.use({ trace: { mode: process.env.CI ? 'retain-on-failure' : 'off', screenshots: false } })

for (const scenario of [
  { ignoreCache: false, delayedExit: false },
  { ignoreCache: true, delayedExit: false },
  { ignoreCache: false, delayedExit: true }
]) {
  test(`loads a live replacement after unresponsive recovery (cache bypass: ${scenario.ignoreCache}, delayed exit: ${scenario.delayedExit})`, async ({ appWindow, electronApp }, testInfo) => {
    const requests: Array<{ cacheControl?: string; pragma?: string }> = []
    const server = createServer((request, response) => {
      if (request.url === '/recovery') requests.push({ cacheControl: request.headers['cache-control'], pragma: request.headers.pragma })
      response.writeHead(200, { 'content-type': 'text/html' })
      response.end('<!doctype html><title>Recovery fixture</title><main>Live replacement</main>')
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    let stoppedPid = 0
    try {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Missing fixture address')
      const url = `http://127.0.0.1:${address.port}/recovery`
      const tabId = await appWindow.evaluate(async url => {
        const state = await (window as unknown as { hronaut: HronautApi }).hronaut.newTab({ url, active: true })
        return state.activeTabId!
      }, url)
      await expect.poll(() => electronApp.context().pages().some(page => page.url() === url)).toBe(true)
      await expect(electronApp.context().pages().find(page => page.url() === url)!.locator('main')).toHaveText('Live replacement')
      const original = await electronApp.evaluate(({ webContents }, { url, delayedExit }) => {
        const page = webContents.getAllWebContents().find(page => page.getURL() === url)!
        const pid = page.getOSProcessId()
        if (pid <= 0) throw new Error('Missing fixture process')
        if (delayedExit) process.kill(pid, 'SIGSTOP')
        page.emit('unresponsive')
        return { pid, history: page.navigationHistory.getAllEntries().map(entry => entry.url), index: page.navigationHistory.getActiveIndex() }
      }, { url, delayedExit: scenario.delayedExit })
      const originalPid = original.pid
      if (scenario.delayedExit) stoppedPid = originalPid
      const recovery = appWindow.evaluate(async ({ tabId, ignoreCache }) => {
        const api = (window as unknown as { hronaut: HronautApi }).hronaut
        return ignoreCache ? api.reloadIgnoringCache(tabId) : api.reload(tabId)
      }, { tabId, ignoreCache: scenario.ignoreCache }).then(
        state => ({ state, error: null }),
        error => ({ state: null, error: String(error) })
      )
      if (scenario.delayedExit) {
        // Cross the former suppression deadline while the fixture process is
        // stopped. This controls termination latency, not assertion readiness.
        await new Promise(resolve => setTimeout(resolve, 5500))
        await electronApp.evaluate((_electron, pid) => process.kill(pid, 'SIGCONT'), stoppedPid)
        stoppedPid = 0
      }
      const result = await recovery
      expect(result.error).toBeNull()
      const tab = (result.state as BrowserState).tabs.find(tab => tab.id === tabId)!
      expect(tab).toMatchObject({ loading: false, title: 'Recovery fixture' })
      expect(tab.pageProblem).toBeUndefined()
      const native = await electronApp.evaluate(({ webContents }, url) => {
        const page = webContents.getAllWebContents().find(page => page.getURL() === url)!
        return { pid: page.getOSProcessId(), loading: page.isLoading(), crashed: page.isCrashed(),
          history: page.navigationHistory.getAllEntries().map(entry => entry.url), index: page.navigationHistory.getActiveIndex() }
      }, url)
      await testInfo.attach('replacement-process-state', { body: JSON.stringify({ originalPid, ...native }), contentType: 'application/json' })
      expect(native).toMatchObject({ loading: false, crashed: false })
      expect(native.pid).toBeGreaterThan(0)
      expect(native.pid).not.toBe(originalPid)
      expect(native.history).toEqual(original.history)
      expect(native.index).toBe(original.index)
      if (scenario.ignoreCache) expect(requests.at(-1)).toEqual({ cacheControl: 'no-cache', pragma: 'no-cache' })
      // Playwright may retain the crashed target handle; read the current native
      // renderer after verifying its distinct live PID and completed loading.
      expect(await electronApp.evaluate(async ({ webContents }, url) => {
        const page = webContents.getAllWebContents().find(page => page.getURL() === url)!
        return page.executeJavaScript('document.querySelector("main")?.textContent')
      }, url)).toBe('Live replacement')
      // The expected exit must not hide a crash of the replacement process.
      await electronApp.evaluate((_electron, pid) => process.kill(pid, 'SIGKILL'), native.pid)
      await expect.poll(() => appWindow.evaluate(async tabId => {
        const state = await (window as unknown as { hronaut: HronautApi }).hronaut.getState()
        return state.tabs.find(tab => tab.id === tabId)?.pageProblem?.kind
      }, tabId)).toBe('renderer-gone')
    } finally {
      if (stoppedPid > 0) await electronApp.evaluate((_electron, pid) => {
        try { process.kill(pid, 'SIGCONT') } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
        }
      }, stoppedPid)
      await closeFixtureServer(server)
    }
  })
}

for (const action of ['close', 'navigate'] as const) {
  test(`does not reload obsolete content after ${action} interrupts renderer recovery`, async ({ appWindow, electronApp }) => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html' })
      response.end('<!doctype html><title>Recovery interruption</title><main>Ready</main>')
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Missing fixture address')
      const url = `http://127.0.0.1:${address.port}/initial`
      const tabId = await appWindow.evaluate(async url => (
        (window as unknown as { hronaut: HronautApi }).hronaut.newTab({ url, active: true })
      ).then(state => state.activeTabId!), url)
      await expect.poll(() => electronApp.context().pages().some(page => page.url() === url)).toBe(true)
      await expect(electronApp.context().pages().find(page => page.url() === url)!.locator('main')).toHaveText('Ready')
      await electronApp.evaluate(({ webContents }, url) => {
        const page = webContents.getAllWebContents().find(page => page.getURL() === url)!
        const control = { page, original: page.forcefullyCrashRenderer, started: false }
        ;(globalThis as typeof globalThis & { __pendingRendererRecovery?: typeof control }).__pendingRendererRecovery = control
        page.forcefullyCrashRenderer = () => { control.started = true }
        page.emit('unresponsive')
      }, url)
      const recovery = appWindow.evaluate(async tabId => {
        try {
          await (window as unknown as { hronaut: HronautApi }).hronaut.reload(tabId)
          return null
        } catch (error) { return String(error) }
      }, tabId).catch(error => String(error))
      await expect.poll(() => electronApp.evaluate(() => (
        (globalThis as typeof globalThis & { __pendingRendererRecovery?: { started: boolean } }).__pendingRendererRecovery?.started
      ))).toBe(true)
      await appWindow.evaluate(async ({ tabId, action, url }) => {
        const api = (window as unknown as { hronaut: HronautApi }).hronaut
        if (action === 'close') await api.closeTab(tabId)
        else await api.navigate({ url: url + '/next', tabId })
      }, { tabId, action, url })
      expect(await recovery).toContain(action === 'close' ? 'tab closed' : 'page changed')
      const state = await appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState())
      const tab = state.tabs.find(tab => tab.id === tabId)
      if (action === 'close') expect(tab).toBeUndefined()
      else {
        expect(tab?.url).toBe(url + '/next')
        expect(tab?.pageProblem).toBeUndefined()
      }
    } finally {
      await electronApp.evaluate(() => {
        const mainGlobal = globalThis as typeof globalThis & {
          __pendingRendererRecovery?: { page: Electron.WebContents; original: Electron.WebContents['forcefullyCrashRenderer'] }
        }
        const control = mainGlobal.__pendingRendererRecovery
        if (control) control.page.forcefullyCrashRenderer = control.original
        delete mainGlobal.__pendingRendererRecovery
      })
      await closeFixtureServer(server)
    }
  })
}
