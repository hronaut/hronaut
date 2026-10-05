import { createServer } from 'node:http'
import type { Page } from '@playwright/test'
import { formatReproAsPlaywright } from '../../src/shared/repro-export.js'
import type { BrowserReproRecording, HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

test('requires an outcome checkpoint after the last recorded action before an export can pass', async ({ appWindow, electronApp }) => {
  let fixed = false
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' }).end(`<title>Final outcome fixture</title><p>Ready</p><button onclick="document.querySelector('p').textContent='${fixed ? 'Created' : 'Failed'}'">Create</button>`)
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
    await expect(page.locator('p')).toHaveText('Ready')
    const start = await appWindow.evaluate(tabId => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('start', tabId), tabId)
    const checkpoint = (text: string) => appWindow.evaluate(({ tabId, context, text }) => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('checkpoint', tabId, {
      context, selector: 'p', condition: 'text', text, reviewed: true
    }), { tabId, context: start.checkpointContext!, text })
    await checkpoint('Ready')
    await page.getByRole('button', { name: 'Create', exact: true }).click()
    await expect(page.locator('p')).toHaveText('Failed')
    await expect.poll(() => appWindow.evaluate(tabId => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('get', tabId).then(result => result.steps.at(-1)?.kind), tabId)).toBe('click')
    const unmarked = await appWindow.evaluate(tabId => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('get', tabId), tabId)
    const marked = await checkpoint('Created')
    expect(marked.steps.at(-1)?.expectation?.observedMatch).toBe(false)
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
    await expect(run(unmarked)).rejects.toThrow('TODO: replace this line with an assertion')
    await expect(page.locator('p')).toHaveText('Failed')
    await expect(run(marked)).rejects.toThrow('toHaveText')
    fixed = true
    await run(marked)
    await expect(page.locator('p')).toHaveText('Created')
  } finally { await closeFixtureServer(server) }
})
