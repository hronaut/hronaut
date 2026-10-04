import { writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { CallToolResultSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { BrowserElementInspection, HronautApi } from '../../src/shared/types.js'
import { test, expect, text } from './capability-fixtures.js'
import { closeFixtureServer } from './fixtures.js'

test('inspects explicit CSS candidates without changing the page or disrupting debugger owners', async ({ capabilities, electronApp, appWindow }, testInfo) => {
  const server = createServer((request, response) => {
    if (request.url?.startsWith('/style.css')) {
      response.writeHead(200, { 'content-type': 'text/css' })
      response.end('@layer base { .toast { display:block; color:red; } }\n.parent { font-size:22px; }\n.toast { display:none !important; content:"private-content-canary"; color:var(--private-css-canary); }\n#target { display:block; }\n@media (min-width:1px) { .toast { opacity:0.75; } }\n:root{--private-css-canary:red}')
      return
    }
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<html><link rel="stylesheet" href="/style.css?token=private-query-canary"><body><div class="parent"><div class="toast" id="target" style="opacity:0.6">Synthetic toast</div><button id="action">Action</button><input id="private" value="private-form-canary"></div><div id="shadow"></div><iframe id="frame" srcdoc="<button id=inside>Frame</button>"></iframe><script>document.querySelector("#shadow").attachShadow({mode:"open"}).innerHTML="<button id=inside>Shadow</button>"</script></body></html>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture address')
  const url = `http://127.0.0.1:${address.port}/`
  const { client, tabId } = capabilities
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: { tabId, ...args } }) as CallToolResult
    expect(result.isError, text(result)).not.toBe(true)
    return JSON.parse(text(result))
  }
  try {
    await call('browser_navigate', { url })
    await expect.poll(() => electronApp.context().pages().some(page => page.url() === url)).toBe(true)
    const page = electronApp.context().pages().find(page => page.url() === url)!
    await expect.poll(() => page.locator('#frame').evaluate((frame: HTMLIFrameElement) => frame.contentDocument?.readyState)).toBe('complete')
    await page.locator('#action').focus()
    const state = () => page.evaluate(() => ({ html: document.documentElement.outerHTML, focus: document.activeElement?.id, x: scrollX, y: scrollY, display: getComputedStyle(document.querySelector('#target')!).display }))
    const before = await state()
    const selected = await appWindow.evaluate('window.hronaut.getState().then(state => state.activeTabId)')
    const ordinary = await call('browser_element_inspect', { selector: '#target' }) as BrowserElementInspection
    expect(ordinary).not.toHaveProperty('cssProvenance')
    const report = await call('browser_element_inspect', { selector: '#target', cssProperties: ['display', 'opacity', 'font-size', 'color'] }) as BrowserElementInspection
    expect(report.cssProvenance?.status).toBe('candidates')
    await writeFile(testInfo.outputPath('css-provenance.json'), JSON.stringify(report.cssProvenance, null, 2))
    const candidates = report.cssProvenance!.candidates
    expect(candidates.some(candidate => candidate.property === 'display' && candidate.value === 'none !important' && candidate.source?.url === `${url}style.css` && candidate.source?.line === 3)).toBe(true)
    expect(candidates.some(candidate => candidate.property === 'display' && candidate.value === 'block')).toBe(true)
    expect(candidates.some(candidate => candidate.kind === 'inline' && candidate.property === 'opacity' && candidate.value === '0.6')).toBe(true)
    expect(candidates.some(candidate => candidate.inheritanceDepth === 1 && candidate.property === 'font-size' && candidate.value === '22px')).toBe(true)
    expect(candidates.some(candidate => candidate.conditions.some(condition => condition.type === 'media' && condition.text?.includes('min-width')))).toBe(true)
    expect(candidates.some(candidate => candidate.conditions.some(condition => condition.type === 'layers' && condition.text === 'base'))).toBe(true)
    expect(candidates.some(candidate => candidate.property === 'color' && candidate.valueOmitted)).toBe(true)
    expect(JSON.stringify(report)).not.toMatch(/private-(content|css|query|form)-canary|cssText|styleSheetId|"winner"/)
    expect(await state()).toEqual(before)
    expect(await appWindow.evaluate('window.hronaut.getState().then(state => state.activeTabId)')).toBe(selected)
    const foreground = await appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.newTab({ url: 'about:blank', active: true }))
    expect((await call('browser_element_inspect', { selector: '#target', cssProperties: ['display'] })).cssProvenance.status).toBe('candidates')
    expect(await appWindow.evaluate('window.hronaut.getState().then(state => state.activeTabId)')).toBe(foreground.activeTabId)
    await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.selectTab(id), tabId)
    const duplicate = await client.callTool({ name: 'browser_element_inspect', arguments: { tabId, selector: 'div', cssProperties: ['display'] } }) as CallToolResult
    expect(duplicate.isError).toBe(true)
    expect(text(duplicate)).toContain('exactly one')
    const snapshot = await client.callTool({ name: 'browser_snapshot', arguments: { tabId } }) as CallToolResult
    expect(snapshot.isError, text(snapshot)).not.toBe(true)
    const ref = await page.locator('#action').getAttribute('data-hronaut-ref')
    expect(ref).toMatch(/^e\d+$/)
    expect((await call('browser_element_inspect', { ref, cssProperties: ['display'] })).cssProvenance.status).toBe('candidates')
    for (const selector of ['#shadow #inside', '#frame #inside']) {
      const nested = await client.callTool({ name: 'browser_element_inspect', arguments: { tabId, selector, cssProperties: ['display'] } }) as CallToolResult
      expect(nested.isError).toBe(true)
    }
    await call('browser_code_coverage', { action: 'start' })
    expect((await call('browser_element_inspect', { selector: '#target', cssProperties: ['display'] })).cssProvenance).toMatchObject({ status: 'unavailable', reason: 'debugger-in-use' })
    await call('browser_code_coverage', { action: 'stop' })
    await electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(page => page.getURL() === url)!.openDevTools({ mode: 'detach' }), url)
    await expect.poll(() => electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(page => page.getURL() === url)!.isDevToolsOpened(), url)).toBe(true)
    expect((await call('browser_element_inspect', { selector: '#target', cssProperties: ['display'] })).cssProvenance).toMatchObject({ status: 'unavailable', reason: 'debugger-in-use' })
    expect(await electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(page => page.getURL() === url)!.isDevToolsOpened(), url)).toBe(true)
    const other = await call('browser_workspaces', { action: 'create', storage: 'scratch', name: 'Other CSS workspace' })
    expect(typeof other.id).toBe('string')
    // The convenience fixture wrapper always injects its original workspace.
    const denied = await client.request({ method: 'tools/call', params: { name: 'browser_element_inspect', arguments: { workspaceId: other.id, tabId, selector: '#target', cssProperties: ['display'] } } }, CallToolResultSchema)
    expect(denied.isError).toBe(true)
    expect(text(denied)).not.toContain('cssProvenance')
  } finally {
    await electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(page => page.getURL() === url)?.closeDevTools(), url).catch(() => undefined)
    await closeFixtureServer(server)
  }
})
