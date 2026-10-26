import { createServer } from 'node:http'
import type { HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

test('Ctrl+Enter in Find closes it and follows the link the match is in, as Chrome does', async ({ appWindow, electronApp }) => {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' })
    if (request.url === '/pricing') {
      response.end('<!doctype html><title>Pricing fixture</title><p>Plans</p>')
      return
    }
    response.end(`<!doctype html><title>Find link fixture</title>
      <p>Read the <a id="pricing" href="/pricing">pricing details</a> first.</p>
      <p>Some plain words stay here.</p>
      <button id="order">Place order</button>
      <script>window.clicked = []; document.addEventListener('click', event => { window.clicked.push(event.target.id) })</script>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const url = `http://127.0.0.1:${address.port}/`
  const activeTab = () => appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState()
    .then(state => state.tabs.find(tab => tab.active)))
  const inPage = (script: string) => electronApp.evaluate(({ webContents }, input: { url: string; script: string }) => webContents.getAllWebContents()
    .find(contents => contents.getURL() === input.url)!.executeJavaScript(input.script), { url, script })
  const bar = appWindow.getByRole('search', { name: 'Find in page' })
  const field = bar.getByRole('searchbox', { name: 'Find text' })
  const settled = async (count: string): Promise<void> => {
    await expect(bar.locator('.find-count')).toHaveAttribute('aria-busy', 'false')
    await expect(bar.locator('.find-count')).toHaveText(count)
  }
  const find = async (text: string, count: string): Promise<void> => {
    await appWindow.getByRole('button', { name: 'Find in page', exact: true }).click()
    await field.fill(text)
    await settled(count)
  }
  try {
    await appWindow.evaluate(url => (window as unknown as { hronaut: HronautApi }).hronaut.newTab({ url, active: true }), url)
    await expect.poll(async () => (await activeTab())?.loading).toBe(false)
    const tabId = (await activeTab())!.id

    // Chromium clicks the page's focused element, which is the match's link only once a search found one: with no
    // match, Ctrl+Enter clicked the button the page had focused.
    await inPage('document.getElementById("order").focus()')
    await find('no such words', '0 / 0')
    await appWindow.keyboard.press('Control+Enter')
    await expect(bar).toBeHidden()
    expect(await inPage('window.clicked')).toEqual([])

    // A match outside a link closes Find and clicks nothing.
    await find('plain words', '1 / 1')
    await appWindow.keyboard.press('Control+Enter')
    await expect(bar).toBeHidden()
    expect((await activeTab())?.url).toBe(url)
    expect(await inPage('window.clicked')).toEqual([])

    // A tab whose input is locked keeps the click from the person's keys too.
    const setLocked = (locked: boolean) => appWindow.evaluate(({ tabId, locked }) => (window as unknown as { hronaut: HronautApi }).hronaut
      .setTabHumanInteractionLocked(tabId, locked), { tabId, locked })
    await setLocked(true)
    await find('pricing details', '1 / 1')
    await appWindow.keyboard.press('Control+Enter')
    await expect(bar).toBeHidden()
    expect((await activeTab())?.url).toBe(url)
    expect(await inPage('window.clicked')).toEqual([])
    await setLocked(false)

    // Ctrl+Enter searched again like Enter, so the link a match is in could only be followed by closing Find and
    // clicking it. Here the text is typed key by key.
    await appWindow.getByRole('button', { name: 'Find in page', exact: true }).click()
    await expect(field).toBeFocused()
    await field.fill('')
    await field.pressSequentially('pricing')
    await settled('1 / 1')
    await appWindow.keyboard.press('Control+Enter')
    await expect(bar).toBeHidden()
    await expect.poll(async () => (await activeTab())?.url).toBe(`${url}pricing`)
    await expect.poll(async () => (await activeTab())?.title).toBe('Pricing fixture')

    // Find opens again on its last text, which is typed again and searched with Match case: searches that find the
    // same text again left Chromium nothing to click.
    await appWindow.evaluate(tabId => (window as unknown as { hronaut: HronautApi }).hronaut.back(tabId), tabId)
    await expect.poll(async () => { const tab = await activeTab(); return tab?.url === url && !tab.loading }).toBe(true)
    await find('pricing', '1 / 1')
    await bar.getByRole('button', { name: 'Match case' }).click()
    await expect(bar.getByRole('button', { name: 'Match case' })).toHaveAttribute('aria-pressed', 'true')
    await settled('1 / 1')
    await appWindow.keyboard.press('Control+Enter')
    await expect(bar).toBeHidden()
    await expect.poll(async () => (await activeTab())?.url).toBe(`${url}pricing`)
  } finally {
    await closeFixtureServer(server)
  }
})
