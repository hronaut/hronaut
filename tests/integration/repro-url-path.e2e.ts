import { createServer } from 'node:http'
import type { Page } from '@playwright/test'
import { formatReproAsPlaywright } from '../../src/shared/repro-export.js'
import type { BrowserReproRecording, HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

test('records reviewed pathname intent and exports a failing then corrected redirect outcome', async ({ appWindow, electronApp }) => {
  let fixed = false
  const server = createServer((request, response) => {
    if (fixed && request.url?.startsWith('/outcome')) response.writeHead(302, { location: '/complete?token=private-path-canary#private-path-canary' }).end()
    else response.writeHead(200, { 'content-type': 'text/html' }).end('<title>Path fixture</title><p>Outcome</p>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const url = `http://127.0.0.1:${address.port}/outcome`
  try {
    const state = await appWindow.evaluate(url => (window as unknown as { hronaut: HronautApi }).hronaut.newTab({ url, active: true }), url)
    const tabId = state.activeTabId!
    await expect.poll(() => electronApp.context().pages().some(page => page.url() === url)).toBe(true)
    const page = electronApp.context().pages().find(page => page.url() === url)!
    const get = () => appWindow.evaluate(tabId => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('get', tabId), tabId)
    const start = await appWindow.evaluate(tabId => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('start', tabId), tabId)
    const checkpoint = (context: string) => appWindow.evaluate(({ tabId, context }) => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('checkpoint', tabId, {
      context, condition: 'urlPath', path: '/complete', reviewed: true
    }), { tabId, context })
    const expected = await checkpoint(start.checkpointContext!)
    expect(expected.formatVersion).toBe(4)
    expect(expected.steps.at(-1)?.expectation).toEqual({ condition: 'urlPath', path: '/complete', observedMatch: false })
    expect(expected.steps.at(-1)).not.toHaveProperty('target')
    await appWindow.evaluate(tabId => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('stop', tabId), tabId)
    const run = (recording: BrowserReproRecording): Promise<void> => {
      const code = formatReproAsPlaywright({ ...recording, active: false }).replace(/^import[^\n]*\n/u, '')
      let execution: Promise<void> | undefined
      new Function('test', 'expect', code)(
        (_title: string, body: (context: { page: Page }) => Promise<void>) => { execution = body({ page }) }, expect.configure({ timeout: 500 })
      )
      if (!execution) throw new Error('Export did not register a test')
      return execution
    }
    await expect(run(expected)).rejects.toThrow('toHaveURL')
    fixed = true
    await run(expected)
    const restarted = await appWindow.evaluate(tabId => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('start', tabId), tabId)
    await page.evaluate(() => { history.pushState({}, '', '/complete?token=private-path-canary#private-path-canary') })
    await expect.poll(async () => (await get()).checkpointContext).not.toBe(restarted.checkpointContext)
    await expect(checkpoint(restarted.checkpointContext!)).rejects.toThrow('context changed')
    const current = await get()
    const matched = await checkpoint(current.checkpointContext!)
    expect(matched.steps.at(-1)?.expectation).toEqual({ condition: 'urlPath', path: '/complete', observedMatch: true })
    expect(JSON.stringify(matched)).not.toContain('private-path-canary')
    await appWindow.evaluate(tabId => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('stop', tabId), tabId)
  } finally { await closeFixtureServer(server) }
})
