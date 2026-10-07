import { createServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { useMcpWorkspace } from '../../scripts/mcp-workspace.js'
import type { BrowserElementInspection, BrowserState } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

const text = (result: CallToolResult) => result.content.filter(item => item.type === 'text').map(item => item.text).join('\n')

for (const independentBody of [false, true]) {
  test(`observes physical scroll geometry through MCP with independent body=${independentBody}`, async ({ electronApp, mcpPort, mcpToken }) => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html' })
      response.end(`<!doctype html><html id="root"><title>Scroll geometry</title><style>
        ${independentBody ? 'html{height:100%;overflow:hidden}body{height:100%;overflow:auto;margin:0}' : ''}
        .scroll{width:120px;height:80px;overflow:auto}.large{width:400px;height:600px}
        #rtl{direction:rtl}#vertical{writing-mode:vertical-rl}
      </style><input id="focus" aria-label="Public label" value="private-value-canary">
      <div id="nested" class="scroll" tabindex="0"><div class="large"></div></div>
      <div id="empty" class="scroll"></div><div id="rtl" class="scroll"><div class="large"></div></div>
      <div id="vertical" class="scroll"><div class="large"></div></div><div id="hidden" hidden></div>
      <div class="ambiguous"></div><div class="ambiguous"></div><div style="height:1800px"></div>`)
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing fixture port')
    const url = `http://127.0.0.1:${address.port}/`
    const client = new Client({ name: 'scroll-inspection', version: '1' })
    try {
      await expect.poll(async () => { try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`)).ok } catch { return false } }).toBe(true)
      await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), { requestInit: { headers: { authorization: `Bearer ${mcpToken}` } } }))
      await useMcpWorkspace(client, 'Scroll geometry', false)
      const call = async (name: string, args: Record<string, unknown>) => {
        const result = await client.callTool({ name, arguments: args }) as CallToolResult
        expect(result.isError, text(result)).not.toBe(true)
        return JSON.parse(text(result))
      }
      const opened = await call('browser_new_tab', { url, active: true }) as BrowserState
      const tabId = opened.activeTabId!
      await expect.poll(() => electronApp.context().pages().some(page => page.url() === url)).toBe(true)
      const page = electronApp.context().pages().find(page => page.url() === url)!
      await expect(page.locator('#nested')).toBeVisible()
      await page.locator('#focus').focus()
      const inspect = async (selector: string, includeScroll = true) => {
        const before = await page.evaluate(() => ({ html: document.body.innerHTML, focus: document.activeElement?.id, x: scrollX, y: scrollY }))
        const report = await call('browser_element_inspect', { tabId, selector, includeScroll }) as BrowserElementInspection
        expect(JSON.stringify(report)).not.toContain('private-value-canary')
        expect(await page.evaluate(() => ({ html: document.body.innerHTML, focus: document.activeElement?.id, x: scrollX, y: scrollY }))).toEqual(before)
        if (includeScroll) {
          const native = await page.locator(selector).first().evaluate(element => ({
            status: 'observed', scrollTop: element.scrollTop, scrollLeft: element.scrollLeft,
            clientWidth: element.clientWidth, clientHeight: element.clientHeight,
            scrollWidth: element.scrollWidth, scrollHeight: element.scrollHeight,
            direction: getComputedStyle(element).direction, writingMode: getComputedStyle(element).writingMode,
            isDocumentScroller: element === document.scrollingElement,
            documentScroller: document.scrollingElement === document.documentElement ? 'html' : document.scrollingElement === document.body ? 'body' : null
          }))
          expect(report.scrollGeometry).toEqual(native)
        }
        return report
      }
      expect(await inspect('#nested', false)).not.toHaveProperty('scrollGeometry')
      expect((await inspect('#nested')).scrollGeometry).toMatchObject({ status: 'observed', scrollTop: 0, scrollWidth: 400, scrollHeight: 600, isDocumentScroller: false })
      const snapshot = await client.callTool({ name: 'browser_snapshot', arguments: { tabId } }) as CallToolResult
      expect(snapshot.isError).not.toBe(true)
      const ref = await page.locator('#focus').getAttribute('data-hronaut-ref')
      expect(ref).toMatch(/^e\d+$/)
      const byRef = await call('browser_element_inspect', { tabId, ref, includeScroll: true }) as BrowserElementInspection
      expect(byRef.scrollGeometry).toEqual((await inspect('#focus')).scrollGeometry)
      const documentBefore = (await inspect('html')).scrollGeometry
      await call('browser_scroll', { tabId, selector: '#nested', deltaY: 40 })
      expect((await inspect('#nested')).scrollGeometry).toMatchObject({ scrollTop: 40 })
      expect((await inspect('html')).scrollGeometry).toEqual(documentBefore)
      const empty = (await inspect('#empty')).scrollGeometry!
      expect(empty.status).toBe('observed')
      if (empty.status === 'observed') {
        expect(empty.scrollWidth).toBe(empty.clientWidth)
        expect(empty.scrollHeight).toBe(empty.clientHeight)
      }
      await page.locator('#rtl').evaluate(element => { element.scrollLeft = -30.5 })
      expect((await inspect('#rtl')).scrollGeometry).toMatchObject({ direction: 'rtl' })
      expect(await page.locator('#rtl').evaluate(element => element.scrollLeft)).toBeLessThan(0)
      await page.locator('#vertical').evaluate(element => { element.scrollLeft = -20.25 })
      expect((await inspect('#vertical')).scrollGeometry).toMatchObject({ writingMode: 'vertical-rl' })
      expect((await inspect('#hidden')).scrollGeometry).toMatchObject({ clientWidth: 0, clientHeight: 0 })
      await inspect('.ambiguous') // Preserve the existing first-match targeting contract.
      await inspect('#focus')
      expect((await client.callTool({ name: 'browser_element_inspect', arguments: { tabId, selector: '#missing', includeScroll: true } }) as CallToolResult).isError).toBe(true)
      if (independentBody) {
        await call('browser_scroll', { tabId, selector: 'body', deltaY: 60 })
        expect((await inspect('body')).scrollGeometry).toMatchObject({ scrollTop: 60, isDocumentScroller: false, documentScroller: 'html' })
        expect((await inspect('html')).scrollGeometry).toMatchObject({ scrollTop: 0, isDocumentScroller: true })
      }
    } finally {
      await client.close().catch(() => undefined)
      await closeFixtureServer(server)
    }
  })
}
