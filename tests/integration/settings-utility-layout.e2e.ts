import { expect, test } from './fixtures.js'

test('places Settings below workspaces with one active-page close control and a matching title', async ({ appWindow }, testInfo) => {
  await appWindow.getByRole('button', { name: 'Settings', exact: true }).click()
  const settings = appWindow.getByRole('tabpanel', { name: 'Settings', exact: true })
  await settings.getByRole('combobox', { name: 'Tab position' }).selectOption('left')
  await expect(appWindow.locator('.shell-title-bar-surface.surface-settings')).toHaveText('Settings')
  await expect(appWindow.locator('.settings-footer')).toHaveCount(0)
  await expect(appWindow.locator('.settings-tab-close')).toHaveCount(0)
  await expect(appWindow.getByRole('button', { name: 'Settings', exact: true })).toHaveCount(0)
  const tab = appWindow.getByRole('tab', { name: 'Settings', exact: true })
  await expect(tab).toHaveAttribute('aria-selected', 'true')
  await expect.poll(async () => {
    const entry = await tab.boundingBox()
    const workspaces = await appWindow.locator('.browser-tabs-bar .tabs-strip-shell').boundingBox()
    return entry !== null && workspaces !== null && entry.y >= workspaces.y + workspaces.height
  }).toBe(true)
  await appWindow.setViewportSize({ width: 1900, height: 1040 })
  await expect.poll(() => settings.locator('.settings-content').evaluate(element => element.clientWidth)).toBeLessThanOrEqual(1164)
  await appWindow.screenshot({ path: testInfo.outputPath('settings-utility-layout.png') })
  await settings.getByRole('button', { name: 'Close settings', exact: true }).click()
  await expect(settings).toBeHidden()
  await expect(appWindow.getByRole('button', { name: 'Settings', exact: true })).toBeVisible()
})
