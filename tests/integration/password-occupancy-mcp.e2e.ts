import { createServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { BrowserState, HronautApi, HronautSettingsApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

test.use({ trace: 'off', screenshot: 'off', video: 'off' })
const text = (result: CallToolResult) => result.content.filter(item => item.type === 'text').map(item => item.text).join('\n')

test('observes password occupancy without values, getters, selection, wake or CDP DOM acquisition', async ({ electronApp, appWindow, mcpPort, mcpToken }) => {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    if (request.url === '/sleep') { response.end('<!doctype html><title>Disposable sleeping fixture</title><p>No form</p>'); return }
    response.end(`<!doctype html><title>Occupancy fixture</title><input id="target" type="password"><input id="other" type="text"><input id="hidden" type="password" hidden>
      <input id="otp" type="password" autocomplete="one-time-code"><input id="payment" type="password" autocomplete="section-checkout cc-csc"><input id="transparent" type="password" style="opacity:0">
      <script>
      const native=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');
      globalThis.getterCalls=0; globalThis.secret='';globalThis.events=0;
      for(const type of ['focus','input','change','submit'])document.addEventListener(type,()=>events++,true);
      globalThis.seed=()=>{secret=Array.from(crypto.getRandomValues(new Uint8Array(31)),n=>String.fromCharCode(65+n%26)).join('');native.set.call(target,secret)};
      globalThis.clear=()=>native.set.call(target,'');
      Object.defineProperty(HTMLInputElement.prototype,'value',{get(){getterCalls++;throw Error('hostile getter')},set:native.set});
      Object.defineProperty(target,'value',{get(){getterCalls++;throw Error('hostile own getter')}});
      </script>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture address')
  const url = `http://127.0.0.1:${address.port}/`
  const client = new Client({ name: 'occupancy-proof', version: '1' })
  try {
    await expect.poll(async () => { try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`)).ok } catch { return false } }).toBe(true)
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), { requestInit: { headers: { authorization: `Bearer ${mcpToken}` } } }))
    const call = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args }) as Promise<CallToolResult>
    const workspace = JSON.parse(text(await call('browser_workspaces', { action: 'create', storage: 'scratch', name: 'Occupancy' }))) as { id: string }
    const opened = JSON.parse(text(await call('browser_new_tab', { workspaceId: workspace.id, url }))) as BrowserState
    const tabId = opened.activeTabId!
    await expect.poll(() => electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents().some(page => page.getURL() === url && !page.isLoading()), url)).toBe(true)
    const onPage = (code: string) => electronApp.evaluate(async ({ webContents }, { url, code }) => {
      const page = webContents.getAllWebContents().find(page => page.getURL() === url)!
      return page.executeJavaScript(code, false)
    }, { url, code })
    await electronApp.evaluate(({ webContents }, url) => {
      const page = webContents.getAllWebContents().find(page => page.getURL() === url)!
      const original = page.debugger.sendCommand
      const execute = page.executeJavaScriptInIsolatedWorld
      const witness = { rawClean: true, domCommands: 0 }
      const scope = globalThis as typeof globalThis & { restoreOccupancyDebugger?: () => void; occupancyIpcWitness?: typeof witness }
      scope.occupancyIpcWitness = witness
      scope.restoreOccupancyDebugger = () => { page.debugger.sendCommand = original; page.executeJavaScriptInIsolatedWorld = execute }
      page.executeJavaScriptInIsolatedWorld = async function (...args) {
        const raw = await execute.apply(this, args)
        if (args[0] === 1006) {
          const clean = await page.executeJavaScript(`typeof secret!=='string'||secret===''||!${JSON.stringify(JSON.stringify(raw) ?? '')}.includes(secret)`, false)
          witness.rawClean = witness.rawClean && clean === true
        }
        return raw
      }
      page.debugger.sendCommand = async function (method, ...args) {
        if (method.startsWith('DOM.') || method.startsWith('CSS.')) { witness.domCommands += 1; throw new Error('Unexpected CDP DOM acquisition') }
        return original.call(this, method, ...args)
      }
    }, url)
    const inspect = (extra: Record<string, unknown> = {}) => call('browser_element_inspect', { workspaceId: workspace.id, tabId, selector: '#target', includePasswordOccupancy: true, ...extra })
    expect(JSON.parse(text(await inspect({ includePasswordOccupancy: false })))).not.toHaveProperty('passwordOccupancy')
    expect(JSON.parse(text(await inspect())).passwordOccupancy).toBe('empty')
    await onPage('seed();void 0')
    const report = await inspect()
    expect(report.isError).not.toBe(true)
    expect(JSON.parse(text(report)).passwordOccupancy).toBe('nonempty')
    // Secret comparison is reduced in the page too; the canary is never returned.
    expect(await onPage(`!${JSON.stringify(text(report))}.includes(secret)`)).toBe(true)
    await onPage('clear();void 0')
    expect(JSON.parse(text(await inspect())).passwordOccupancy).toBe('empty')
    for (const selector of ['#other', '#hidden', '#otp', '#payment', '#transparent']) expect(JSON.parse(text(await inspect({ selector }))).passwordOccupancy).toBe('unknown')
    for (const extra of [{ cssProperties: ['display'] }, { includeFonts: true }, { selector: 'input' }]) expect((await inspect(extra)).isError).toBe(true)
    expect(await onPage('({getterCalls,events,focused:document.activeElement===document.body,x:scrollX,y:scrollY})')).toEqual({ getterCalls: 0, events: 0, focused: true, x: 0, y: 0 })
    const other = JSON.parse(text(await call('browser_new_tab', { workspaceId: workspace.id, url: 'about:blank', active: true }))) as BrowserState
    await appWindow.evaluate(() => (window as unknown as { hronautSettings: HronautSettingsApi }).hronautSettings.setFollowAgentActivity(true))
    const selected = other.activeTabId
    expect(JSON.parse(text(await inspect())).passwordOccupancy).toBe('empty')
    expect((JSON.parse(text(await call('browser_status', { workspaceId: workspace.id }))) as BrowserState).activeTabId).toBe(selected)
    // Respect the existing form-protection guard: use a fresh form-free document for sleep.
    await electronApp.evaluate(async ({ webContents }, url) => { await webContents.getAllWebContents().find(page => page.getURL() === url)!.loadURL(`${url}sleep`) }, url)
    await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.setTabSleeping(id, true), tabId)
    expect((await inspect()).isError).toBe(true)
    const after = JSON.parse(text(await call('browser_status', { workspaceId: workspace.id }))) as BrowserState
    expect(after.activeTabId).toBe(selected)
    expect(after.tabs.find(tab => tab.id === tabId)?.sleeping).toBe(true)
    expect(await electronApp.evaluate(() => (globalThis as typeof globalThis & { occupancyIpcWitness?: { rawClean: boolean; domCommands: number } }).occupancyIpcWitness)).toEqual({ rawClean: true, domCommands: 0 })
  } finally {
    await electronApp.evaluate(() => (globalThis as typeof globalThis & { restoreOccupancyDebugger?: () => void }).restoreOccupancyDebugger?.()).catch(() => undefined)
    await client.close().catch(() => undefined)
    await closeFixtureServer(server)
  }
})
