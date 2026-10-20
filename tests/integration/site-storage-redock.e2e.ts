import { createServer } from 'node:http'
import type { HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

test('Site storage shows the site’s items as they are now when it docks back from its window', async ({ appWindow, electronApp }) => {
  // The main window kept the panel open, hidden, while it showed in its own window, so docked back it listed the items it
  // had before it left.
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
      .end('<title>Storage redock</title><p>Fixture</p><script>localStorage.setItem("before", "1")</script>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const url = `http://127.0.0.1:${address.port}/`
  const storagePage = () => electronApp.windows().find(page => page.url().includes('hronautPanel=site-storage'))
  try {
    const tabId = await appWindow.evaluate(async url => (await (window as unknown as { hronaut: HronautApi }).hronaut.newTab({ url, active: true })).activeTabId, url)
    if (!tabId) throw new Error('Missing fixture tab')
    await expect.poll(() => appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState()
      .then(state => state.tabs.find(tab => tab.active)?.title))).toBe('Storage redock')
    await appWindow.getByRole('button', { name: 'Page tools', exact: true }).click()
    await appWindow.getByRole('button', { name: 'Site storage for 127.0.0.1', exact: true }).click()
    const storage = appWindow.getByRole('dialog', { name: 'Site storage · 127.0.0.1', exact: true })
    await expect(storage.getByRole('button', { name: 'Delete before' })).toBeVisible()

    await storage.getByRole('combobox', { name: 'Dock Site storage' }).selectOption('window')
    // Wait for the panel window by its address: tooltips and website views are reported as pages too.
    await expect.poll(() => Boolean(storagePage())).toBe(true)
    const storageWindow = storagePage()!
    await storageWindow.waitForLoadState('domcontentloaded')
    await expect(storageWindow.getByRole('dialog', { name: /^Site storage/ })).toBeVisible()
    await expect(storage).toBeHidden()
    await appWindow.evaluate(tabId => (window as unknown as { hronaut: HronautApi }).hronaut.manageStorage({
      tabId, kind: 'local-storage', action: 'set', key: 'while-detached', value: '2', includeValues: true
    }), tabId)

    const storageWindowClosed = storageWindow.waitForEvent('close')
    await storageWindow.evaluate(`setTimeout(() => {
      const select = document.querySelector('select[aria-label="Dock Site storage"]')
      if (!(select instanceof HTMLSelectElement)) throw new Error('Missing Site storage dock selector')
      select.value = 'right'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    }, 0)`)
    await storageWindowClosed
    await expect(storage).toBeVisible()
    await expect(storage.getByRole('button', { name: 'Delete while-detached' })).toBeVisible()
    await expect(storage.getByRole('button', { name: 'Delete before' })).toBeVisible()
  } finally {
    await electronApp.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) if (window.getTitle() !== 'Hronaut') window.close()
    }).catch(() => undefined)
    await closeFixtureServer(server)
  }
})
