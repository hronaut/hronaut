import { createServer } from 'node:http'
import type { HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

test('Escape in this window closes Downloads or History before a panel in its own window', async ({ appWindow, electronApp }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' }).end('<title>Own window Escape fixture</title><p>Fixture</p>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const url = `http://127.0.0.1:${address.port}/`
  const windowCount = () => electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)
  const storagePage = () => electronApp.windows().find(page => page.url().includes('hronautPanel=site-storage'))
  try {
    await appWindow.evaluate(url => (window as unknown as { hronaut: HronautApi }).hronaut.newTab({ url, active: true }), url)
    await expect.poll(() => appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState()
      .then(state => state.tabs.find(tab => tab.active)?.title))).toBe('Own window Escape fixture')
    await appWindow.getByRole('button', { name: 'Page tools', exact: true }).click()
    await appWindow.getByRole('button', { name: 'Site storage for 127.0.0.1', exact: true }).click()
    const storage = appWindow.getByRole('dialog', { name: 'Site storage · 127.0.0.1', exact: true })
    await storage.getByRole('combobox', { name: 'Dock Site storage' }).selectOption('window')
    // Wait for the panel window by its address: tooltips and website views are reported as pages too.
    await expect.poll(() => Boolean(storagePage())).toBe(true)
    const storageWindow = storagePage()!
    await storageWindow.waitForLoadState('domcontentloaded')
    const detachedStorage = storageWindow.getByRole('dialog', { name: /^Site storage/ })
    await expect(detachedStorage).toBeVisible()
    await expect.poll(windowCount).toBe(2)

    // Site storage comes first in the shell's Escape order and stays open in its own window beside these panels.
    const downloads = appWindow.getByRole('dialog', { name: 'Downloads' })
    await appWindow.getByRole('button', { name: 'Downloads', exact: true }).click()
    await expect(downloads).toBeVisible()
    // With no downloads yet, the panel has no search field, so Escape is typed on its Close button.
    await downloads.getByRole('button', { name: 'Close downloads' }).press('Escape')
    await expect(downloads).toBeHidden()

    const history = appWindow.getByRole('dialog', { name: 'Browsing history' })
    await appWindow.getByRole('button', { name: 'Browsing history' }).click()
    await expect(history).toBeVisible()
    await history.getByRole('searchbox', { name: 'Search browsing history' }).press('Escape')
    await expect(history).toBeHidden()

    // The panel window closes over IPC after the renderer lets go of it, so check it after both panels and a round trip.
    await appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState())
    await expect(detachedStorage).toBeVisible()
    expect(storageWindow.isClosed()).toBe(false)
    expect(await windowCount()).toBe(2)

    // With nothing else open in this window, Escape closes the panel in its own window, as before.
    await appWindow.getByRole('button', { name: 'Downloads', exact: true }).focus()
    await appWindow.keyboard.press('Escape')
    await expect.poll(windowCount).toBe(1)
  } finally {
    await electronApp.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) if (window.getTitle() !== 'Hronaut') window.close()
    }).catch(() => undefined)
    await closeFixtureServer(server)
  }
})
