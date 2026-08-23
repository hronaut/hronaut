import { mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { closeHronaut, expect, launchHronaut, test } from './fixtures.js'

test('manages and persists per-website permission decisions', async ({
  appWindow,
  electronApp,
  mcpPort,
  profileDirectory
}) => {
  await appWindow.getByRole('button', { name: 'Settings' }).click()
  await appWindow.getByRole('button', { name: 'Site permissions' }).click()
  await expect(appWindow.getByText('No saved decisions')).toBeVisible()

  await appWindow.evaluate(
    "window.hronautPermissions.set('https://example.com/path', 'geolocation', 'allow')"
  )
  const locationPermission = appWindow.getByRole('combobox', {
    name: 'Location permission for https://example.com'
  })
  await expect(locationPermission).toHaveValue('allow')

  const permissionsPath = join(profileDirectory, 'site-permissions.json')
  const blockedTemporaryPath = `${permissionsPath}.tmp`
  await rm(blockedTemporaryPath, { recursive: true, force: true })
  await mkdir(blockedTemporaryPath)
  try {
    await locationPermission.selectOption('deny')
    await expect(appWindow.getByRole('alert', { name: 'Setting not saved' })).toBeVisible()
    await expect(locationPermission).toHaveValue('allow')
    await expect.poll(() => appWindow.evaluate('window.hronautPermissions.list()')).toEqual([{
      origin: 'https://example.com',
      permission: 'geolocation',
      decision: 'allow'
    }])
  } finally {
    await rm(blockedTemporaryPath, { recursive: true, force: true })
  }

  await locationPermission.selectOption('deny')
  await expect
    .poll(async () => JSON.parse(await readFile(permissionsPath, 'utf8')).permissions[0]?.decision)
    .toBe('deny')
  await closeHronaut(electronApp)

  const restarted = await launchHronaut(profileDirectory, mcpPort + 1)
  try {
    await restarted.window.getByRole('button', { name: 'Settings' }).click()
    await restarted.window.getByRole('button', { name: 'Site permissions' }).click()
    const restoredPermission = restarted.window.getByRole('combobox', {
      name: 'Location permission for https://example.com'
    })
    await expect(restoredPermission).toHaveValue('deny')
    await restarted.window.getByRole('button', {
      name: 'Forget Location permission for https://example.com'
    }).click()
    await expect(restarted.window.getByText('No saved decisions')).toBeVisible()
  } finally {
    await closeHronaut(restarted.app)
  }
})
