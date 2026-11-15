import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ElectronApplication } from '@playwright/test'
import { closeFixtureServer, expect, test } from './fixtures.js'
import { answerTrustedDialog, trustedDialog, trustedDialogHeadline } from './trusted-dialog-fixture.js'

/** Asks for the location from the fixture page; resolves with the error code of a refusal. */
function requestLocation(electronApp: ElectronApplication): Promise<unknown> {
  return electronApp.evaluate(async ({ webContents }) => {
    const page = webContents.getAllWebContents().find((contents) => contents.getTitle() === 'Default permissions')
    if (!page) throw new Error('Default permissions fixture was not found')
    return page.executeJavaScript(`new Promise((resolve) => navigator.geolocation.getCurrentPosition(
      () => resolve('allowed'),
      (error) => resolve(error.code)
    ))`)
  })
}

test('refuses the location without a prompt once Settings blocks it for every website, and asks again after Reset defaults', async ({
  appWindow,
  electronApp,
  profileDirectory
}) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end('<!doctype html><title>Default permissions</title><main>Default permissions fixture</main>')
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Default permissions fixture did not expose a port')
  const origin = `http://127.0.0.1:${address.port}`
  const blocked = async () => JSON.parse(await readFile(join(profileDirectory, 'settings.json'), 'utf8')).sitePermissionsBlockedByDefault
  const settingsDialog = appWindow.locator('.settings-dialog')

  try {
    await appWindow.getByRole('button', { name: 'Settings', exact: true }).click()
    await appWindow.getByRole('button', { name: 'Site permissions' }).click()
    await appWindow.getByRole('tab', { name: 'Defaults' }).click()
    await appWindow.getByRole('combobox', { name: 'Default for Location' }).selectOption('deny')
    await expect.poll(blocked).toEqual(['geolocation'])
    await settingsDialog.getByRole('button', { name: 'Close settings', exact: true }).click()

    await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(origin)}, active: true })`)
    await expect.poll(() => electronApp.evaluate(({ webContents }) => (
      webContents.getAllWebContents().some((contents) => contents.getTitle() === 'Default permissions')
    ))).toBe(true)
    // GeolocationPositionError.PERMISSION_DENIED, and nothing was asked or saved.
    expect(await requestLocation(electronApp)).toBe(1)
    await expect(trustedDialog(appWindow)).toHaveCount(0)
    expect(await appWindow.evaluate('window.hronautPermissions.list()')).toEqual([])

    await appWindow.getByRole('button', { name: 'Settings', exact: true }).click()
    await appWindow.getByRole('button', { name: 'Site permissions' }).click()
    await appWindow.getByRole('tab', { name: 'Defaults' }).click()
    await expect(appWindow.getByRole('combobox', { name: 'Default for Location' })).toHaveValue('deny')
    await appWindow.getByRole('button', { name: 'Reset defaults' }).click()
    await expect.poll(blocked).toEqual([])
    await settingsDialog.getByRole('button', { name: 'Close settings', exact: true }).click()

    const asked = requestLocation(electronApp)
    await expect.poll(() => trustedDialogHeadline(appWindow)).toBe(`${origin} wants to know your location`)
    await answerTrustedDialog(appWindow, 'Deny')
    expect(await asked).toBe(1)
  } finally {
    await closeFixtureServer(server)
  }
})
