import { createServer } from 'node:http'
import type { HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'
import { activeTabTitle, activeTabUrl, openTabsView } from './home-tabs-view.js'

test('a held Escape in a Tabs view page preview goes back to the tabs and keeps the search; the next goes back to the page', async ({ appWindow, electronApp }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' }).end('<title>Held Escape preview</title><p>preview</p>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  try {
    await appWindow.evaluate(url => (window as unknown as { hronaut: HronautApi }).hronaut.newTab({ url, active: true }),
      `http://127.0.0.1:${address.port}/`)
    await expect.poll(() => activeTabTitle(appWindow)).toBe('Held Escape preview')
    const { home, view, search } = await openTabsView(appWindow, electronApp)
    await search.fill('Held Escape')
    await search.press('Alt+Enter')
    const preview = home.getByRole('region', { name: 'Page preview' })
    await expect(preview).toBeVisible()

    // The first press goes back to the tabs. Its repeats would leave Home for the page shown before it.
    await home.keyboard.down('Escape')
    await home.keyboard.down('Escape')
    await home.keyboard.down('Escape')
    await home.keyboard.up('Escape')
    await expect(preview).toBeHidden()
    await expect(view).toBeVisible()
    await expect(search).toHaveValue('Held Escape')
    await expect(search).toBeFocused()
    expect(await activeTabUrl(appWindow)).toMatch(/^hronaut:\/\/home/u)

    await home.keyboard.press('Escape')
    await expect.poll(() => activeTabTitle(appWindow)).toBe('Held Escape preview')
  } finally {
    await closeFixtureServer(server)
  }
})
