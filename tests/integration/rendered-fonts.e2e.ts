import { readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { CallToolResultSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { BrowserElementInspection, HronautApi } from '../../src/shared/types.js'
import { test, expect, text } from './capability-fixtures.js'
import { closeFixtureServer } from './fixtures.js'

test('inspects opted-in rendered fonts with bounded scope and preserves page and debugger owners', async ({ capabilities, electronApp, appWindow }, testInfo) => {
  const fonts = await Promise.all(['A', 'B'].map(name => readFile(`tests/fixtures/fonts/fixture-${name}.ttf`)))
  let requests = 0
  const server = createServer((req, res) => {
    if (req.url?.endsWith('.ttf')) { requests++; res.writeHead(200, { 'content-type': 'font/ttf' }); res.end(fonts[req.url.includes('A') ? 0 : 1]); return }
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(`<style>@font-face{font-family:FixtureA;src:url(/A.ttf)}@font-face{font-family:FixtureB;src:url(/B.ttf)}div{font-family:"Missing Fixture Family",FixtureA,FixtureB;font-size:30px}#pseudo::before{content:'A'}</style><button id="focus">Focus</button><div id="single">AAA</div><div id="mixed">AABB</div><div id="empty"></div><div id="hidden" style="display:none">AB</div><div id="nested"><span>AB</span></div><div id="closed"></div><div id="open"></div><div id="pseudo"></div><input id="password" type="password" value="private-form-canary"><textarea id="textarea">private-textarea-canary</textarea><div id="editor" contenteditable>private-editor-canary</div><iframe id="frame"></iframe><script>for(const mode of ['open','closed'])document.getElementById(mode).attachShadow({mode}).innerHTML='<span>AB</span>'</script>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address(); if (!address || typeof address === 'string') throw Error('Missing fixture address')
  const url = `http://127.0.0.1:${address.port}/`
  const { client, tabId } = capabilities
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: { tabId, ...args } }) as CallToolResult
    expect(result.isError, text(result)).not.toBe(true)
    return JSON.parse(text(result))
  }
  const inspect = (selector: string, args: Record<string, unknown> = {}) => call('browser_element_inspect', { selector, includeFonts: true, ...args }) as Promise<BrowserElementInspection>
  try {
    await call('browser_navigate', { url })
    await expect.poll(() => electronApp.context().pages().some(p => p.url() === url)).toBe(true)
    const page = electronApp.context().pages().find(p => p.url() === url)!
    await page.evaluate(() => document.fonts.ready.then(() => undefined))
    await page.locator('#focus').focus()
    const state = () => page.evaluate(() => ({ html: document.documentElement.outerHTML, focus: document.activeElement?.id, scrollX, scrollY, family: getComputedStyle(document.querySelector('#single')!).fontFamily }))
    const before = await state(); const requestsBefore = requests
    expect((await call('browser_element_inspect', { selector: '#single' })).renderedFonts).toBeUndefined()
    expect((await inspect('#single', { includeFonts: false })).renderedFonts).toBeUndefined()
    const single = await inspect('#single')
    expect(single.typography.fontFamily).toContain('Missing Fixture Family')
    expect(single.renderedFonts).toMatchObject({ status: 'observed', scope: 'selected-leaf-element', truncated: false, fonts: [{ familyName: 'Hronaut Fixture A', postScriptName: 'HronautFixtureA', isCustomFont: true, glyphCount: 3 }] })
    expect(single).not.toHaveProperty('cssProvenance')
    expect(Number.isFinite(Date.parse(single.renderedFonts!.capturedAt))).toBe(true)
    const mixed = await inspect('#mixed', { cssProperties: ['font-size'] })
    expect(mixed.cssProvenance?.status).toBe('candidates')
    expect(mixed.renderedFonts?.fonts).toHaveLength(2)
    expect(mixed.renderedFonts?.fonts).toEqual(expect.arrayContaining([{ familyName: 'Hronaut Fixture A', postScriptName: 'HronautFixtureA', isCustomFont: true, glyphCount: 2 }, { familyName: 'Hronaut Fixture B', postScriptName: 'HronautFixtureB', isCustomFont: true, glyphCount: 2 }]))
    for (const selector of ['#empty', '#hidden']) expect((await inspect(selector)).renderedFonts).toMatchObject({ status: 'empty', fonts: [] })
    for (const selector of ['#nested', '#closed', '#open', '#pseudo', '#password', '#textarea', '#editor', '#frame']) {
      const report = await inspect(selector)
      expect(report.renderedFonts, selector).toMatchObject({ status: 'unavailable', reason: 'unsupported-target', fonts: [] })
      expect(JSON.stringify(report)).not.toMatch(/private-(form|textarea|editor)-canary|renderedFontsEligible|nodeId|shadowRoots/)
    }
    expect(await state()).toEqual(before); expect(requests).toBe(requestsBefore)
    await writeFile(testInfo.outputPath('rendered-fonts.json'), JSON.stringify({ single, mixed, requestsBefore, requestsAfter: requests, unchangedPage: true }, null, 2))
    const foreground = await appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.newTab({ url: 'about:blank', active: true }))
    expect((await inspect('#single')).renderedFonts?.status).toBe('observed')
    expect(await appWindow.evaluate('window.hronaut.getState().then(state => state.activeTabId)')).toBe(foreground.activeTabId)
    const snapshot = await client.callTool({ name: 'browser_snapshot', arguments: { tabId } }) as CallToolResult
    expect(snapshot.isError, text(snapshot)).not.toBe(true)
    const ref = await page.locator('#focus').getAttribute('data-hronaut-ref')
    expect(ref).toMatch(/^e\d+$/)
    expect((await call('browser_element_inspect', { ref, includeFonts: true })).renderedFonts.status).toBe('observed')
    await page.locator('#focus').evaluate(element => element.remove())
    const stale = await client.callTool({ name: 'browser_element_inspect', arguments: { tabId, ref, includeFonts: true } }) as CallToolResult
    expect(stale.isError).toBe(true)
    const ambiguous = await client.callTool({ name: 'browser_element_inspect', arguments: { tabId, selector: 'div', includeFonts: true } }) as CallToolResult
    expect(ambiguous.isError).toBe(true)
    await electronApp.evaluate(({ webContents }, url) => {
      const debug = webContents.getAllWebContents().find(p => p.getURL() === url)!.debugger
      const original = debug.sendCommand
      ;(globalThis as typeof globalThis & { restoreFontProtocol?: () => void }).restoreFontProtocol = () => { debug.sendCommand = original }
      debug.sendCommand = function (method, ...args) {
        if (method === 'CSS.getPlatformFontsForNode') return Promise.reject(new Error('Method not found'))
        return original.call(this, method, ...args)
      }
    }, url)
    try {
      expect((await inspect('#single')).renderedFonts).toMatchObject({ status: 'unavailable', reason: 'unsupported-protocol', fonts: [] })
    } finally {
      await electronApp.evaluate(() => {
        const scope = globalThis as typeof globalThis & { restoreFontProtocol?: () => void }
        scope.restoreFontProtocol?.(); delete scope.restoreFontProtocol
      })
    }
    expect((await inspect('#single')).renderedFonts?.status).toBe('observed')
    await call('browser_cpu_profile', { action: 'start' })
    expect((await inspect('#single')).renderedFonts).toMatchObject({ status: 'unavailable', reason: 'debugger-in-use' })
    await call('browser_cpu_profile', { action: 'stop' })
    await call('browser_code_coverage', { action: 'start', reload: false })
    expect((await inspect('#single')).renderedFonts).toMatchObject({ status: 'unavailable', reason: 'debugger-in-use' })
    await call('browser_code_coverage', { action: 'stop' })
    await electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(p => p.getURL() === url)!.openDevTools({ mode: 'detach' }), url)
    await expect.poll(() => electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(p => p.getURL() === url)!.isDevToolsOpened(), url)).toBe(true)
    expect((await inspect('#single')).renderedFonts).toMatchObject({ status: 'unavailable', reason: 'debugger-in-use' })
    expect(await electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(p => p.getURL() === url)!.isDevToolsOpened(), url)).toBe(true)
    const other = await call('browser_workspaces', { action: 'create', storage: 'scratch', name: 'Other font workspace' })
    const denied = await client.request({ method: 'tools/call', params: { name: 'browser_element_inspect', arguments: { workspaceId: other.id, tabId, selector: '#single', includeFonts: true } } }, CallToolResultSchema)
    expect(denied.isError).toBe(true); expect(text(denied)).not.toContain('renderedFonts')
  } finally {
    await electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(p => p.getURL() === url)?.closeDevTools(), url).catch(() => undefined)
    await closeFixtureServer(server)
  }
})
