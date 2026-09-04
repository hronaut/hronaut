import { expect, test } from './fixtures.js'

test('keeps the commercial license UI stable across light and dark themes', async ({ appWindow }) => {
  await appWindow.getByRole('button', { name: 'Settings' }).click()
  const dialog = appWindow.getByRole('dialog', { name: 'Settings' })
  await expect(dialog).toBeVisible()

  await appWindow.getByRole('button', { name: /Appearance/ }).click()
  await appWindow.getByTestId('theme-light').click()
  await appWindow.getByRole('button', { name: /Commercial license/ }).click()
  await expect(appWindow.getByLabel('Commercial license key')).toBeVisible()
  await expect(dialog).toHaveScreenshot('commercial-license-light.png', {
    animations: 'disabled'
  })

  await appWindow.getByRole('button', { name: /Appearance/ }).click()
  await appWindow.getByTestId('theme-dark').click()
  await appWindow.getByRole('button', { name: /Commercial license/ }).click()
  await expect(dialog).toHaveScreenshot('commercial-license-dark.png', {
    animations: 'disabled'
  })
})
