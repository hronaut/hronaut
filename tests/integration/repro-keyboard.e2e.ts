import { createServer } from 'node:http'
import type { Page } from '@playwright/test'
import { formatReproAsPlaywright } from '../../src/shared/repro-export.js'
import type { HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

test('replays native checkbox and radio Space activation without replacement inputs', async ({ appWindow, electronApp }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<title>Keyboard reproduction</title><label>Confirm<input id="checkbox" type="checkbox" value="private-checkbox-canary"></label><label>Option<input id="radio" type="radio" value="private-radio-canary"></label>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No fixture port')
  const url = `http://127.0.0.1:${address.port}/`
  try {
    const state = await appWindow.evaluate(url => (window as unknown as { hronaut: HronautApi }).hronaut.newTab({ url, active: true }), url)
    const tabId = state.activeTabId!
    await expect.poll(() => electronApp.context().pages().some(page => page.url() === url)).toBe(true)
    const page = electronApp.context().pages().find(page => page.url() === url)!
    await expect(page.locator('#checkbox')).toBeVisible()
    const initial = await appWindow.evaluate(tabId => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('start', tabId), tabId)
    for (const selector of ['#checkbox', '#radio']) {
      await page.locator(selector).focus()
      await electronApp.evaluate(({ webContents }, url) => {
        const contents = webContents.getAllWebContents().find(contents => contents.getURL() === url)!
        contents.focus()
        contents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' })
        contents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' })
      }, url)
      await expect(page.locator(selector)).toBeChecked()
      // A checkpoint queues behind the recorded key and observes the native result.
      const report = await appWindow.evaluate(({ tabId, context, selector }) => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('checkpoint', tabId, { context, selector, condition: 'checked', reviewed: true }), { tabId, context: initial.checkpointContext!, selector })
      expect(report.steps.at(-1)?.expectation?.observedMatch).toBe(true)
    }
    const recording = await appWindow.evaluate(tabId => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('stop', tabId), tabId)
    expect(recording.steps.filter(step => step.kind === 'key').map(step => step.key)).toEqual(['Space', 'Space'])
    expect(recording.steps.some(step => step.kind === 'input')).toBe(false)
    const exported = formatReproAsPlaywright(recording)
    expect(exported).not.toContain('HRONAUT_REPRO_INPUT_')
    expect(JSON.stringify(recording) + exported).not.toContain('private-')
    let execution: Promise<void> | undefined
    const register = (_title: string, body: (context: { page: Page }) => Promise<void>) => { execution = body({ page }) }
    new Function('test', 'expect', exported.replace(/^import .*\n/, ''))(register, expect)
    if (!execution) throw new Error('Generated test did not register')
    await execution
    await expect(page.locator('#checkbox')).toBeChecked()
    await expect(page.locator('#radio')).toBeChecked()
  } finally { await closeFixtureServer(server) }
})
