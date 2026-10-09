import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SitePermissionEntry } from '../../src/shared/types.js'
import { expect, test } from './fixtures.js'

test('finds saved permissions by site and permission name without modifying hidden decisions', async ({ appWindow, profileDirectory }) => {
  const entries: SitePermissionEntry[] = [
    { origin: 'https://staging.example.test', permission: 'geolocation', decision: 'allow' },
    { origin: 'https://staging.example.test', permission: 'media', decision: 'allow' },
    { origin: 'https://production.example.test', permission: 'media', decision: 'deny' },
    { origin: 'https://production.example.test', permission: 'notifications', decision: 'allow' }
  ]
  for (const entry of entries) {
    await appWindow.evaluate(`window.hronautPermissions.set(${JSON.stringify(entry.origin)}, ${JSON.stringify(entry.permission)}, ${JSON.stringify(entry.decision)})`)
  }
  const saved = async (): Promise<SitePermissionEntry[]> => JSON.parse(await readFile(join(profileDirectory, 'site-permissions.json'), 'utf8')).permissions
  const before = await saved()
  await appWindow.getByRole('button', { name: 'Settings', exact: true }).click()
  await appWindow.getByRole('button', { name: 'Site permissions' }).click()
  const panel = appWindow.locator('.permissions-settings')
  const search = panel.getByRole('searchbox', { name: 'Search saved site permissions' })
  await expect(search).toBeVisible()
  await search.fill('CAMERA')
  await expect(panel.getByRole('combobox')).toHaveCount(2)
  await expect(panel.getByRole('status')).toHaveText('2 of 4 saved decisions')
  expect(await saved()).toEqual(before)
  await search.fill(' STAGING.EXAMPLE.TEST ')
  await expect(panel.getByRole('combobox')).toHaveCount(2)
  await panel.getByRole('combobox', { name: 'Location permission for https://staging.example.test' }).selectOption('deny')
  const updated = before.map(entry => entry.permission === 'geolocation' ? { ...entry, decision: 'deny' } : entry)
  await expect.poll(saved).toEqual(updated)
  await search.fill('geolocation')
  await expect(panel.getByRole('combobox')).toHaveCount(1)
  await panel.getByRole('button', { name: 'Forget Location permission for https://staging.example.test' }).click()
  await expect(panel.getByText('No saved decisions match this search.', { exact: true })).toBeVisible()
  await expect(panel.getByRole('status')).toHaveText('0 of 3 saved decisions')
  await expect.poll(saved).toEqual(before.filter(entry => entry.permission !== 'geolocation'))
  await search.fill('[a-z]')
  await expect(panel.getByRole('combobox')).toHaveCount(0)
  await appWindow.getByRole('button', { name: 'Close settings', exact: true }).click()
  await appWindow.getByRole('button', { name: 'Settings', exact: true }).click()
  await appWindow.getByRole('button', { name: 'Site permissions' }).click()
  await expect(search).toHaveValue('')
  await expect(panel.getByRole('combobox')).toHaveCount(3)
  expect(await saved()).toEqual(before.filter(entry => entry.permission !== 'geolocation'))
})
