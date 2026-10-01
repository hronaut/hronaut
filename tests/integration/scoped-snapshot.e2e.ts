import { createServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { BrowserState } from '../../src/shared/types.js'
import type { BrowserSnapshot } from '../../src/shared/snapshot.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

test('captures a component through MCP without unrelated content or silent scope fallback', async ({ electronApp, mcpPort, mcpToken }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<html><title>Scope fixture</title><main>' + '<section><h2>Outside component</h2><button>Save</button></section>'.repeat(100)
      + '<form id="target"><h2>Chosen component</h2><button type="button">Save</button><div><button type="button">Nested action</button></div><input value="private-canary"><textarea id="private-editor">private-editor-canary</textarea><div id="rich-editor" contenteditable="true" aria-label="Message editor"><h3>private-rich-heading</h3><button>private-rich-control</button></div><p>Public after editor</p></form></main></html>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const url = `http://127.0.0.1:${address.port}/`
  const client = new Client({ name: 'scoped-snapshot-test', version: '1' })
  const call = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args }) as Promise<CallToolResult>
  const parse = <T>(result: CallToolResult): T => {
    expect(result.isError).not.toBe(true)
    return JSON.parse(result.content.filter(p => p.type === 'text').map(p => p.text).join('\n')) as T
  }
  try {
    await expect.poll(async () => { try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`)).ok } catch { return false } }).toBe(true)
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), { requestInit: { headers: { authorization: `Bearer ${mcpToken}` } } }))
    const workspace = parse<{ id: string }>(await call('browser_workspaces', { action: 'create', name: 'Scoped snapshot', storage: 'scratch' }))
    const state = parse<BrowserState>(await call('browser_new_tab', { workspaceId: workspace.id, url }))
    const args = { workspaceId: workspace.id, tabId: state.activeTabId! }
    await expect.poll(() => electronApp.context().pages().some(page => page.url() === url)).toBe(true)
    const page = electronApp.context().pages().find(page => page.url() === url)!
    await expect(page.locator('#target')).toBeVisible()
    await page.evaluate(() => {
      const audit = { count: 0, observer: new MutationObserver(records => { audit.count += records.length }) }
      audit.observer.observe(document.body, { subtree: true, childList: true, characterData: true })
      ;(window as unknown as { snapshotAudit: typeof audit }).snapshotAudit = audit
    })
    const whole = (await call('browser_snapshot', args)).structuredContent as unknown as BrowserSnapshot
    expect(whole.text).toContain('Outside component')
    for (const secret of ['private-rich-heading', 'private-rich-control']) expect(whole.text).not.toContain(secret)
    const baseline = (await call('browser_snapshot', { ...args, action: 'set-baseline' })).structuredContent as { baselineId: string }
    const scopedResult = await call('browser_snapshot', { ...args, rootSelector: '#target' })
    expect(scopedResult.isError).not.toBe(true)
    const scoped = scopedResult.structuredContent as unknown as BrowserSnapshot
    expect(scoped).toMatchObject({ captureId: expect.any(String), truncated: false, scope: { kind: 'component', rootTag: 'form', outsideScopeOmitted: true } })
    expect(scoped.text).toContain('Chosen component')
    expect(scoped.text).toContain('Nested action')
    expect(scoped.text).toContain('Public after editor')
    expect(scoped.text).toContain('Message editor')
    for (const secret of ['private-rich-heading', 'private-rich-control']) expect(JSON.stringify(scopedResult)).not.toContain(secret)
    await expect(page.locator('#rich-editor h3')).toHaveText('private-rich-heading')
    await expect(page.locator('#rich-editor button')).toHaveText('private-rich-control')
    expect(scoped.text).not.toContain('Outside component')
    expect(JSON.stringify(scopedResult)).not.toContain('private-canary')
    expect(JSON.stringify(scopedResult)).not.toContain('private-editor-canary')
    expect(scoped.returnedChars).toBeLessThan(whole.returnedChars)
    const found = parse<{ matches: unknown[] }>(await call('browser_find', { ...args, query: 'private-rich-' }))
    expect(found.matches).toEqual([])
    expect(await page.evaluate(() => {
      const audit = (window as unknown as { snapshotAudit: { count: number; observer: MutationObserver } }).snapshotAudit
      audit.observer.disconnect()
      return audit.count
    })).toBe(0)
    await page.locator('#rich-editor').evaluate(element => { element.innerHTML = '<h3>changed-rich-heading</h3><button>changed-rich-control</button>' })
    for (const rootSelector of ['#missing', 'section', '[', '#private-editor']) expect((await call('browser_snapshot', { ...args, rootSelector })).isError).toBe(true)
    expect((await call('browser_snapshot', { ...args, action: 'set-baseline', rootSelector: '#target' })).isError).toBe(true)
    expect((await call('browser_snapshot', { ...args, action: 'delta', baselineId: baseline.baselineId, advanceBaseline: false })).structuredContent).toMatchObject({ status: 'unchanged' })
    await page.locator('#target').evaluate(element => { element.outerHTML = '<form id="target"><button>Replacement</button></form>' })
    const replaced = (await call('browser_snapshot', { ...args, rootSelector: '#target' })).structuredContent as unknown as BrowserSnapshot
    expect(replaced.captureId).not.toBe(scoped.captureId)
    expect(replaced.text).toContain('Replacement')
    expect(replaced.text).not.toContain('Chosen component')
    await page.locator('#target').evaluate(element => element.remove())
    expect((await call('browser_snapshot', { ...args, rootSelector: '#target' })).isError).toBe(true)
    await page.reload()
    await electronApp.evaluate(({ webContents }, url) => {
      const contents = webContents.getAllWebContents().find(candidate => candidate.getURL() === url)!
      const original = contents.executeJavaScript.bind(contents)
      let release!: () => void
      const gate = new Promise<void>(resolve => { release = resolve })
      const state = { held: false, release, restore: () => { contents.executeJavaScript = original } }
      ;(globalThis as typeof globalThis & { __scopedCapture?: typeof state }).__scopedCapture = state
      contents.executeJavaScript = async (code: string, userGesture?: boolean) => {
        const result = await original(code, userGesture)
        if (code.includes('const MAX_CHARS =')) {
          state.held = true
          await gate
          state.restore()
        }
        return result
      }
    }, url)
    const pending = call('browser_snapshot', { ...args, rootSelector: '#target' })
    await expect.poll(() => electronApp.evaluate(() => (globalThis as typeof globalThis & { __scopedCapture?: { held: boolean } }).__scopedCapture?.held)).toBe(true)
    await page.goto(url + '?changed=1')
    await electronApp.evaluate(() => (globalThis as typeof globalThis & { __scopedCapture?: { release: () => void } }).__scopedCapture?.release())
    expect((await pending).isError).toBe(true)
  } finally {
    await electronApp.evaluate(() => {
      const root = globalThis as typeof globalThis & { __scopedCapture?: { release: () => void; restore: () => void } }
      root.__scopedCapture?.release()
      root.__scopedCapture?.restore()
      delete root.__scopedCapture
    }).catch(() => undefined)
    await client.close()
    await closeFixtureServer(server)
  }
})
