import { createServer } from 'node:http'
import type { HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

// History's live list and the removal's answer race, and the focus went to Search on about a quarter of the presses,
// so the test removes entries one after another to catch it on most runs.
const ENTRIES = 8

test('Remove in History gives the focus to the next entry\'s Remove', async ({ appWindow }) => {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' }).end(`<title>Focus page ${request.url!.slice(1)}</title><p>Page</p>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  try {
    for (let index = 1; index <= ENTRIES; index += 1) {
      const url = `http://127.0.0.1:${address.port}/${index}`
      await appWindow.evaluate(url => (window as unknown as { hronaut: HronautApi }).hronaut.newTab({ url, active: true }), url)
      await expect.poll(() => appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState()
        .then(state => state.tabs.find(tab => tab.active)?.title))).toBe(`Focus page ${index}`)
    }
    await appWindow.getByRole('button', { name: 'Browsing history' }).click()
    const history = appWindow.getByRole('dialog', { name: 'Browsing history' })
    const removes = history.getByRole('button', { name: /^Remove Focus page \d from history$/ })
    await expect(removes).toHaveCount(ENTRIES)
    const search = history.getByRole('searchbox', { name: 'Search browsing history' })

    await removes.first().focus()
    for (let left = ENTRIES - 1; left >= 1; left -= 1) {
      await appWindow.keyboard.press('Enter')
      await expect(removes).toHaveCount(left)
      // History's live list arrives before the removal's answer, and the focus used to go to Search from there.
      await expect(removes.first()).toBeFocused()
      await expect(search).not.toBeFocused()
    }
  } finally {
    await closeFixtureServer(server)
  }
})
