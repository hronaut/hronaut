import type { HronautApi, HronautSettingsApi } from '../../src/shared/types.js'
import { expect, test } from './fixtures.js'

test('workspace navigation keeps descriptions in hover text without showing a persistent preview', async ({ appWindow, electronApp }) => {
  const descriptionText = 'Investigate checkout and keep the signed-in QA session.\nNext: verify the saved cart and order confirmation.\nKeep these notes for the next review.'
  await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1200, 800))
  const workspaceId = await appWindow.evaluate(async description => {
    const browser = (window as unknown as { hronaut: HronautApi }).hronaut
    await browser.createWorkspace({ name: 'Personal browsing', storage: 'scratch' })
    const state = await browser.createWorkspace({ name: 'Checkout QA', description, storage: 'scratch' })
    return state.mcpTabGroups.find(group => group.name === 'Checkout QA')!.id
  }, descriptionText)
  await appWindow.evaluate(() => (window as unknown as { hronautSettings: HronautSettingsApi }).hronautSettings.setTabPosition('left'))
  const rail = appWindow.locator('.browser-tabs-bar.vertical')
  const workspace = rail.getByRole('group', { name: 'Checkout QA', exact: true })
  const header = workspace.locator('.tab-group-label')
  await expect(workspace.locator('.workspace-tab-description')).toHaveCount(0)
  await expect(header).toHaveAccessibleDescription(descriptionText)
  await expect(header).toHaveAttribute('title', new RegExp('Investigate checkout'))

  await header.click()
  await expect(header).toHaveAttribute('aria-expanded', 'false')
  await expect(workspace.getByRole('tab')).toHaveCount(0)
  await electronApp.evaluate(({ BrowserWindow }, id) => BrowserWindow.getAllWindows()[0]!.webContents.send('browser:edit-tab-group', id), workspaceId)
  const editor = appWindow.getByRole('dialog', { name: 'Edit workspace', exact: true })
  await editor.getByRole('textbox', { name: 'Description', exact: true }).fill('Review the saved cart.')
  await editor.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(header).toHaveAccessibleDescription('Review the saved cart.')
  await expect(header).toHaveAttribute('title', /Review the saved cart\./)
  await expect(workspace.locator('.workspace-tab-description')).toHaveCount(0)

  await appWindow.evaluate(() => (window as unknown as { hronautSettings: HronautSettingsApi }).hronautSettings.setTabPosition('top'))
  await expect(appWindow.locator('.workspace-tab-description')).toHaveCount(0)
  await expect(appWindow.getByRole('group', { name: 'Checkout QA', exact: true }).locator('.tab-group-label'))
    .toHaveAttribute('title', /Review the saved cart\./)
})
