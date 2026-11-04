import { createServer } from 'node:http'
import { closeFixtureServer } from './fixtures.js'
import { expect, test } from './capability-fixtures.js'

// Closing Find cleared the page's selection, where Chrome leaves the match selected and gives the link it is in the
// page's focus, so the person can copy the match or follow the link with Enter. Emptying the Find field clears it.

test('closing Find leaves the match selected and its link focused, and emptying the field clears it, as in Chrome', async ({ capabilities, appWindow, electronApp }) => {
  const { tabId } = capabilities
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>Needles</title><p>needle one</p><p><a href="/next">needle two</a></p><p>needle three</p>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const url = `http://127.0.0.1:${address.port}/page`
  try {
    type State = { tabs: Array<{ id: string, url: string, loading: boolean }> }
    const tab = async () => ((await appWindow.evaluate(`window.hronaut.getState()`)) as State).tabs.find(candidate => candidate.id === tabId)!
    await appWindow.evaluate(`window.hronaut.navigate({ url: ${JSON.stringify(url)}, tabId: ${JSON.stringify(tabId)} })`)
    await expect.poll(async () => { const current = await tab(); return !current.loading && current.url }).toBe(url)
    // The page's selected text and the tag of its focused element.
    const pageState = () => electronApp.evaluate(({ webContents }, url) => {
      const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)
      if (!page) throw new Error('Page web contents was not found')
      return page.executeJavaScript('[String(getSelection()), document.activeElement?.tagName]') as Promise<[string, string]>
    }, url)
    const bar = appWindow.getByRole('search', { name: 'Find in page' })
    const search = bar.getByRole('searchbox', { name: 'Find text' })
    const count = bar.locator('.find-count')
    const openFind = () => appWindow.getByRole('button', { name: 'Find in page', exact: true }).click()

    await openFind()
    await search.fill('needle')
    await expect(count).toHaveText('1 / 3')
    await search.press('Escape')
    await expect(bar).toBeHidden()
    await expect.poll(pageState).toEqual(['needle', 'BODY'])

    // The second match is in a link, which Close leaves focused.
    await openFind()
    await expect(search).toHaveValue('needle')
    for (let step = 0; step < 3 && await count.textContent() !== '2 / 3'; step += 1) {
      await search.press('Enter')
      await expect(count).toHaveText(/^\d \/ 3$/)
    }
    await expect(count).toHaveText('2 / 3')
    await bar.getByRole('button', { name: 'Close find in page' }).click()
    await expect(bar).toBeHidden()
    await expect.poll(pageState).toEqual(['needle', 'A'])

    await openFind()
    await expect(count).toHaveText(/^\d \/ 3$/)
    await search.fill('')
    await expect(count).toHaveText('0 / 0')
    await expect.poll(async () => (await pageState())[0]).toBe('')
  } finally {
    await closeFixtureServer(server)
  }
})
