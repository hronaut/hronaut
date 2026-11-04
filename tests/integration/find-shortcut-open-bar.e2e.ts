import { createServer } from 'node:http'
import { closeFixtureServer } from './fixtures.js'
import { expect, test } from './capability-fixtures.js'

// Ctrl/Cmd+F with Find open searched again from the start, moving the page off the match in view, where Chrome only
// takes the keyboard to the Find field and selects its text.

test('Ctrl/Cmd+F in an open Find selects its text and keeps the current match, as in Chrome', async ({ capabilities, appWindow, electronApp }) => {
  const { tabId } = capabilities
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>Needles</title><p>needle one</p><p>needle two</p><p>needle three</p>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const url = `http://127.0.0.1:${address.port}/page`
  const modifier: 'meta' | 'control' = process.platform === 'darwin' ? 'meta' : 'control'
  try {
    type State = { tabs: Array<{ id: string, url: string, loading: boolean }> }
    const tab = async () => ((await appWindow.evaluate(`window.hronaut.getState()`)) as State).tabs.find(candidate => candidate.id === tabId)!
    await appWindow.evaluate(`window.hronaut.navigate({ url: ${JSON.stringify(url)}, tabId: ${JSON.stringify(tabId)} })`)
    await expect.poll(async () => { const current = await tab(); return !current.loading && current.url }).toBe(url)
    // The person's key on the tab's page, as the keyboard sends it.
    const pressOnPage = async (keyCode: string) => electronApp.evaluate(({ webContents }, { url, keyCode, modifier }) => {
      const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)
      if (!page) throw new Error('Page web contents was not found')
      page.focus()
      page.sendInputEvent({ type: 'keyDown', keyCode, modifiers: [modifier] })
      page.sendInputEvent({ type: 'keyUp', keyCode, modifiers: [modifier] })
    }, { url, keyCode, modifier })
    const bar = appWindow.getByRole('search', { name: 'Find in page' })
    const search = bar.getByRole('searchbox', { name: 'Find text' })
    const count = bar.locator('.find-count')
    const selected = () => search.evaluate((field: HTMLInputElement) => [field.selectionStart, field.selectionEnd])

    await appWindow.getByRole('button', { name: 'Find in page', exact: true }).click()
    await search.fill('needle')
    await expect(count).toHaveText('1 / 3')
    await search.press('Enter')
    await expect(count).toHaveText('2 / 3')

    // In the Find field, with the caret at the end of its text.
    await search.press('End')
    await search.press('ControlOrMeta+F')
    await expect.poll(selected).toEqual([0, 'needle'.length])
    await expect(search).toBeFocused()
    // From the page.
    await pressOnPage('F')
    await expect(search).toBeFocused()
    await expect(count).toHaveText('2 / 3')
    await expect.poll(selected).toEqual([0, 'needle'.length])
    // Enter still goes on from the match in view.
    await search.press('Enter')
    await expect(count).toHaveText('3 / 3')
  } finally {
    await closeFixtureServer(server)
  }
})
