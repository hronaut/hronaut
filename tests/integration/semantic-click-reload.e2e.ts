import { createServer } from 'node:http'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, test } from './capability-fixtures.js'
import { closeFixtureServer } from './fixtures.js'

type ReloadGate = { ready: boolean; dispatches: number; listeners: number; release(): void; restore(): void }
type Scope = typeof globalThis & { __semanticReloadGate?: ReloadGate }

test('semantic click rejects a pending reload committed during preparation', async ({ capabilities, electronApp }, testInfo) => {
  const { client, tabId } = capabilities
  let version = 0
  let releaseResponse: (() => void) | undefined
  let requested!: () => void
  const reloadRequested = new Promise<void>(resolve => { requested = resolve })
  const server = createServer((request, response) => {
    if (request.url !== '/') { response.writeHead(404); response.end(); return }
    const currentVersion = ++version
    const reply = (): void => {
      if (response.writableEnded) return
      response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' })
      response.end(`<button id="target">Synthetic target</button><script>window.documentVersion=${currentVersion};window.semanticClicks=0;document.querySelector('#target').onclick=()=>window.semanticClicks++;</script>`)
    }
    if (currentVersion === 2) { releaseResponse = reply; requested() } else reply()
  })
  let pending: Promise<CallToolResult> | undefined
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing fixture address')
    const url = `http://127.0.0.1:${address.port}/`
    expect((await client.callTool({ name: 'browser_navigate', arguments: { tabId, url } })).isError).not.toBe(true)
    await electronApp.evaluate(({ webContents }, url) => {
      const page = webContents.getAllWebContents().find(page => page.getURL() === url)!
      const execute = page.executeJavaScript
      let release!: () => void
      const barrier = new Promise<void>(resolve => { release = resolve })
      const gate: ReloadGate = { ready: false, dispatches: 0, listeners: page.listenerCount('did-navigate'), release,
        restore: () => { if (!page.isDestroyed()) page.executeJavaScript = execute } }
      ;(globalThis as Scope).__semanticReloadGate = gate
      page.executeJavaScript = async (script, ...args) => {
        if (script.includes('element.click();')) gate.dispatches++
        const result = execute.call(page, script, ...args)
        // A pending reload can defer script execution until the new document.
        // Hold the real preparation promise, without faking a navigation event.
        if (!gate.ready && script.includes('element.scrollIntoView')) {
          void result.catch(() => undefined)
          gate.ready = true
          await barrier
        }
        return result
      }
      void page.loadURL(url).catch(() => undefined)
    }, url)
    await reloadRequested
    expect(await electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(page => page.getURL() === url)!.isLoadingMainFrame(), url)).toBe(true)
    pending = client.callTool({ name: 'browser_click', arguments: { tabId, selector: '#target' } }) as Promise<CallToolResult>
    await expect.poll(() => electronApp.evaluate(() => (globalThis as Scope).__semanticReloadGate?.ready)).toBe(true)
    releaseResponse!()
    await expect.poll(() => electronApp.evaluate(async ({ webContents }, url) => webContents.getAllWebContents().find(page => page.getURL() === url)!.executeJavaScript('window.documentVersion'), url)).toBe(2)
    await electronApp.evaluate(() => (globalThis as Scope).__semanticReloadGate!.release())
    const result = await pending
    const observation = await electronApp.evaluate(async ({ webContents }, url) => {
      const page = webContents.getAllWebContents().find(page => page.getURL() === url)!
      const gate = (globalThis as Scope).__semanticReloadGate!
      return { dispatches: gate.dispatches, listenersRestored: gate.listeners === page.listenerCount('did-navigate'),
        effects: await page.executeJavaScript('({version:window.documentVersion,clicks:window.semanticClicks,active:window.__hronautAgentInputActive===true})') }
    }, url)
    await testInfo.attach('semantic-click-reload', { body: JSON.stringify({ result, observation }), contentType: 'application/json' })
    expect(observation).toEqual({ dispatches: 0, listenersRestored: true, effects: { version: 2, clicks: 0, active: false } })
    expect(result.isError).toBe(true)
    expect(result.structuredContent).toMatchObject({ status: 'OUTCOME_UNKNOWN', retrySafe: false })
  } finally {
    releaseResponse?.()
    await electronApp.evaluate(() => {
      const scope = globalThis as Scope
      scope.__semanticReloadGate?.release()
      scope.__semanticReloadGate?.restore()
      delete scope.__semanticReloadGate
    }).catch(() => undefined)
    await pending?.catch(() => undefined)
    await closeFixtureServer(server)
  }
})
