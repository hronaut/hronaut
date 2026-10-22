import { expect, test } from './fixtures.js'

type MenuGlobal = typeof globalThis & { __hronautTabMenu?: Electron.Menu }

test('New Tab in a tab\'s or a workspace\'s menu opens the tab in that workspace with the cursor in the address field', async ({ appWindow, electronApp }) => {
  const workspace = async (name: string) => {
    const created = await appWindow.evaluate(`window.hronaut.createWorkspace({ name: ${JSON.stringify(name)}, storage: 'scratch' })`) as {
      mcpTabGroups: Array<{ id: string, name: string }>
    }
    return created.mcpTabGroups.find(group => group.name === name)!.id
  }
  const client = await workspace('Menu client')
  const own = await workspace('Menu own')
  await appWindow.evaluate(`window.hronaut.newTab({ url: 'data:text/html,<title>Client page</title>', mcpGroupId: ${JSON.stringify(client)}, active: true })`)
  const tabs = () => appWindow.evaluate(`window.hronaut.getState().then((state) => state.tabs.map((tab) => ({ id: tab.id, workspace: tab.mcpGroupId, active: tab.active })))`) as Promise<Array<{ id: string, workspace?: string, active: boolean }>>
  const address = appWindow.getByRole('combobox', { name: 'Address', exact: true })
  const showOwnPage = async () => {
    await appWindow.evaluate(`window.hronaut.newTab({ url: 'data:text/html,<title>Own page</title>', mcpGroupId: ${JSON.stringify(own)}, active: true })`)
    await appWindow.locator('.tab', { hasText: 'Own page' }).last().click()
    await expect(address).not.toBeFocused()
  }

  await electronApp.evaluate(({ Menu }) => {
    ;(globalThis as MenuGlobal).__hronautTabMenu = undefined
    Menu.prototype.popup = function (): void {
      ;(globalThis as MenuGlobal).__hronautTabMenu = this
    }
  })
  const clickMenuItem = async (id: string) => {
    await expect.poll(() => electronApp.evaluate(() => (globalThis as MenuGlobal).__hronautTabMenu !== undefined)).toBe(true)
    await electronApp.evaluate((_electron, menuId) => {
      const menu = (globalThis as MenuGlobal).__hronautTabMenu
      ;(globalThis as MenuGlobal).__hronautTabMenu = undefined
      const item = menu?.getMenuItemById(menuId)
      if (!item?.click || !item.enabled) throw new Error(`${menuId} was not in the menu`)
      ;(item.click as unknown as () => void)()
    }, id)
  }
  const opensInClient = async (open: () => Promise<void>) => {
    const before = new Set((await tabs()).map((tab) => tab.id))
    await open()
    await expect.poll(async () => (await tabs()).filter((tab) => !before.has(tab.id)).map(({ workspace, active }) => ({ workspace, active })))
      .toEqual([{ workspace: client, active: true }])
    await expect(address).toBeFocused()
  }

  // New Tab opened the tab in the workspace of the tab shown, not of the tab whose menu it was, and left the cursor out
  // of the address field, though the + button and Ctrl/Cmd+T put it there.
  await showOwnPage()
  await opensInClient(async () => {
    await appWindow.locator('.tab', { hasText: 'Client page' }).first().click({ button: 'right' })
    await clickMenuItem('new-tab')
  })

  // New Tab in Workspace, from the workspace's own menu, left the cursor out of the address field too.
  await showOwnPage()
  await opensInClient(async () => {
    await appWindow.locator('.tab-group-label', { hasText: 'Menu client' }).click({ button: 'right' })
    await clickMenuItem('new-tab-in-workspace')
  })
})
