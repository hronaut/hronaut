import { createServer, type ServerResponse } from 'node:http'
import type { HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

// Find opened while the next page is still loading searches the page in view. Once the next page replaces it, Find
// closes, so the old page's matches are not shown for the new page.

test('closes Find opened while the next page loaded once that page replaces the one it searched', async ({ appWindow }) => {
  let holdNext = false
  const heldNext: ServerResponse[] = []
  let nextRequests = 0
  const server = createServer((request, response) => {
    if (request.url === '/next' && holdNext) {
      nextRequests += 1
      heldNext.push(response)
      return
    }
    response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' })
    response.end(`<!doctype html><title>${request.url}</title><p>needle needle</p><a id="next" href="/next">Next</a>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const base = `http://127.0.0.1:${address.port}`
  try {
    const tabId = await appWindow.evaluate(async url => (
      await (window as unknown as { hronaut: HronautApi }).hronaut.newTab({ url, active: true })
    ).activeTabId!, `${base}/first`)
    await expect.poll(() => appWindow.evaluate(async () => (
      (await (window as unknown as { hronaut: HronautApi }).hronaut.getState()).tabs.find(tab => tab.active)?.loading
    ))).toBe(false)

    // The person follows a link to a page that takes a while to answer, and searches the page still in view.
    holdNext = true
    await appWindow.evaluate(({ tabId, url }) => {
      void (window as unknown as { hronaut: HronautApi }).hronaut.navigate({ tabId, url })
    }, { tabId, url: `${base}/next` })
    await expect.poll(() => nextRequests).toBeGreaterThan(0)
    await appWindow.getByRole('button', { name: 'Find in page', exact: true }).click()
    const bar = appWindow.getByRole('search', { name: 'Find in page' })
    await bar.getByRole('searchbox', { name: 'Find text' }).fill('needle')
    await expect(bar.locator('.find-count')).toHaveText('1 / 2')

    // The next page arrives and replaces it.
    holdNext = false
    for (const response of heldNext.splice(0)) {
      response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' })
      response.end('<!doctype html><title>/next</title><p>needle</p>')
    }
    await expect.poll(() => appWindow.evaluate(async () => (
      (await (window as unknown as { hronaut: HronautApi }).hronaut.getState()).tabs.find(tab => tab.active)?.url
    ))).toBe(`${base}/next`)
    await expect(bar).toBeHidden()
  } finally {
    holdNext = false
    for (const response of heldNext.splice(0)) response.end()
    await closeFixtureServer(server)
  }
})
