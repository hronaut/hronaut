import { createServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { useMcpWorkspace } from '../../scripts/mcp-workspace.js'
import type { HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

test('keeps editable values out of MCP inspection, locators and the live human picker clipboard', async ({ appWindow, electronApp, mcpPort, mcpToken }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<html><title>Inspection privacy fixture</title><main id="group"><p>Public neighbor</p><div id="editor" contenteditable="true" role="textbox" style="min-height:30px"></div><button id="labelled" aria-labelledby="editor">Public button</button><label for="input">Account <span contenteditable="plaintext-only">private-label-canary</span></label><input id="input"></main><section id="live" style="padding:20px;height:80px">Public live label</section></html>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const url = `http://127.0.0.1:${address.port}/`
  const client = new Client({ name: 'inspection-privacy-test', version: '1' })
  let tabId: string | undefined
  try {
    await expect.poll(async () => { try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`)).ok } catch { return false } }).toBe(true)
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), { requestInit: { headers: { authorization: `Bearer ${mcpToken}` } } }))
    await useMcpWorkspace(client, 'Inspection privacy', false)
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = await client.callTool({ name, arguments: args }) as CallToolResult
      expect(result.isError).not.toBe(true)
      return JSON.parse(result.content.filter(part => part.type === 'text').map(part => part.text).join('\n'))
    }
    tabId = (await call('browser_new_tab', { url, active: true })).activeTabId as string
    await appWindow.evaluate(tabId => (window as unknown as { hronaut: HronautApi }).hronaut.selectTab(tabId), tabId)
    await expect.poll(() => electronApp.context().pages().some(page => page.url() === url)).toBe(true)
    const page = electronApp.context().pages().find(page => page.url() === url)!
    await page.locator('#editor').fill('private-rich-canary')
    const original = await page.locator('#group').innerHTML()
    for (const selector of ['#editor', '#group', '#labelled', '#input']) {
      const report = await call('browser_element_inspect', { tabId, selector })
      expect(JSON.stringify(report)).not.toMatch(/private-(rich|label)-canary/)
      expect(report.box.width).toBeGreaterThan(0)
      if (selector === '#group') expect(report.text).toContain('Public neighbor')
    }
    for (const selector of ['#editor', '#labelled', '#input']) {
      const generated = await call('browser_generate_locator', { tabId, selector })
      expect(JSON.stringify(generated)).not.toMatch(/private-(rich|label)-canary/)
      expect(generated.strategy).toBe('css')
      expect(generated.locator).toBe(`page.locator(${JSON.stringify(selector)})`)
      await expect(page.locator(generated.selector)).toHaveCount(1)
    }
    expect(await page.locator('#group').innerHTML()).toBe(original)

    await appWindow.getByRole('button', { name: 'Select an element to copy for agent' }).click()
    await expect(page.locator('[data-hronaut-element-picker="overlay"]')).toHaveCount(1)
    const hoverLive = () => page.locator('#live').evaluate(element => {
      element.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, composed: true }))
    })
    await hoverLive()
    await expect(page.locator('[data-hronaut-element-picker="label"]')).toContainText('Public live label')
    // The same picker remains open when an editor is inserted into a previously safe subtree.
    await page.locator('#live').evaluate(element => element.insertAdjacentHTML('beforeend', '<span contenteditable="true">private-late-canary</span>'))
    await hoverLive()
    await expect(page.locator('[data-hronaut-element-picker="label"]')).not.toContainText('private-late-canary')
    const point = await page.locator('#live').evaluate(element => { const rect = element.getBoundingClientRect(); return { x: Math.round(rect.x + 5), y: Math.round(rect.y + 5) } })
    await electronApp.evaluate(({ webContents }, { url, point }) => {
      const page = webContents.getAllWebContents().find(page => page.getURL() === url)!
      page.focus()
      page.sendInputEvent({ type: 'mouseMove', ...point, movementX: 0, movementY: 0 })
      page.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 })
      page.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 })
    }, { url, point })
    await expect(appWindow.getByRole('button', { name: 'Element copied for agent' })).toBeVisible()
    const copied = await electronApp.evaluate(({ clipboard }) => clipboard.readText())
    expect(copied).toContain('Selector: #live')
    expect(copied).toContain('Public live label')
    expect(copied).not.toContain('private-late-canary')
    expect(await page.locator('#live [contenteditable]').textContent()).toBe('private-late-canary')
  } finally {
    if (tabId) await appWindow.evaluate(tabId => (window as unknown as { hronaut: HronautApi }).hronaut.cancelElementPicker(tabId), tabId).catch(() => undefined)
    await client.close().catch(() => undefined)
    await closeFixtureServer(server)
  }
})
