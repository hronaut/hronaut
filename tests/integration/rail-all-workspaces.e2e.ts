import type { Page } from '@playwright/test'
import type { BrowserState } from '../../src/shared/types.js'
import { expect, test } from './fixtures.js'

async function state(appWindow: Page): Promise<BrowserState> {
  return appWindow.evaluate('window.hronaut.getState()') as Promise<BrowserState>
}

test('folds a long rail into an All N workspaces row that opens the switcher and keeps the workspace in view listed', async ({ appWindow, electronApp }) => {
  await electronApp.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]!.setSize(1440, 900) })
  await appWindow.evaluate("window.hronautSettings.setTabPosition('left')")
  const rail = appWindow.getByRole('navigation', { name: 'Tab navigation' })
  await expect(rail).toHaveClass(/vertical/)
  try {
    const existing = (await state(appWindow)).mcpTabGroups.length
    for (let index = existing + 1; index <= 14; index++) {
      await appWindow.evaluate(`window.hronaut.createWorkspace({ name: ${JSON.stringify(`Client ${index}`)}, storage: 'scratch' })`)
    }
    const groups = (await state(appWindow)).mcpTabGroups
    expect(groups).toHaveLength(14)
    const headers = rail.locator('.tab-group-label > span:first-of-type')

    // The last workspace created is in view: the rail lists the first ten and that one, then the row.
    await expect(headers).toHaveText([...groups.slice(0, 10), groups[13]!].map((group) => group.name))
    const row = rail.getByRole('button', { name: 'All 14 workspaces', exact: true })
    await expect(row).toBeVisible()
    await row.scrollIntoViewIfNeeded()
    const box = (await row.boundingBox())!
    expect(box.height).toBeGreaterThanOrEqual(32)

    // The row opens the switcher, which lists every workspace; choosing a folded one lists it in the rail.
    await row.click()
    const switcher = appWindow.getByRole('dialog', { name: 'Switch workspace' })
    await expect(switcher).toBeVisible()
    await expect(row).toHaveAttribute('aria-expanded', 'true')
    await expect(switcher.getByRole('group', { name: 'Open workspaces' }).getByRole('option')).toHaveCount(14)
    const folded = groups[11]!
    await switcher.getByRole('combobox', { name: 'Search workspaces' }).fill(folded.name)
    await expect(switcher.getByRole('option', { name: new RegExp(`^${folded.name},`) })).toHaveAttribute('aria-selected', 'true')
    await appWindow.keyboard.press('Enter')
    await expect(switcher).toHaveCount(0)
    await expect(headers).toHaveText([...groups.slice(0, 10), folded].map((group) => group.name))

    // Back in a workspace among the first ten, the one chosen folds away again.
    const tenthTab = (await state(appWindow)).tabs.find((tab) => tab.mcpGroupId === groups[9]!.id)!
    await rail.locator(`[data-tab-id="${tenthTab.id}"]`).click()
    await expect.poll(async () => (await state(appWindow)).activeTabId).toBe(tenthTab.id)
    await expect(headers).toHaveText(groups.slice(0, 10).map((group) => group.name))
    await expect(row).toBeVisible()
  } finally {
    await appWindow.evaluate("window.hronautSettings.setTabPosition('top')").catch(() => undefined)
  }
})
