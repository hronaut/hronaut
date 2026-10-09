import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from './fixtures.js'

test('keeps keyboard position across permission groups when forgetting saved decisions', async ({ appWindow, profileDirectory }) => {
  const origins = ['https://first.example.test', 'https://middle.example.test', 'https://third.example.test'] as const
  for (const origin of origins) {
    await appWindow.evaluate(`window.hronautPermissions.set(${JSON.stringify(origin)}, 'geolocation', 'allow')`)
  }
  await appWindow.getByRole('button', { name: 'Settings', exact: true }).click()
  await appWindow.getByRole('button', { name: 'Site permissions' }).click()
  const forget = (origin: string) => appWindow.getByRole('button', { name: `Forget Location permission for ${origin}` })
  const remaining = async () => JSON.parse(await readFile(join(profileDirectory, 'site-permissions.json'), 'utf8')).permissions
  await forget(origins[1]).focus()
  await appWindow.keyboard.press('Enter')
  await expect(forget(origins[1])).toHaveCount(0)
  await expect(forget(origins[2])).toBeFocused()
  await expect.poll(remaining).toEqual([origins[0], origins[2]].map(origin => ({ origin, permission: 'geolocation', decision: 'allow' })))
  await appWindow.keyboard.press('Enter')
  await expect(forget(origins[2])).toHaveCount(0)
  await expect(forget(origins[0])).toBeFocused()
  await appWindow.keyboard.press('Enter')
  await expect(appWindow.getByText('No saved decisions', { exact: true })).toBeVisible()
  await expect(appWindow.getByRole('heading', { name: 'Site permissions', exact: true })).toBeFocused()
  await expect.poll(remaining).toEqual([])
})
