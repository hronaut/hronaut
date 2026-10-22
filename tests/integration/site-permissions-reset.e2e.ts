import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from './fixtures.js'

test('turns saving to files a website holds back off, with the saved decisions, when Site permissions resets', async ({ appWindow, profileDirectory }) => {
  const created = await appWindow.evaluate(`window.hronaut.createWorkspace({ name: 'Reset decisions', storage: 'scratch' })`) as {
    mcpTabGroups: Array<{ id: string, name: string }>
  }
  const workspaceId = created.mcpTabGroups.find(group => group.name === 'Reset decisions')!.id
  await appWindow.evaluate(`window.hronautPermissions.set('https://reset.example.test', 'geolocation', 'allow', { workspaceId: ${JSON.stringify(workspaceId)} })`)
  await appWindow.getByRole('button', { name: 'Settings', exact: true }).click()
  await appWindow.getByRole('button', { name: 'Site permissions' }).click()
  const fileSaving = appWindow.getByRole('checkbox', { name: /^Let websites save to files you open or drop/ })
  const saved = async () => JSON.parse(await readFile(join(profileDirectory, 'settings.json'), 'utf8')).allowWebsiteFileSaving
  await fileSaving.check()
  await expect.poll(saved).toBe(true)
  await expect(appWindow.getByRole('button', { name: 'Forget Location permission for https://reset.example.test (Reset decisions)' })).toBeVisible()

  // Reset to default forgot the decisions but left the switch on, though it is off by default.
  await appWindow.getByRole('button', { name: 'Reset to default' }).click()
  await expect(appWindow.getByText('No saved decisions', { exact: true })).toBeVisible()
  await expect(fileSaving).not.toBeChecked()
  await expect.poll(saved).toBe(false)
  await expect.poll(async () => JSON.parse(await readFile(join(profileDirectory, 'site-permissions.json'), 'utf8')).permissions).toEqual([])
})
