import { createServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { useMcpWorkspace } from '../../scripts/mcp-workspace.js'
import type { BrowserState, HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

function text(result: CallToolResult): string {
  return result.content.filter(item => item.type === 'text').map(item => item.text).join('\n')
}

test('supports real 400% page zoom, reflow, input and isolated workspaces', async ({ appWindow, electronApp, mcpPort, mcpToken }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(`<!doctype html><title>400 percent fixture</title><style>body{margin:0}button{margin:10px;width:100px;height:40px}main{height:2000px}</style><button id="target">Zoom target</button><main>Reflow evidence</main><script>window.hits=0;window.hovered=false;target.onclick=()=>window.hits++;target.onmouseenter=()=>window.hovered=true;</script>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing port')
  const origin = `http://127.0.0.1:${address.port}`
  const url = `${origin}/first`
  const client = new Client({ name: 'zoom-400-test', version: '1.0.0' })
  try {
    await expect.poll(async () => {
      try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`, { headers: { authorization: `Bearer ${mcpToken}` } })).ok } catch { return false }
    }).toBe(true)
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), { requestInit: { headers: { authorization: `Bearer ${mcpToken}` } } }))
    const unscopedCallTool = client.callTool.bind(client)
    await useMcpWorkspace(client, 'Zoom first', false)
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = await client.callTool({ name, arguments: args }) as CallToolResult
      expect(result.isError, text(result)).not.toBe(true)
      return result
    }
    const opened = JSON.parse(text(await call('browser_new_tab', { url, active: true }))) as BrowserState
    const tabId = opened.activeTabId!
    await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.selectTab(id), tabId)
    await expect.poll(() => electronApp.context().pages().some(p => p.url() === url)).toBe(true)
    const page = electronApp.context().pages().find(p => p.url() === url)!
    await expect(page.locator('#target')).toBeVisible()
    const before = await page.evaluate(() => ({ width: innerWidth, dpr: devicePixelRatio }))
    const shellWidth = await appWindow.evaluate(() => innerWidth)
    // Probe the pinned runtime independently of Hronaut's current range guard.
    await electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(c => c.getURL() === url)!.setZoomFactor(4), url)
    await expect.poll(() => page.evaluate(() => innerWidth)).toBeCloseTo(before.width / 4, 0)
    await electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(c => c.getURL() === url)!.setZoomFactor(1), url)
    await expect.poll(() => page.evaluate(() => innerWidth)).toBe(before.width)
    await call('browser_zoom', { tabId, action: 'set', percent: 400 })
    expect(await electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(c => c.getURL() === url)!.getZoomFactor(), url)).toBeCloseTo(4, 8)
    await expect.poll(() => page.evaluate(() => innerWidth)).toBeCloseTo(before.width / 4, 0)
    const after = await page.evaluate(() => ({ width: innerWidth, dpr: devicePixelRatio, narrow: matchMedia('(max-width: 400px)').matches }))
    expect(after.dpr).toBeCloseTo(before.dpr * 4)
    expect(after.narrow).toBe(after.width <= 400)
    expect(await appWindow.evaluate(() => innerWidth)).toBe(shellWidth)
    expect(text(await call('browser_snapshot', { tabId }))).toContain('Zoom target')
    const image = await call('browser_screenshot', { tabId, clip: { x: 0, y: 0, width: 100, height: 60 } })
    const png = image.content.find(item => item.type === 'image')!
    expect(png.type).toBe('image')
    if (png.type !== 'image') throw new Error('Missing image')
    const dimensions = await electronApp.evaluate(({ nativeImage }, data) => nativeImage.createFromBuffer(Buffer.from(data, 'base64')).getSize(), png.data)
    expect(dimensions.width / dimensions.height).toBeCloseTo(100 / 60, 1)
    expect(dimensions.width).toBe(Math.round(100 * after.dpr))
    expect(dimensions.height).toBe(Math.round(60 * after.dpr))
    await call('browser_hover', { tabId, selector: '#target' })
    await expect.poll(() => page.evaluate('window.hovered')).toBe(true)
    await call('browser_click', { tabId, selector: '#target', native: true })
    await expect.poll(() => page.evaluate('window.hits')).toBe(1)
    await call('browser_scroll', { tabId, deltaY: 250 })
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0)
    await appWindow.getByRole('button', { name: 'Page zoom controls', exact: true }).click()
    const controls = appWindow.getByRole('group', { name: 'Page zoom controls' })
    await expect(controls.locator('output')).toHaveText('400%')
    await expect(controls.getByRole('button', { name: 'Zoom in', exact: true })).toBeDisabled()
    await controls.getByRole('button', { name: 'Zoom out', exact: true }).click()
    await expect(controls.locator('output')).toHaveText('300%')
    await expect(controls.getByRole('button', { name: 'Zoom in', exact: true })).toBeEnabled()
    await controls.getByRole('button', { name: 'Zoom in', exact: true }).click()
    await expect(controls.locator('output')).toHaveText('400%')
    await controls.getByRole('button', { name: 'Reset', exact: true }).click()
    await expect(controls.locator('output')).toHaveText('100%')
    for (const percent of [50, 125, 300]) await call('browser_zoom', { tabId, action: 'set', percent })
    await electronApp.evaluate(({ webContents }, url) => {
      const page = webContents.getAllWebContents().find(c => c.getURL() === url)!
      page.focus()
      const modifiers = process.platform === 'darwin' ? ['meta', 'shift'] as const : ['control', 'shift'] as const
      page.sendInputEvent({ type: 'keyDown', keyCode: '=', modifiers: [...modifiers] })
      page.sendInputEvent({ type: 'keyUp', keyCode: '=', modifiers: [...modifiers] })
    }, url)
    await expect.poll(() => appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.getState().then(s => s.tabs.find(t => t.id === id)?.zoomPercent), tabId)).toBe(400)
    for (const percent of [49, 401, 400.5]) {
      const rejected = await client.callTool({ name: 'browser_zoom', arguments: { tabId, action: 'set', percent } }) as CallToolResult
      expect(rejected.isError).toBe(true)
    }
    await page.reload()
    await expect.poll(() => page.evaluate(() => innerWidth)).toBeCloseTo(before.width / 4, 0)
    // Record Chromium's same-origin sharing, while proving separate sessions stay isolated.
    await call('browser_new_tab', { url: `${origin}/same-origin`, active: true })
    await expect.poll(() => electronApp.context().pages().some(p => p.url() === `${origin}/same-origin`)).toBe(true)
    const same = electronApp.context().pages().find(p => p.url() === `${origin}/same-origin`)!
    await expect.poll(() => same.evaluate(() => innerWidth)).toBeCloseTo(before.width / 4, 0)
    const crossOriginUrl = `http://localhost:${address.port}/other-origin`
    await call('browser_new_tab', { url: crossOriginUrl, active: true })
    await expect.poll(() => electronApp.context().pages().some(p => p.url() === crossOriginUrl)).toBe(true)
    expect(await electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(c => c.getURL() === url)!.getZoomFactor(), crossOriginUrl)).toBe(1)
    client.callTool = unscopedCallTool
    await useMcpWorkspace(client, 'Zoom second', false)
    const other = JSON.parse(text(await call('browser_new_tab', { url: `${origin}/separate-workspace`, active: true }))) as BrowserState
    expect(other.tabs.find(t => t.id === other.activeTabId)?.zoomPercent).toBe(100)
    const denied = await client.callTool({ name: 'browser_zoom', arguments: { tabId, action: 'set', percent: 400 } }) as CallToolResult
    expect(denied.isError).toBe(true)
  } finally {
    await client.close().catch(() => undefined)
    await closeFixtureServer(server)
  }
})
