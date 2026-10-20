import { createServer } from 'node:http'
import type { HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

test('a held Escape in a Tab search page preview goes back to the tabs and keeps the search', async ({ appWindow }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' }).end('<title>Held Escape preview</title><p>preview</p>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  try {
    await appWindow.evaluate(url => (window as unknown as { hronaut: HronautApi }).hronaut.newTab({ url, active: true }),
      `http://127.0.0.1:${address.port}/`)
    await expect.poll(() => appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState()
      .then(state => state.tabs.find(tab => tab.active)?.title))).toBe('Held Escape preview')
    await appWindow.getByRole('button', { name: 'Search tabs' }).click()
    const panel = appWindow.getByRole('dialog', { name: 'Tabs' })
    const search = panel.getByRole('searchbox', { name: 'Search tabs' })
    await search.fill('Held Escape')
    await search.press('Alt+Enter')
    await expect(panel.getByRole('region', { name: 'Page preview' })).toBeVisible()

    // The first press goes back to the tabs. Its repeats used to close Tab search, and then to clear the search.
    await appWindow.keyboard.down('Escape')
    await appWindow.keyboard.down('Escape')
    await appWindow.keyboard.down('Escape')
    await appWindow.keyboard.up('Escape')
    await expect(panel.getByRole('region', { name: 'Page preview' })).toBeHidden()
    await expect(panel).toBeVisible()
    await expect(search).toHaveValue('Held Escape')
  } finally {
    await closeFixtureServer(server)
  }
})
