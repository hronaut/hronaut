import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { BrowserPerformanceReport } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

const png = readFileSync('build/icons/512x512.png')

test('reports bounded LCP phases and incomplete evidence on real Electron pages', async ({ electronApp, appWindow, mcpPort, mcpToken }, testInfo) => {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url!, 'http://localhost')
    const mode = url.searchParams.get('mode')
    if (url.pathname === '/hero.png') {
      response.writeHead(200, { 'content-type': 'image/png', 'content-length': png.length, 'cache-control': 'no-store' })
      response.write(png.subarray(0, png.length / 2))
      if (mode === 'transfer') await new Promise(resolve => setTimeout(resolve, 700))
      response.end(png.subarray(png.length / 2))
      return
    }
    if (mode === 'ttfb') await new Promise(resolve => setTimeout(resolve, 700))
    response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' })
    response.end(`<!doctype html><html lang="en"><title>LCP ${mode}</title><style>body{margin:0}img{width:450px;height:450px}p{font-size:48px}</style>
      ${['text', 'late'].includes(mode!) ? '<p id="text">Synthetic text LCP</p>' : `<img id="hero" alt="" ${mode === 'render' ? 'style="visibility:hidden" onload="setTimeout(()=>this.style.visibility=\'visible\',700)"' : ''} ${mode !== 'discovery' ? `src="${mode === 'restricted' ? 'http://' + request.headers.host!.replace('127.0.0.1', 'localhost') : ''}/hero.png?mode=${mode}&token=synthetic-private"` : ''}>
      ${mode === 'discovery' ? '<script>setTimeout(()=>document.querySelector("#hero").src="/hero.png?mode=discovery",700)</script>' : ''}`}</html>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No fixture address')
  const client = new Client({ name: 'lcp-attribution', version: '1' })
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args }) as CallToolResult
    const text = result.content.filter(part => part.type === 'text').map(part => part.text).join('\n')
    expect(result.isError, text).not.toBe(true)
    return JSON.parse(text)
  }
  const observations: unknown[] = []
  try {
    await expect.poll(async () => { try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`)).ok } catch { return false } }).toBe(true)
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), { requestInit: { headers: { authorization: `Bearer ${mcpToken}` } } }))
    const workspace = await call('browser_workspaces', { action: 'create', name: 'LCP fixture', storage: 'scratch' })
    for (const mode of ['ttfb', 'discovery', 'transfer', 'render', 'text', 'missing', 'restricted', 'late']) {
      const url = `http://127.0.0.1:${address.port}/?mode=${mode}`
      const state = await call('browser_new_tab', { workspaceId: workspace.id, url, active: true })
      await appWindow.evaluate(`window.hronaut.selectTab(${JSON.stringify(state.activeTabId)})`)
      await expect.poll(() => electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents().some(page => page.getURL() === url && !page.isLoading()), url)).toBe(true)

      const page = electronApp.context().pages().find(page => page.url() === url)!
      if (mode === 'missing') await page.evaluate(() => performance.clearResourceTimings())
      const args = { workspaceId: workspace.id, tabId: state.activeTabId, settleMs: 50 }
      let report: BrowserPerformanceReport | undefined
      await expect.poll(async () => {
        report = await call('browser_performance', args) as BrowserPerformanceReport
        return report.metrics.LCP?.lcpAttribution?.target
      }).toBe(['text', 'late'].includes(mode) ? '#text' : '#hero')
      let result = report!.metrics.LCP!.lcpAttribution!
      if (mode === 'late') {
        await page.evaluate(() => {
          const image = document.createElement('img')
          image.id = 'hero'; image.src = '/hero.png?mode=late&token=synthetic-private'
          document.querySelector('#text')!.replaceWith(image)
        })
        await expect.poll(async () => {
          report = await call('browser_performance', args) as BrowserPerformanceReport
          return report.metrics.LCP?.lcpAttribution?.target
        }).toBe('#hero')
        result = report!.metrics.LCP!.lcpAttribution!
      }
      observations.push({ mode, value: report!.metrics.LCP!.value, ...result })
      console.log(JSON.stringify(observations.at(-1)))
      if (mode === 'missing' || mode === 'restricted') {
        expect(result.status).toBe('incomplete')
        expect(result.reason).toBe(mode === 'missing' ? 'missing-resource' : 'restricted-timing')
        expect(result.resourceLoadDurationMs).toBeNull()
      } else {
        expect(result.status).toBe('complete')
        const fields = { ttfb: 'timeToFirstByteMs', discovery: 'resourceLoadDelayMs', transfer: 'resourceLoadDurationMs', render: 'elementRenderDelayMs' } as const
        if (mode in fields) expect(result[fields[mode as keyof typeof fields]]).toBeGreaterThan(500)
        expect(Math.abs(result.timeToFirstByteMs! + result.resourceLoadDelayMs! + result.resourceLoadDurationMs! + result.elementRenderDelayMs! - report!.metrics.LCP!.value)).toBeLessThan(0.05)
      }
      if (mode === 'text') expect(result.resourceTiming).toBe('not-applicable')
      expect(JSON.stringify(result)).not.toMatch(/synthetic-private|token=|lcpEntry|navigationEntry|outerHTML/)
      const before = await page.evaluate(() => ({ html: document.documentElement.outerHTML, focused: document.activeElement?.tagName, x: scrollX, y: scrollY }))
      const nativeBefore = await electronApp.evaluate(async ({ webContents }, url) => {
        const page = webContents.getAllWebContents().find(page => page.getURL() === url)!
        await page.executeJavaScriptInIsolatedWorld(1002, [{ code: 'globalThis.__lcpIdentity = globalThis.__hronautPerformanceCollector; true' }])
        return { debuggerAttached: page.debugger.isAttached(), focused: webContents.getFocusedWebContents()?.id ?? null }
      }, url)
      await call('browser_performance', args)
      expect(await page.evaluate(() => ({ html: document.documentElement.outerHTML, focused: document.activeElement?.tagName, x: scrollX, y: scrollY }))).toEqual(before)
      const nativeAfter = await electronApp.evaluate(async ({ webContents }, url) => {
        const page = webContents.getAllWebContents().find(page => page.getURL() === url)!
        return { debuggerAttached: page.debugger.isAttached(), focused: webContents.getFocusedWebContents()?.id ?? null,
          reused: await page.executeJavaScriptInIsolatedWorld(1002, [{ code: 'globalThis.__lcpIdentity === globalThis.__hronautPerformanceCollector' }]) }
      }, url)
      expect(nativeAfter).toEqual({ ...nativeBefore, reused: true })
      expect(await appWindow.evaluate('window.hronaut.getState().then(s => s.activeTabId)')).toBe(state.activeTabId)
      if (mode === 'late') {
        await appWindow.getByRole('button', { name: 'Page tools', exact: true }).click()
        await appWindow.getByRole('dialog', { name: 'Page tools' }).getByRole('button', { name: /performance/i }).click()
        const panel = appWindow.getByRole('dialog', { name: 'Page performance', exact: true })
        await expect(panel.getByTestId('lcp-attribution')).toContainText('LCP phases')
        await expect(panel.getByTestId('lcp-attribution')).toContainText('Complete timing evidence')
        await expect(panel.getByTestId('lcp-attribution')).not.toContainText('synthetic-private')
        await panel.getByRole('button', { name: 'Close performance report', exact: true }).click()
        await page.evaluate(() => history.pushState({}, '', '/soft-route'))
        const routed = await call('browser_performance', args) as BrowserPerformanceReport
        expect(routed.metrics.LCP!.lcpAttribution).toMatchObject({ status: 'unsupported', reason: 'unsupported-navigation', candidateTimeMs: null, resourceLoadDurationMs: null })
        expect(routed.metrics.LCP!.lcpAttribution).not.toHaveProperty('resourceUrl')
        await page.evaluate(url => history.pushState({}, '', url), url)
        const returned = await call('browser_performance', args) as BrowserPerformanceReport
        expect(returned.metrics.LCP!.lcpAttribution).toMatchObject({ status: 'unsupported', reason: 'unsupported-navigation', candidateTimeMs: null })
        expect(returned.metrics.LCP!.lcpAttribution).not.toHaveProperty('resourceUrl')
        await page.goto(`http://127.0.0.1:${address.port}/?mode=text&visit=next`)
        let next: BrowserPerformanceReport | undefined
        await expect.poll(async () => {
          next = await call('browser_performance', args) as BrowserPerformanceReport
          return next.metrics.LCP?.lcpAttribution?.target
        }).toBe('#text')
        expect(next!.metrics.LCP!.lcpAttribution).toMatchObject({ status: 'complete', resourceTiming: 'not-applicable' })
        expect(next!.metrics.LCP!.lcpAttribution).not.toHaveProperty('resourceUrl')
        await page.evaluate(() => {
          const original = location.href
          history.pushState({}, '', '/between-measurements')
          history.replaceState({}, '', original)
        })
        const roundtrip = await call('browser_performance', args) as BrowserPerformanceReport
        expect(roundtrip.metrics.LCP!.lcpAttribution).toMatchObject({ status: 'unsupported', reason: 'unsupported-navigation', candidateTimeMs: null })
        expect(roundtrip.metrics.LCP!.lcpAttribution).not.toHaveProperty('target')
        await page.goto(`http://127.0.0.1:${address.port}/?mode=text&visit=before-first`)
        await page.evaluate(() => {
          const original = location.href
          history.pushState({}, '', '/before-first-measurement')
          history.replaceState({}, '', original)
        })
        let first: BrowserPerformanceReport | undefined
        await expect.poll(async () => {
          first = await call('browser_performance', args) as BrowserPerformanceReport
          return first.metrics.LCP !== null
        }).toBe(true)
        expect(first!.metrics.LCP!.lcpAttribution).toMatchObject({ status: 'unsupported', reason: 'unsupported-navigation', candidateTimeMs: null })
        expect(first!.metrics.LCP!.lcpAttribution).not.toHaveProperty('target')
        await appWindow.evaluate(`window.hronaut.setTabAgentPaused(${JSON.stringify(state.activeTabId)}, true)`)
        const paused = await client.callTool({ name: 'browser_performance', arguments: args }) as CallToolResult
        expect(paused.isError).toBe(true)
        expect(paused.content.filter(part => part.type === 'text').map(part => part.text).join(' ')).toContain('paused')
        await appWindow.evaluate(`window.hronaut.setTabAgentPaused(${JSON.stringify(state.activeTabId)}, false)`)
        const foreign = new Client({ name: 'foreign-lcp-fixture', version: '1' })
        try {
          await foreign.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), { requestInit: { headers: { authorization: `Bearer ${mcpToken}` } } }))
          const denied = await foreign.callTool({ name: 'browser_performance', arguments: args }) as CallToolResult
          expect(denied.isError).toBe(true)
          expect(denied.content.filter(part => part.type === 'text').map(part => part.text).join(' ')).toContain('not authorized')
        } finally { await foreign.close() }
      }
    }
  } finally {
    await testInfo.attach('lcp-attribution', { body: JSON.stringify(observations, null, 2), contentType: 'application/json' })
    await client.close()
    await closeFixtureServer(server)
  }
})
