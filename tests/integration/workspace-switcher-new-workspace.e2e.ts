import { expect, test } from './fixtures.js'

test('New workspace in the workspace switcher opens the workspace editor', async ({ appWindow, electronApp }) => {
  await electronApp.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]!.setSize(1440, 900) })
  await appWindow.evaluate("window.hronautSettings.setTabPosition('left')")
  await expect(appWindow.getByRole('navigation', { name: 'Tab navigation' })).toHaveClass(/vertical/)

  await appWindow.locator('.workspace-rail-header').getByRole('button', { name: 'Switch workspace', exact: true }).click()
  const switcher = appWindow.getByRole('dialog', { name: 'Switch workspace' })
  await expect(switcher).toBeVisible()
  await switcher.getByRole('button', { name: 'New workspace', exact: true }).click()
  // The editor opens only while the palette is closed, and New workspace asked for it while the switcher still showed
  // as open, so the switcher closed and nothing opened.
  await expect(switcher).toHaveCount(0)
  await expect(appWindow.getByRole('dialog', { name: 'Create workspace' })).toBeVisible()
})
