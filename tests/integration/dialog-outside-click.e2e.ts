import type { BrowserState } from '../../src/shared/types.js'
import { expect, test } from './fixtures.js'

for (const mode of ['create', 'edit'] as const) {
  test(`keeps the ${mode} workspace draft after outside clicks and selection drags`, async ({ appWindow, electronApp }, testInfo) => {
    if (mode === 'create') await appWindow.getByRole('button', { name: 'Create workspace', exact: true }).click()
    else {
      const state = await appWindow.evaluate("window.hronaut.createWorkspace({ name: 'Existing workspace', storage: 'scratch' })") as BrowserState
      const id = state.mcpTabGroups.find(group => group.name === 'Existing workspace')!.id
      await electronApp.evaluate(({ BrowserWindow }, id) => BrowserWindow.getAllWindows()[0]!.webContents.send('browser:edit-tab-group', id), id)
    }
    const dialog = appWindow.getByRole('dialog', { name: mode === 'create' ? 'Create workspace' : 'Edit workspace', exact: true })
    const input = dialog.getByLabel('Workspace name', { exact: true })
    await input.fill('My unfinished launch checks')
    const overlay = appWindow.locator('.tab-group-editor-overlay')
    await overlay.click({ position: { x: 3, y: 3 } })
    await expect(dialog).toBeVisible()
    await expect(input).toHaveValue('My unfinished launch checks')
    const bounds = (await input.boundingBox())!
    await appWindow.mouse.move(bounds.x + bounds.width - 10, bounds.y + bounds.height / 2)
    await appWindow.mouse.down()
    await appWindow.mouse.move(3, 3)
    await appWindow.mouse.up()
    await expect(dialog).toBeVisible()
    await expect(input).toHaveValue('My unfinished launch checks')
    await dialog.screenshot({ path: testInfo.outputPath(`${mode}-draft-preserved.png`) })
    await dialog.getByRole('button', { name: mode === 'create' ? 'Create workspace' : 'Save changes', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect.poll(() => appWindow.evaluate("window.hronaut.getState().then(state => state.mcpTabGroups.map(group => group.name))")).toContain('My unfinished launch checks')
    await appWindow.getByRole('button', { name: 'Create workspace', exact: true }).click()
    await appWindow.getByRole('dialog', { name: 'Create workspace', exact: true }).getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(appWindow.locator('.tab-group-editor-overlay')).toBeHidden()
    await appWindow.getByRole('button', { name: 'Create workspace', exact: true }).click()
    await appWindow.keyboard.press('Escape')
    await expect(appWindow.locator('.tab-group-editor-overlay')).toBeHidden()
  })
}

test('keeps Settings and the selected theme after clicking its backdrop', async ({ appWindow }, testInfo) => {
  await appWindow.getByRole('button', { name: 'Settings', exact: true }).click()
  const dialog = appWindow.getByRole('dialog', { name: 'Settings', exact: true })
  const theme = dialog.getByTestId('theme-cyberpunk-turbo')
  await theme.click()
  await expect(theme).toHaveAttribute('aria-checked', 'true')
  await appWindow.locator('.settings-overlay').click({ position: { x: 3, y: 3 } })
  await expect(dialog).toBeVisible()
  await expect(theme).toHaveAttribute('aria-checked', 'true')
  await expect(appWindow.locator('html')).toHaveAttribute('data-theme', 'cyberpunk-turbo')
  await dialog.screenshot({ path: testInfo.outputPath('settings-preserved.png') })
  await dialog.getByRole('button', { name: 'Close settings', exact: true }).click()
  await expect(dialog).toBeHidden()
  await appWindow.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(theme).toHaveAttribute('aria-checked', 'true')
  await appWindow.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
})
