import { createServer } from 'node:http'
import type { Page } from '@playwright/test'
import { formatReproAsPlaywright } from '../../src/shared/repro-export.js'
import type { BrowserReproRecording, HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

test('records bounded light-DOM counts and exports a failing then corrected final outcome', async ({ appWindow, electronApp }) => {
  let fixed = false
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' }).end(`<title>Count fixture</title><ul><li>Same</li><li hidden>Same</li></ul><section><input value="private-count-canary"></section><article contenteditable><p>Draft</p></article><iframe></iframe><button onclick="${fixed ? "document.querySelector('ul').append(document.createElement('li'))" : ''}">Create</button>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const url = `http://127.0.0.1:${address.port}/`
  try {
    const state = await appWindow.evaluate(url => (window as unknown as { hronaut: HronautApi }).hronaut.newTab({ url, active: true }), url)
    const tabId = state.activeTabId!
    await expect.poll(() => electronApp.context().pages().some(page => page.url() === url)).toBe(true)
    const page = electronApp.context().pages().find(page => page.url() === url)!
    await expect(page.locator('li')).toHaveCount(2)
    const get = () => appWindow.evaluate(tabId => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('get', tabId), tabId)
    const start = await appWindow.evaluate(tabId => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('start', tabId), tabId)
    expect(start.formatVersion).toBe(2)
    const checkpoint = (selector: string, count: number, context = start.checkpointContext!) => appWindow.evaluate(({ tabId, context, selector, count }) => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('checkpoint', tabId, {
      context, selector, condition: 'count', count, reviewed: true
    }), { tabId, context, selector, count })
    expect((await checkpoint('ul > li', 2)).steps.at(-1)?.expectation).toEqual({ condition: 'count', count: 2, observedMatch: true })
    expect((await checkpoint('aside', 0)).steps.at(-1)?.expectation?.observedMatch).toBe(true)
    expect((await checkpoint('section', 1)).steps.at(-1)?.expectation?.observedMatch).toBe(true)
    const before = await get()
    for (const selector of ['input', 'iframe', 'article > p', 'li[value="private-count-canary"]']) {
      await expect(checkpoint(selector, 0)).rejects.toThrow()
      expect((await get()).steps).toEqual(before.steps)
    }
    await page.getByRole('button', { name: 'Create', exact: true }).click()
    await expect.poll(async () => (await get()).steps.at(-1)?.kind).toBe('click')
    const trailingAction = await get()
    const finalCount = await checkpoint('ul > li', 3)
    expect(finalCount.formatVersion).toBe(3)
    expect(finalCount.steps.at(-1)?.expectation).toEqual({ condition: 'count', count: 3, observedMatch: false })
    expect(JSON.stringify(finalCount)).not.toContain('private-count-canary')
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
    await expect(run(trailingAction)).rejects.toThrow('TODO: replace this line')
    await expect(run(finalCount)).rejects.toThrow('toHaveCount')
    fixed = true
    await run(finalCount)
    await expect(page.locator('li')).toHaveCount(3)

    const restarted = await appWindow.evaluate(tabId => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('start', tabId), tabId)
    await expect(checkpoint('li', 3)).rejects.toThrow('context changed')
    expect((await get()).steps).toEqual(restarted.steps)
    await page.evaluate(() => { document.body.innerHTML = '<ul>' + '<li></li>'.repeat(501) + '</ul>' })
    await expect(checkpoint('ul > li', 500, restarted.checkpointContext)).rejects.toThrow('500 matches')
    expect((await get()).steps).toEqual(restarted.steps)
    await page.evaluate(() => { document.body.innerHTML = '<div></div>'.repeat(2001) })
    await expect(checkpoint('aside', 0, restarted.checkpointContext)).rejects.toThrow('2000 visited elements')
    expect((await get()).steps).toEqual(restarted.steps)
    await appWindow.evaluate(tabId => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('stop', tabId), tabId)
  } finally { await closeFixtureServer(server) }
})
