import { createServer } from 'node:http'
import type { Page } from '@playwright/test'
import { formatReproAsPlaywright } from '../../src/shared/repro-export.js'
import type { HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

test('stops a genuinely truncated Repro export before replay despite a passing checkpoint', async ({ appWindow, electronApp }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end('<!doctype html><title>Truncated recording</title><p id="ready">Ready</p>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const url = `http://127.0.0.1:${address.port}/`
  let tabId: string | undefined
  try {
    const state = await appWindow.evaluate(url => (window as unknown as { hronaut: HronautApi }).hronaut.newTab({ url, active: true }), url)
    tabId = state.activeTabId!
    await expect.poll(() => electronApp.context().pages().some(page => page.url() === url)).toBe(true)
    const page = electronApp.context().pages().find(page => page.url() === url)!
    await expect(page.locator('#ready')).toHaveText('Ready')
    const initial = await appWindow.evaluate(tabId => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('start', tabId), tabId)
    await appWindow.evaluate(({ tabId, context }) => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('checkpoint', tabId, {
      context, selector: '#ready', condition: 'text', text: 'Ready', reviewed: true
    }), { tabId, context: initial.checkpointContext! })
    // Real same-document navigations fill the recorder and then drop a step.
    // Read back each retained count to avoid relying on event timing or delays.
    for (let index = 1; index <= 199; index += 1) {
      await page.evaluate(index => history.pushState({}, '', `?step=${index}`), index)
      await expect.poll(() => appWindow.evaluate(tabId => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('get', tabId).then(report => report.stepCount), tabId))
        .toBe(Math.min(200, index + 2))
    }
    await expect.poll(() => appWindow.evaluate(tabId => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('get', tabId).then(report => report.truncated), tabId)).toBe(true)
    const recording = await appWindow.evaluate(tabId => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('stop', tabId), tabId)
    expect(recording).toMatchObject({ active: false, stepCount: 200, truncated: true })
    expect(recording.steps.find(step => step.kind === 'expect')?.expectation?.observedMatch).toBe(true)
    const exported = formatReproAsPlaywright(recording)
    let replay: Promise<void> | undefined
    let requests = 0
    const countRequest = () => { requests += 1 }
    page.on('request', countRequest)
    try {
      new Function('test', 'expect', exported.replace(/^import[^\n]*\n/u, ''))(
        (_name: string, body: (context: { page: Page }) => Promise<void>) => { replay = body({ page }) }, expect
      )
      await expect(replay).rejects.toThrow('TODO: Complete the truncated recording before running this test')
      expect(requests).toBe(0)
    } finally { page.off('request', countRequest) }
  } finally {
    if (tabId) await appWindow.evaluate(tabId => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('clear', tabId), tabId).catch(() => undefined)
    await closeFixtureServer(server)
  }
})
