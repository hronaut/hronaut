import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { BrowserPerformanceReport } from '../../src/shared/types.js'
import { test, expect, text } from './capability-fixtures.js'

const fixtureScript = `document.body.innerHTML = '<button style="position:fixed;left:10px;top:10px;width:150px;height:60px">Next route</button><h1 style="margin-top:100px">Initial route</h1>'; let route = 0; document.querySelector('button').onclick = () => { route++; history.pushState({}, '', '/route-' + (route % 2) + '?token=synthetic-route-secret'); setTimeout(() => { document.querySelector('h1').textContent = 'Route content ' + route; }, 250); }; void 0;`

test('measures distinct SPA visits without replacing document metrics or leaking route secrets', async ({ capabilities, electronApp, appWindow }, testInfo) => {
  const { client, tabId, fixtureUrl } = capabilities
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: { tabId, ...args } }) as CallToolResult
    expect(result.isError, text(result)).not.toBe(true)
    return JSON.parse(text(result))
  }
  const measure = (args = {}) => call('browser_performance', { settleMs: 0, ...args }) as Promise<BrowserPerformanceReport>
  const id = await electronApp.evaluate(async ({ webContents }, { url, script }) => {
    const contents = webContents.getAllWebContents().find(entry => entry.getURL() === url)!
    await contents.executeJavaScript(script)
    return contents.id
  }, { url: fixtureUrl, script: fixtureScript })
  const click = () => electronApp.evaluate(({ webContents }, id) => {
    const contents = webContents.fromId(id)!
    contents.sendInputEvent({ type: 'mouseDown', x: 80, y: 40, button: 'left', clickCount: 1 })
    contents.sendInputEvent({ type: 'mouseUp', x: 80, y: 40, button: 'left', clickCount: 1 })
  }, id)
  // The document observer is asynchronous. Establish its real painted candidate
  // before the first click finalizes document LCP and starts SPA attribution.
  await expect.poll(async () => (await measure()).metrics.LCP?.value ?? null).not.toBeNull()
  const initial = await measure({ action: 'set-baseline' })
  expect(initial.softNavigations).toMatchObject({ status: 'awaiting-navigation', historyComplete: false, navigations: [] })
  const ids: string[] = []
  const urls: string[] = []
  let report = initial
  for (let index = 0; index < 3; index++) {
    await click()
    await expect.poll(async () => {
      report = await measure()
      const current = report.softNavigations?.navigations.at(-1)
      return current && !ids.includes(current.navigationId) && current.metrics.LCP !== null
    }).toBe(true)
    const routes = report.softNavigations!.navigations
    const current = routes.at(-1)!
    ids.push(current.navigationId)
    urls.push(current.url)
    expect(current.coverage).toBe('observed')
    expect(current.metrics.LCP!.value).toBeGreaterThan(200)
    expect(current.metrics.INP).toBeNull()
    expect(current.navigationType).toBe('soft-navigation')
    expect(routes.length).toBe(Math.min(index + 1, 2))
    expect(report.comparison?.metrics.find(metric => metric.name === 'LCP')?.baselineValue).toBe(initial.metrics.LCP?.value ?? null)
    expect(report.metrics.LCP?.navigationType).not.toBe('soft-navigation')
    expect(JSON.stringify(report.softNavigations)).not.toMatch(/synthetic-route-secret|token=|entries|attribution|Route content/)
  }
  expect(new Set(ids).size).toBe(3)
  expect(urls[0]).toBe(urls[2])
  expect(report.softNavigations!.truncated).toBe(true)
  await electronApp.evaluate(async ({ webContents }, id) => {
    await webContents.fromId(id)!.executeJavaScript("history.pushState({}, '', '/url-only?token=synthetic-route-secret'); void 0")
  }, id)
  const urlOnly = await measure({ settleMs: 100 })
  expect(urlOnly.softNavigations!.navigations.map(route => route.navigationId)).toEqual(ids.slice(-2))
  expect(urlOnly.metrics.LCP?.lcpAttribution?.reason).toBe('unsupported-navigation')
  await capabilities.openPageTool('Performance')
  const section = appWindow.getByTestId('soft-navigation-vitals')
  await expect(section).toBeVisible()
  await expect(section).toContainText('Route Web Vitals')
  await expect(section).toContainText('/route-1')
  await expect(section).not.toContainText('synthetic-route-secret')
  await section.screenshot({ path: testInfo.outputPath('soft-navigation-vitals.png') })
  await call('browser_navigate', { url: fixtureUrl })
  const reloaded = await measure()
  expect(reloaded.softNavigations).toMatchObject({ status: 'awaiting-navigation', navigations: [], truncated: false })
  expect(reloaded.baseline?.measuredAt).toBe(initial.measuredAt)
})

test('reports late attachment and unsupported runtime explicitly', async ({ capabilities, electronApp }) => {
  const { client, tabId, fixtureUrl } = capabilities
  const id = await electronApp.evaluate(async ({ webContents }, { url, script }) => {
    const contents = webContents.getAllWebContents().find(entry => entry.getURL() === url)!
    await contents.executeJavaScript(script)
    contents.sendInputEvent({ type: 'mouseDown', x: 80, y: 40, button: 'left', clickCount: 1 })
    contents.sendInputEvent({ type: 'mouseUp', x: 80, y: 40, button: 'left', clickCount: 1 })
    return contents.id
  }, { url: fixtureUrl, script: fixtureScript })
  await expect.poll(() => electronApp.evaluate(({ webContents }, id) => webContents.fromId(id)!.executeJavaScript("performance.getEntriesByType('soft-navigation').length"), id)).toBe(1)
  const result = await client.callTool({ name: 'browser_performance', arguments: { tabId, settleMs: 100 } }) as CallToolResult
  expect(result.isError, text(result)).not.toBe(true)
  const report = JSON.parse(text(result)) as BrowserPerformanceReport
  expect(report.softNavigations).toMatchObject({ status: 'incomplete', historyComplete: false })
  expect(report.softNavigations!.navigations[0]).toMatchObject({ coverage: 'incomplete' })
  await client.callTool({ name: 'browser_navigate', arguments: { tabId, url: fixtureUrl } })
  await electronApp.evaluate(({ webContents }, id) => webContents.fromId(id)!.executeJavaScriptInIsolatedWorld(1002, [{ code: 'globalThis.PerformanceSoftNavigation = undefined; void 0;' }]), id)
  const unsupported = await client.callTool({ name: 'browser_performance', arguments: { tabId, settleMs: 0 } }) as CallToolResult
  expect(unsupported.isError, text(unsupported)).not.toBe(true)
  expect(JSON.parse(text(unsupported)).softNavigations).toMatchObject({ status: 'unsupported', navigations: [] })
})
