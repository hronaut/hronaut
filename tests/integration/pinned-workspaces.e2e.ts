import type { ElectronApplication, Page } from '@playwright/test'
import { expect, test } from './fixtures.js'

type MenuScope = typeof globalThis & { __pinnedWorkspaceMenu?: Electron.Menu }

const NAMES = ['Pin alpha', 'Pin beta', 'Pin gamma']

/** The rail's order of this test's workspaces. */
function railOrder(appWindow: Page): Promise<string[]> {
  return appWindow.locator('.tab-group-label .tab-group-name').allTextContents().then((names) => names.filter((name) => NAMES.includes(name)))
}

/** Opens a workspace's menu from its rail header and chooses one item, returning the item's label. */
async function chooseFromWorkspaceMenu(electronApp: ElectronApplication, appWindow: Page, name: string, id: string): Promise<string> {
  await electronApp.evaluate(() => { (globalThis as MenuScope).__pinnedWorkspaceMenu = undefined })
  await appWindow.locator('.tab-group-label', { hasText: name }).click({ button: 'right' })
  await expect.poll(() => electronApp.evaluate((_electron, itemId) => (globalThis as MenuScope).__pinnedWorkspaceMenu?.getMenuItemById(itemId)?.label ?? null, id)).not.toBeNull()
  return electronApp.evaluate((_electron, itemId) => {
    const item = (globalThis as MenuScope).__pinnedWorkspaceMenu?.getMenuItemById(itemId)
    if (!item?.click) throw new Error(`Workspace menu item ${itemId} was not found`)
    const label = item.label
    ;(item.click as unknown as () => void)()
    return label
  }, id)
}

test('pins workspaces to the top of the rail in the order they were pinned, and lists them in the switcher', async ({ appWindow, electronApp }) => {
  await appWindow.evaluate("window.hronautSettings.setTabPosition('left')")
  for (const name of NAMES) await appWindow.evaluate((workspace) => (window as unknown as { hronaut: { createWorkspace: (options: { name: string; storage: string }) => Promise<unknown> } }).hronaut.createWorkspace({ name: workspace, storage: 'scratch' }), name)
  await electronApp.evaluate(({ Menu }) => {
    Menu.prototype.popup = function (): void {
      ;(globalThis as MenuScope).__pinnedWorkspaceMenu = this
    }
  })
  await expect.poll(() => railOrder(appWindow)).toEqual(NAMES)

  expect(await chooseFromWorkspaceMenu(electronApp, appWindow, 'Pin gamma', 'pin-workspace')).toBe('Pin Workspace to Top')
  await expect.poll(() => railOrder(appWindow)).toEqual(['Pin gamma', 'Pin alpha', 'Pin beta'])
  const gamma = appWindow.getByRole('button', { name: /^(Collapse|Expand) workspace Pin gamma/u })
  await expect(gamma.getByTestId('workspace-pinned')).toBeVisible()
  await expect(gamma).toHaveAccessibleDescription(/Pinned to the top/u)
  // The pin is saved with the workspace, as a time.
  const pinnedAt = await appWindow.evaluate(async () => (await (window as unknown as { hronaut: { getState: () => Promise<{ mcpTabGroups: Array<{ name: string; pinnedAt?: string }> }> } }).hronaut.getState()).mcpTabGroups.find((workspace) => workspace.name === 'Pin gamma')?.pinnedAt)
  expect(Number.isFinite(Date.parse(pinnedAt ?? ''))).toBe(true)

  // A later pin goes after the earlier one.
  await chooseFromWorkspaceMenu(electronApp, appWindow, 'Pin beta', 'pin-workspace')
  await expect.poll(() => railOrder(appWindow)).toEqual(['Pin gamma', 'Pin beta', 'Pin alpha'])

  // The switcher lists pinned workspaces before the rest and says so.
  await appWindow.locator('.tab-group-label', { hasText: 'Pin alpha' }).click()
  await appWindow.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K')
  const switcher = appWindow.getByRole('dialog', { name: 'Switch workspace' })
  await expect(switcher).toBeVisible()
  const options = switcher.getByRole('option')
  // The last workspace created is the one in view, so it is Current too.
  await expect(options.nth(0)).toHaveAccessibleName(/^Pin gamma, (Current, )?Pinned, /u)
  await expect(options.nth(1)).toHaveAccessibleName(/^Pin beta, (Current, )?Pinned, /u)
  await expect(switcher.getByRole('option', { name: /^Pin alpha/u })).not.toHaveAccessibleName(/Pinned/u)
  await appWindow.keyboard.press('Escape')
  await expect(switcher).toBeHidden()

  // Unpinning puts it back in its place among the rest.
  expect(await chooseFromWorkspaceMenu(electronApp, appWindow, 'Pin gamma', 'pin-workspace')).toBe('Unpin Workspace')
  await expect.poll(() => railOrder(appWindow)).toEqual(['Pin beta', 'Pin alpha', 'Pin gamma'])
  await expect(gamma.getByTestId('workspace-pinned')).toHaveCount(0)
})
