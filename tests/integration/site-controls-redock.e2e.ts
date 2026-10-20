import { createServer } from 'node:http'
import type { HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

test('Site controls show the site’s counts when they dock back after the tab navigated while they were in their window', async ({ appWindow, electronApp }) => {
  // The main window kept the panel open, hidden, while it showed in its own window. The navigation cleared the site's
  // counts there, so docked back it showed "…" until it was opened again.
  const server = createServer((request, response) => {
    const page = request.url === '/second' ? 'Second' : 'First'
    response.writeHead(200, { 'content-type': 'text/html' }).end(`<title>${page} site</title><p>${page}</p>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const origin = `http://127.0.0.1:${address.port}`
  const siteControlsPage = () => electronApp.windows().find(page => page.url().includes('hronautPanel=site-controls'))
  const activeTitle = () => appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState()
    .then(state => state.tabs.find(tab => tab.active)?.title))
  try {
    const tabId = await appWindow.evaluate(async url => (await (window as unknown as { hronaut: HronautApi }).hronaut.newTab({ url, active: true })).activeTabId, `${origin}/first`)
    if (!tabId) throw new Error('Missing fixture tab')
    await expect.poll(activeTitle).toBe('First site')
    await appWindow.getByRole('button', { name: /Site controls for 127\.0\.0\.1/ }).click()
    const siteControls = appWindow.getByRole('dialog', { name: '127.0.0.1', exact: true })
    await expect(siteControls.getByRole('article', { name: /cookies? available to this address/ })).toBeVisible()

    await siteControls.getByRole('combobox', { name: 'Dock site controls' }).selectOption('window')
    // Wait for the panel window by its address: tooltips and website views are reported as pages too.
    await expect.poll(() => Boolean(siteControlsPage())).toBe(true)
    const siteControlsWindow = siteControlsPage()!
    await siteControlsWindow.waitForLoadState('domcontentloaded')
    await expect(siteControlsWindow.getByRole('dialog', { name: '127.0.0.1', exact: true })).toBeVisible()
    await expect(siteControls).toBeHidden()
    await appWindow.evaluate(({ tabId, url }) => (window as unknown as { hronaut: HronautApi }).hronaut.navigate({ tabId, url }), { tabId, url: `${origin}/second` })
    await expect.poll(activeTitle).toBe('Second site')

    const siteControlsWindowClosed = siteControlsWindow.waitForEvent('close')
    await siteControlsWindow.evaluate(`setTimeout(() => {
      const select = document.querySelector('select[aria-label="Dock site controls"]')
      if (!(select instanceof HTMLSelectElement)) throw new Error('Missing site controls dock selector')
      select.value = 'right'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    }, 0)`)
    await siteControlsWindowClosed
    await expect(siteControls).toBeVisible()
    await expect(siteControls.getByRole('article', { name: /cookies? available to this address/ })).toBeVisible()
    await expect(siteControls.getByRole('article', { name: 'Loading cookie count' })).toBeHidden()
  } finally {
    await electronApp.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) if (window.getTitle() !== 'Hronaut') window.close()
    }).catch(() => undefined)
    await closeFixtureServer(server)
  }
})
