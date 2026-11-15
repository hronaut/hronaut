import type { Page } from '@playwright/test'
import type { HronautApi } from '../../src/shared/types.js'
import { expect, test } from './capability-fixtures.js'

function application(appWindow: Page, tabId: string) {
  return appWindow.evaluate(async id => (await (window as unknown as { hronaut: HronautApi }).hronaut.getState()).tabs.find(t => t.id === id)!.networkConditionState!.application, tabId)
}

// Chromium can fail a request a page starts while Fetch.enable is sent again. The rules refresh 250 ms after a request
// uses one up, just when a page tends to make its next requests, so that refresh must not send it.
test('page requests started while a used-up rule refreshes away all reach their destination', async ({ capabilities, appWindow, electronApp }) => {
  const { tabId, fixtureUrl, fixtureOrigin } = capabilities
  await appWindow.evaluate(async ({ tabId, fixtureOrigin }) => {
    const api = (window as unknown as { hronaut: HronautApi }).hronaut
    await api.addNetworkRoute(tabId, { urlPattern: `${fixtureOrigin}/used-up-rule`, times: 1, response: { status: 409, body: 'one-time mock' } })
    await api.addNetworkRoute(tabId, { urlPattern: `${fixtureOrigin}/kept-rule`, abort: 'Failed' })
  }, { tabId, fixtureOrigin })
  await expect.poll(() => application(appWindow, tabId)).toBe('confirmed')
  // The page uses up the rule, then keeps starting requests for 600 ms, across the refresh.
  const result = await electronApp.evaluate(({ webContents }, fixtureUrl) => webContents.getAllWebContents().find(p => p.getURL() === fixtureUrl)!.executeJavaScript(`
    fetch('/used-up-rule', { cache: 'no-store' }).then(response => response.status).then(status => new Promise(done => {
      const started = performance.now(), requests = []
      const next = () => {
        requests.push(fetch('/after-used-up?' + requests.length, { cache: 'no-store' }).then(() => true, () => false))
        if (performance.now() - started < 600) setTimeout(next, 0)
        else Promise.all(requests).then(reached => done({ status, started: reached.length, failed: reached.filter(ok => !ok).length }))
      }
      next()
    }))`), fixtureUrl) as { status: number; started: number; failed: number }
  expect(result.status).toBe(409)
  expect(result.started).toBeGreaterThan(50)
  expect(result.failed).toBe(0)
  await expect.poll(() => application(appWindow, tabId)).toBe('confirmed')
  // The kept rule still applies.
  expect(await electronApp.evaluate(({ webContents }, fixtureUrl) => webContents.getAllWebContents().find(p => p.getURL() === fixtureUrl)!.executeJavaScript("fetch('/kept-rule').then(() => 'reached', () => 'failed')"), fixtureUrl)).toBe('failed')
})
