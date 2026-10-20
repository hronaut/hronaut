import { createServer } from 'node:http'
import type { HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

test('a held Enter on a tab\'s close button in Tab search closes that tab and stays there', async ({ appWindow }) => {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' }).end(`<title>Held search page ${request.url!.slice(1)}</title><p>Page</p>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const state = () => appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState())
  const openTitles = () => state().then(current => current.tabs.map(tab => tab.title).filter(title => title.startsWith('Held search page')))
  try {
    for (let index = 1; index <= 3; index += 1) {
      const url = `http://127.0.0.1:${address.port}/${index}`
      await appWindow.evaluate(url => (window as unknown as { hronaut: HronautApi }).hronaut.newTab({ url, active: true }), url)
      await expect.poll(() => state().then(current => current.tabs.find(tab => tab.active)?.title)).toBe(`Held search page ${index}`)
    }
    await appWindow.getByRole('button', { name: 'Search tabs' }).click()
    const panel = appWindow.getByRole('dialog', { name: 'Tabs' })
    const search = panel.getByRole('searchbox', { name: 'Search tabs' })
    const close = panel.getByRole('button', { name: 'Close Held search page 2', exact: true })
    await close.focus()
    await expect(close).toBeFocused()

    await appWindow.keyboard.down('Enter')
    await expect.poll(openTitles).toEqual(['Held search page 1', 'Held search page 3'])
    // Closing the tab puts the focus in the search field, where each repeat of the held key used to open the selected
    // result, which closed Tab search, and then open Tab search again from the toolbar.
    for (let repeat = 0; repeat < 5; repeat += 1) {
      await appWindow.waitForTimeout(50)
      await expect(search).toBeFocused()
      await appWindow.keyboard.down('Enter')
    }
    await appWindow.keyboard.up('Enter')
    await expect(panel).toBeVisible()
    await expect(search).toBeFocused()
    expect(await openTitles()).toEqual(['Held search page 1', 'Held search page 3'])
    expect((await state()).tabs.find(tab => tab.active)?.title).toBe('Held search page 3')
  } finally {
    await closeFixtureServer(server)
  }
})
