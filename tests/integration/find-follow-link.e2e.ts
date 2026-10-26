import { createServer } from 'node:http'
import type { HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

test('Ctrl+Enter in Find closes it and follows the link the match is in, as Chrome does', async ({ appWindow, electronApp }) => {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    if (request.url === '/pricing') {
      response.end('<!doctype html><title>Pricing fixture</title><p>Plans</p>')
      return
    }
    response.end(`<!doctype html><title>Find link fixture</title>
      <p>Read the <a id="pricing" href="/pricing">pricing details</a> first.</p>
      <p>Some plain words stay here.</p>
      <script>window.clicks = 0; document.addEventListener('click', () => { window.clicks += 1 })</script>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const url = `http://127.0.0.1:${address.port}/`
  const activeTab = () => appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState()
    .then(state => state.tabs.find(tab => tab.active)))
  const bar = appWindow.getByRole('search', { name: 'Find in page' })
  const find = async (text: string, count: string): Promise<void> => {
    await appWindow.getByRole('button', { name: 'Find in page', exact: true }).click()
    await bar.getByRole('searchbox', { name: 'Find text' }).fill(text)
    await expect(bar.locator('.find-count')).toHaveText(count)
  }
  try {
    await appWindow.evaluate(url => (window as unknown as { hronaut: HronautApi }).hronaut.newTab({ url, active: true }), url)
    await expect.poll(async () => (await activeTab())?.loading).toBe(false)

    // A match outside a link closes Find and clicks nothing.
    await find('plain words', '1 / 1')
    await appWindow.keyboard.press('Control+Enter')
    await expect(bar).toBeHidden()
    expect((await activeTab())?.url).toBe(url)
    expect(await electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents()
      .find(contents => contents.getURL() === url)!.executeJavaScript('window.clicks'), url)).toBe(0)

    // A tab whose input is locked keeps the click from the person's keys too.
    const tabId = (await activeTab())!.id
    const setLocked = (locked: boolean) => appWindow.evaluate(({ tabId, locked }) => (window as unknown as { hronaut: HronautApi }).hronaut
      .setTabHumanInteractionLocked(tabId, locked), { tabId, locked })
    await setLocked(true)
    await find('pricing details', '1 / 1')
    await appWindow.keyboard.press('Control+Enter')
    await expect(bar).toBeHidden()
    expect((await activeTab())?.url).toBe(url)
    expect(await electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents()
      .find(contents => contents.getURL() === url)!.executeJavaScript('window.clicks'), url)).toBe(0)
    await setLocked(false)

    // Ctrl+Enter searched again like Enter, so the link a match is in could only be followed by closing Find and
    // clicking it. Find opens again on its last text, which is typed again and searched with Match case: searches that
    // find the same text again left Chromium nothing to click.
    await find('pricing details', '1 / 1')
    await bar.getByRole('button', { name: 'Match case' }).click()
    await expect(bar.getByRole('button', { name: 'Match case' })).toHaveAttribute('aria-pressed', 'true')
    await expect(bar.locator('.find-count')).toHaveAttribute('aria-busy', 'false')
    await expect(bar.locator('.find-count')).toHaveText('1 / 1')
    await appWindow.keyboard.press('Control+Enter')
    await expect(bar).toBeHidden()
    await expect.poll(async () => (await activeTab())?.url).toBe(`${url}pricing`)
    await expect.poll(async () => (await activeTab())?.title).toBe('Pricing fixture')
  } finally {
    await closeFixtureServer(server)
  }
})
