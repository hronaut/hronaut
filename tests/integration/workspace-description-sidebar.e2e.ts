import { writeFile } from 'node:fs/promises'
import type { HronautApi, HronautSettingsApi } from '../../src/shared/types.js'
import { expect, test } from './fixtures.js'

test('left navigation previews workspace descriptions without crowding tabs or the compact rail', async ({ appWindow, electronApp }, testInfo) => {
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
  const description = workspace.locator('.workspace-tab-description')
  const resize = appWindow.getByRole('separator', { name: 'Resize workspace panel', exact: true })
  await expect(description).toBeVisible()
  await expect(header).toHaveAccessibleDescription(descriptionText)
  await expect(header).toHaveAttribute('title', new RegExp('Investigate checkout'))
  expect(await rail.locator('.workspace-tab-description').count()).toBe(1)

  for (const theme of ['light', 'dark'] as const) {
    await appWindow.evaluate(theme => (window as unknown as { hronautSettings: HronautSettingsApi }).hronautSettings.setTheme(theme), theme)
    for (const scale of [1, 1.25] as const) {
      await appWindow.evaluate(scale => (window as unknown as { hronautSettings: HronautSettingsApi }).hronautSettings.setInterfaceScale(scale), scale)
      await rail.hover()
      await resize.press('Home')
      await expect(resize).toHaveAttribute('aria-valuenow', '200')
      await expect(description).toBeInViewport()
      const layout = await workspace.evaluate(element => {
        const description = element.querySelector('.workspace-tab-description')!
        const rect = description.getBoundingClientRect()
        const header = element.querySelector('.tab-group-label')!.getBoundingClientRect()
        const tab = element.querySelector('[role="tab"]')!.getBoundingClientRect()
        return { top: rect.top, bottom: rect.bottom, height: rect.height, headerBottom: header.bottom, tabTop: tab.top,
          lineHeight: Number.parseFloat(getComputedStyle(description).lineHeight), overflow: element.scrollWidth - element.clientWidth }
      })
      expect(layout.top).toBeGreaterThanOrEqual(layout.headerBottom)
      expect(layout.height).toBeLessThanOrEqual(layout.lineHeight * 2 + 3)
      expect(layout.tabTop).toBeGreaterThanOrEqual(layout.bottom)
      expect(layout.overflow).toBeLessThanOrEqual(1)
      await appWindow.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
      const screenshot = await electronApp.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.capturePage()).toPNG().toString('base64'))
      await writeFile(testInfo.outputPath(`workspace-description-sidebar-${theme}-${scale}.png`), Buffer.from(screenshot, 'base64'))
    }
  }

  await header.click()
  await expect(header).toHaveAttribute('aria-expanded', 'false')
  await expect(description).toBeVisible()
  await expect(workspace.getByRole('tab')).toHaveCount(0)
  await electronApp.evaluate(({ BrowserWindow }, id) => BrowserWindow.getAllWindows()[0]!.webContents.send('browser:edit-tab-group', id), workspaceId)
  const editor = appWindow.getByRole('dialog', { name: 'Edit workspace', exact: true })
  await editor.getByRole('textbox', { name: 'Description', exact: true }).fill('Review the saved cart.')
  await editor.getByRole('button', { name: 'Save changes', exact: true }).click()
  await rail.hover()
  await expect(description).toHaveText('Review the saved cart.')

  const pin = rail.locator('.tab-rail-pin')
  if (await pin.getAttribute('aria-pressed') === 'true') await pin.click()
  await appWindow.locator('input.address').focus()
  await appWindow.mouse.move(1000 / 1.25, 500 / 1.25)
  await expect(rail).toHaveClass(/rail-collapsed/)
  await expect(description).toBeHidden()
  await expect(header).toHaveAttribute('title', /Review the saved cart\./)
  await rail.hover()
  await expect(description).toBeVisible()
  await appWindow.evaluate(() => (window as unknown as { hronautSettings: HronautSettingsApi }).hronautSettings.setTabPosition('top'))
  await expect(appWindow.locator('.workspace-tab-description')).toHaveCount(0)
})
