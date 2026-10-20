import { createServer } from 'node:http'
import type { HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

test('a held Delete on a tab closes only that tab', async ({ appWindow }) => {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' }).end(`<title>Held Delete page ${request.url!.slice(1)}</title><p>Page</p>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const openTitles = () => appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState()
    .then(state => state.tabs.map(tab => tab.title).filter(title => title.startsWith('Held Delete page'))))
  try {
    for (let index = 1; index <= 5; index += 1) {
      const url = `http://127.0.0.1:${address.port}/${index}`
      await appWindow.evaluate(url => (window as unknown as { hronaut: HronautApi }).hronaut.newTab({ url, active: true }), url)
      await expect.poll(() => appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState()
        .then(state => state.tabs.find(tab => tab.active)?.title))).toBe(`Held Delete page ${index}`)
    }
    const tabs = appWindow.getByRole('tab', { name: /^Held Delete page \d/ })
    await expect(tabs).toHaveCount(5)
    const second = appWindow.getByRole('tab', { name: /^Held Delete page 2/ })
    const third = appWindow.getByRole('tab', { name: /^Held Delete page 3/ })

    await second.focus()
    await expect(second).toBeFocused()
    await appWindow.keyboard.down('Delete')
    await expect(tabs).toHaveCount(4)
    // The closed tab hands the focus to the tab after it, and each repeat of the held key used to close that one too.
    for (let repeat = 0; repeat < 6; repeat += 1) {
      await appWindow.waitForTimeout(50)
      await expect(third).toBeFocused()
      await appWindow.keyboard.down('Delete')
    }
    await appWindow.keyboard.up('Delete')
    await expect(tabs).toHaveCount(4)
    expect(await openTitles()).toEqual(['Held Delete page 1', 'Held Delete page 3', 'Held Delete page 4', 'Held Delete page 5'])

    // A new press still closes the focused tab.
    await appWindow.keyboard.press('Delete')
    await expect(tabs).toHaveCount(3)
    await expect.poll(openTitles).toEqual(['Held Delete page 1', 'Held Delete page 4', 'Held Delete page 5'])
  } finally {
    await closeFixtureServer(server)
  }
})
