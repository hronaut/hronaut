import { createServer } from 'node:http'
import type { HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

test('Escape typed in Find closes Find, not Site storage in its own window', async ({ appWindow, electronApp }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' }).end('<title>Escape order fixture</title><p>needle needle</p>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const url = `http://127.0.0.1:${address.port}/`
  const windowCount = () => electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)
  try {
    // Electron reports website views as pages too. Consume the new-tab event before waiting for the panel window.
    const newTabPage = electronApp.waitForEvent('window')
    await appWindow.evaluate(url => (window as unknown as { hronaut: HronautApi }).hronaut.newTab({ url, active: true }), url)
    await newTabPage
    await expect.poll(() => appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState()
      .then(state => state.tabs.find(tab => tab.active)?.title))).toBe('Escape order fixture')
    await appWindow.getByRole('button', { name: 'Page tools', exact: true }).click()
    await appWindow.getByRole('button', { name: 'Site storage for 127.0.0.1', exact: true }).click()
    const storage = appWindow.getByRole('dialog', { name: 'Site storage · 127.0.0.1', exact: true })
    const panelWindow = electronApp.waitForEvent('window')
    await storage.getByRole('combobox', { name: 'Dock Site storage' }).selectOption('window')
    const storageWindow = await panelWindow
    await storageWindow.waitForLoadState('domcontentloaded')
    await expect(storageWindow).toHaveURL(/hronautPanel=site-storage/)
    await expect.poll(windowCount).toBe(2)

    // Site storage comes first in the shell's Escape order and stays open beside Find in its own window.
    await appWindow.getByRole('button', { name: 'Find in page', exact: true }).click()
    const bar = appWindow.getByRole('search', { name: 'Find in page' })
    const findText = bar.getByRole('searchbox', { name: 'Find text' })
    await findText.fill('needle')
    await expect(bar.locator('.find-count')).toHaveText('1 / 2')
    await findText.press('Escape')
    await expect(bar).toBeHidden()
    expect(await windowCount()).toBe(2)
    expect(storageWindow.isClosed()).toBe(false)
    // Find keeps its text for the next search, as it does when closed from its Close button.
    await appWindow.getByRole('button', { name: 'Find in page', exact: true }).click()
    await expect(findText).toHaveValue('needle')
  } finally {
    await electronApp.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) if (window.getTitle() !== 'Hronaut') window.close()
    }).catch(() => undefined)
    await closeFixtureServer(server)
  }
})
