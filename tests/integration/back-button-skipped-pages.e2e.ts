import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

// Chromium skips, on Back, a page that moved on by script without the person's click. The trace's snapshots would give
// every page that click, so the page would not be skipped.
test.use({ trace: 'off' })

async function listen(server: Server): Promise<string> {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

test('turns Back off while every earlier page is one Chromium skips, as Chrome does', async ({ appWindow }) => {
  // Back stayed on and did nothing.
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' })
    const hop = `<script>addEventListener('load', () => setTimeout(() => { location.href = '/landing' }, 200))</script>`
    if (request.url === '/hop') response.end(`<title>Hop</title>${hop}`)
    else response.end(`<title>${request.url}</title>`)
  })
  const site = await listen(server)
  try {
    const tab = await appWindow.evaluate(async url => (await (window as unknown as { hronaut: HronautApi }).hronaut
      .newTab({ url, active: true })).activeTabId!, `${site}/hop`)
    const shown = (path: string) => expect.poll(() => appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut
      .getState().then(state => state.tabs.find(entry => entry.id === id)).then(entry => !entry?.loading && entry?.url), tab), { timeout: 10_000 })
      .toBe(`${site}${path}`)
    const back = appWindow.getByRole('button', { name: 'Back', exact: true })
    await shown('/landing')
    await expect(back).toBeDisabled()

    await appWindow.evaluate(({ id, url }) => (window as unknown as { hronaut: HronautApi }).hronaut
      .navigate({ tabId: id, url }), { id: tab, url: `${site}/next` })
    await shown('/next')
    await expect(back).toBeEnabled()
    await back.click()
    await shown('/landing')
    await expect(back).toBeDisabled()
  } finally {
    await closeFixtureServer(server)
  }
})
