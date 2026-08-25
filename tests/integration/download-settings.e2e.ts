import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from './fixtures.js'

test('persists and resets website download preferences from Settings', async ({
  appWindow,
  profileDirectory
}) => {
  await appWindow.getByRole('button', { name: 'Settings' }).click()
  const settingsDialog = appWindow.getByRole('dialog', { name: 'Settings' })
  await settingsDialog.getByRole('button', { name: 'Downloads Location and prompts' }).click()

  const downloadSettings = settingsDialog.locator('.settings-content')
  await expect(downloadSettings.getByRole('heading', { name: 'Website downloads' })).toBeVisible()
  const askWhereToSave = downloadSettings.getByRole('checkbox', { name: /^Ask where to save each file/ })
  await expect(askWhereToSave).not.toBeChecked()

  await askWhereToSave.check()
  await expect(askWhereToSave).toBeChecked()
  await expect(downloadSettings.getByText('Hronaut will ask where to save each new website download.')).toBeVisible()
  await expect.poll(async () => (
    JSON.parse(await readFile(join(profileDirectory, 'settings.json'), 'utf8')).askWhereToSaveDownloads
  )).toBe(true)

  await appWindow.getByRole('button', { name: 'Reset to default' }).click()
  await expect(askWhereToSave).not.toBeChecked()
  await expect(downloadSettings.getByText('Downloads will use the default folder and save automatically.')).toBeVisible()
  await expect.poll(async () => JSON.parse(await readFile(join(profileDirectory, 'settings.json'), 'utf8')))
    .toMatchObject({ downloadDirectory: null, askWhereToSaveDownloads: false })
})
