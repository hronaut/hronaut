import { createServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { useMcpWorkspace } from '../../scripts/mcp-workspace.js'
import type { BrowserState, HronautApi } from '../../src/shared/types.js'
import type { BrowserVisualCompareReport } from '../../src/shared/types.js'
import { closeFixtureServer, closeHronaut, launchHronaut, expect, test as base } from './fixtures.js'

const test = base.extend<{ displayScale: number }>({
  displayScale: [1, { option: true }],
  electronApp: async ({ profileDirectory, mcpPort, displayScale }, use) => {
    const instance = await launchHronaut(profileDirectory, mcpPort, 1, [], [`--force-device-scale-factor=${displayScale}`])
    try { await use(instance.app) } finally { await closeHronaut(instance.app) }
  }
})

const text = (r: CallToolResult) => r.content.filter(p => p.type === 'text').map(p => p.text).join('\n')
for (const displayScale of [1, 2]) test.describe(`native display scale ${displayScale}`, () => {
  test.use({ displayScale })
  test('compares only the retained region across DPR and zoom without changing full-viewport defaults', async ({ appWindow, electronApp, mcpPort, mcpToken }) => {
    const server = createServer((_req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Region probe</title><style>html,body{margin:0;background:white}div{position:absolute;width:80px;height:60px;top:40px}#target{left:40px;background:blue}#neighbor{left:300px;background:red}</style><div id="target"></div><div id="neighbor"></div>') })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const a = server.address(); if (!a || typeof a === 'string') throw new Error('Missing port')
    const url = `http://127.0.0.1:${a.port}/`
    const client = new Client({ name: 'region-discovery', version: '1' })
    try {
      await expect.poll(async () => { try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`)).ok } catch { return false } }).toBe(true)
      await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), { requestInit: { headers: { authorization: `Bearer ${mcpToken}` } } }))
      await useMcpWorkspace(client, 'Region discovery', false)
      const call = async (name: string, args: Record<string, unknown>) => { const r = await client.callTool({ name, arguments: args }) as CallToolResult; expect(r.isError, text(r)).not.toBe(true); return r }
      const tabId = (JSON.parse(text(await call('browser_new_tab', { url, active: true }))) as BrowserState).activeTabId!
      await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.selectTab(id), tabId)
      await expect.poll(() => electronApp.context().pages().some(p => p.url() === url)).toBe(true)
      const page = electronApp.context().pages().find(p => p.url() === url)!
      await expect(page.locator('#target')).toBeVisible()
      // Unemulated page bounds must map correctly on each native display scale too.
      await call('browser_visual_compare', { tabId, action: 'set-baseline', settleMs: 0, clip: { x: 40, y: 40, width: 80, height: 60 } })
      await page.locator('#target').evaluate(e => (e as HTMLElement).style.background = 'lime')
      const unEmulated = JSON.parse(text(await call('browser_visual_compare', { tabId, action: 'compare', settleMs: 0 }))) as BrowserVisualCompareReport
      expect(unEmulated.changedPixels).toBe(unEmulated.totalPixels)
      for (const dpr of [1, 2]) for (const zoom of [100, 125, 150, 200]) {
        await call('browser_emulate', { tabId, viewport: { width: 800, height: 600, deviceScaleFactor: dpr, mobile: false, touch: false, orientation: 'portrait' } })
        await call('browser_zoom', { tabId, action: 'set', percent: zoom })
        await page.evaluate(() => { document.getElementById('target')!.style.background = 'blue'; document.getElementById('neighbor')!.style.background = 'red' })
        const clip = { x: 40, y: 40, width: 80, height: 60 }
        const report = async (action: string, extra: Record<string, unknown> = {}) => JSON.parse(text(await call('browser_visual_compare', { tabId, action, settleMs: 0, ...extra }))) as BrowserVisualCompareReport
        await report('set-baseline')
        await page.locator('#neighbor').evaluate(e => (e as HTMLElement).style.background = 'lime')
        expect((await report('compare')).changedPixels).toBeGreaterThan(0)
        const baseline = await report('set-baseline', { clip })
        expect(baseline.scope).toMatchObject({ kind: 'region', clip })
        expect(baseline.baseline).toMatchObject({ width: 80 * zoom / 100 * displayScale, height: 60 * zoom / 100 * displayScale })
        await page.locator('#neighbor').evaluate(e => (e as HTMLElement).style.background = 'red')
        const before = await page.evaluate(() => ({ html: document.body.innerHTML, x: scrollX, y: scrollY }))
        const outside = await report('compare')
        expect(outside).toMatchObject({ identical: true, changedPixels: 0, totalPixels: 4800 * (zoom / 100 * displayScale) ** 2 })
        expect(await page.evaluate(() => ({ html: document.body.innerHTML, x: scrollX, y: scrollY }))).toEqual(before)
        await page.locator('#target').evaluate(e => (e as HTMLElement).style.background = 'lime')
        const changed = await call('browser_visual_compare', { tabId, action: 'compare', settleMs: 0 })
        const inside = JSON.parse(text(changed)) as BrowserVisualCompareReport
        expect(inside.changedPixels).toBe(inside.totalPixels)
        expect(inside.changedPercent).toBe(100)
        const image = changed.content.find(part => part.type === 'image')
        if (!image || image.type !== 'image') throw new Error('Missing scoped diff')
        expect(await electronApp.evaluate(({ nativeImage }, data) => nativeImage.createFromBuffer(Buffer.from(data, 'base64')).getSize(), image.data)).toEqual({ width: 80 * zoom / 100 * displayScale, height: 60 * zoom / 100 * displayScale })
        expect((await report('get')).scope).toEqual(baseline.scope)
      if (displayScale === 1 && dpr === 1 && zoom === 100) {
        await appWindow.getByRole('button', { name: 'Page tools' }).click()
        await appWindow.getByRole('dialog', { name: 'Page tools' }).getByRole('button', { name: /Visual compare:/ }).click()
        const panel = appWindow.getByRole('dialog', { name: 'Visual compare' })
        await expect(panel).toContainText('Only this region is compared.')
        await expect(panel.getByRole('button', { name: 'New viewport baseline' })).toBeVisible()
        await panel.getByRole('button', { name: 'Copy diff PNG' }).click()
        await expect(panel.getByRole('button', { name: 'Copied' })).toBeVisible()
        const copiedSize = await electronApp.evaluate(async ({ clipboard, nativeImage }) => {
          const item = (await clipboard.read()).find(item => item.types.includes('image/png'))!
          const data = await ((await item.getType('image/png')) as Blob).arrayBuffer()
          return nativeImage.createFromBuffer(Buffer.from(data)).getSize()
        })
        expect(copiedSize).toEqual({ width: 80, height: 60 })
        await panel.getByRole('button', { name: 'Close visual compare' }).click()
      }
        const denied = await client.callTool({ name: 'browser_visual_compare', arguments: { tabId, action: 'compare', clip } }) as CallToolResult
        expect(denied.isError).toBe(true)
        await report('set-baseline')
        expect((await report('get')).scope).toEqual({ kind: 'viewport' })

      }
      const clip = { x: 40, y: 40, width: 80, height: 60 }
      const viewport = { width: 800, height: 600, deviceScaleFactor: 1, mobile: false, touch: false, orientation: 'portrait' }
      const report = async (action: string, extra: Record<string, unknown> = {}) => JSON.parse(text(await call('browser_visual_compare', { tabId, action, settleMs: 0, ...extra }))) as BrowserVisualCompareReport
      for (const change of ['scroll', 'zoom', 'DPR', 'viewport', 'navigation']) {
        await page.reload()
        await call('browser_emulate', { tabId, viewport })
        await call('browser_zoom', { tabId, action: 'set', percent: 100 })
        await page.evaluate(() => { document.body.style.height = '2000px' })
        await report('set-baseline', { clip })
        if (change === 'scroll') await page.evaluate(() => scrollTo(0, 100))
        else if (change === 'zoom') await call('browser_zoom', { tabId, action: 'set', percent: 125 })
        else if (change === 'DPR') await call('browser_emulate', { tabId, viewport: { ...viewport, deviceScaleFactor: 2 } })
        else if (change === 'viewport') await call('browser_emulate', { tabId, viewport: { ...viewport, width: 900 } })
        else await page.reload()
        const result = await client.callTool({ name: 'browser_visual_compare', arguments: { tabId, action: 'compare', settleMs: 0 } }) as CallToolResult
        expect(result.isError, `${change}: ${text(result)}`).toBe(true)
        expect(text(result)).toContain('region capture context changed')
        expect((await report('get')).status).toBe('baseline')
      }
      await call('browser_emulate', { tabId, viewport })
      await call('browser_zoom', { tabId, action: 'set', percent: 100 })
      await report('set-baseline', { clip })
      for (const invalid of [{ ...clip, x: -1 }, { ...clip, width: 0 }, { ...clip, x: 799 }, { x: 0.1, y: 0.1, width: 0.1, height: 0.1 }]) {
        expect((await client.callTool({ name: 'browser_visual_compare', arguments: { tabId, action: 'set-baseline', clip: invalid, settleMs: 0 } }) as CallToolResult).isError).toBe(true)
        expect((await report('get')).scope).toMatchObject({ kind: 'region', clip })
      }
      // A large native region is cropped before the existing 1920x1080 normalization.
      await call('browser_emulate', { tabId, viewport: { ...viewport, width: 3000, height: 2000 } })
      await page.evaluate(() => {
        Object.assign(document.getElementById('target')!.style, { width: '2000px', height: '1200px', background: 'blue' })
        Object.assign(document.getElementById('neighbor')!.style, { left: '2040px', width: '10px', height: '1200px', background: 'red' })
      })
      const wide = await report('set-baseline', { clip: { x: 40, y: 40, width: 2000, height: 1200 } })
      expect(wide.baseline).toMatchObject({ width: 1800, height: 1080 })
      await page.locator('#neighbor').evaluate(e => (e as HTMLElement).style.background = 'lime')
      expect(await report('compare')).toMatchObject({ identical: true, totalPixels: 1800 * 1080 })
      await report('clear')
      expect(await report('get')).toMatchObject({ status: 'empty' })

    } finally { await client.close().catch(() => undefined); await closeFixtureServer(server) }
  })

})
