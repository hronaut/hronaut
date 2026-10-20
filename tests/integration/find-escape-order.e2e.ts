import { createServer } from 'node:http'
import type { HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

test('Escape typed in Find or Zoom, even held down, closes that bar, not Site storage in its own window', async ({ appWindow, electronApp }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' }).end('<title>Escape order fixture</title><p>needle needle</p>')
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
      .then(state => state.tabs.find(tab => tab.active)?.title))).toBe('Escape order fixture')
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

    // Site storage comes first in the shell's Escape order and stays open beside Find and Zoom in its own window.
    await appWindow.getByRole('button', { name: 'Find in page', exact: true }).click()
    const bar = appWindow.getByRole('search', { name: 'Find in page' })
    const findText = bar.getByRole('searchbox', { name: 'Find text' })
    await findText.fill('needle')
    await expect(bar.locator('.find-count')).toHaveText('1 / 2')
    await findText.press('Escape')
    await expect(bar).toBeHidden()
    // Find keeps its text for the next search, as it does when closed from its Close button.
    await appWindow.getByRole('button', { name: 'Find in page', exact: true }).click()
    await expect(findText).toHaveValue('needle')

    await appWindow.getByRole('button', { name: 'Page zoom controls' }).click()
    const zoom = appWindow.getByRole('group', { name: 'Page zoom controls' })
    await expect(zoom).toBeVisible()
    await zoom.getByRole('button', { name: 'Zoom out', exact: true }).press('Escape')
    await expect(zoom).toBeHidden()

    // Held down, Escape repeats. Its repeats used to reach the shell once Find had closed and close Site storage.
    await appWindow.getByRole('button', { name: 'Find in page', exact: true }).click()
    await findText.focus()
    await appWindow.keyboard.down('Escape')
    await appWindow.keyboard.down('Escape')
    await appWindow.keyboard.down('Escape')
    await appWindow.keyboard.up('Escape')
    await expect(bar).toBeHidden()

    // The panel window closes over IPC after the renderer lets go of it, so check it after both bars and a round trip.
    await appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState())
    await expect(detachedStorage).toBeVisible()
    expect(storageWindow.isClosed()).toBe(false)
    expect(await windowCount()).toBe(2)
  } finally {
    await electronApp.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) if (window.getTitle() !== 'Hronaut') window.close()
    }).catch(() => undefined)
    await closeFixtureServer(server)
  }
})
