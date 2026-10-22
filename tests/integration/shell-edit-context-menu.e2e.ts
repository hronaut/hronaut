import { expect, test } from './fixtures.js'

// A right-click in a text field of Hronaut's own window opened no menu, so a license key could be pasted only with
// the keyboard. The native menu cannot be read from the page, so the test records the menu Hronaut pops up and
// chooses its items in the main process.
test('a right-click in a text field of the window offers its editing actions, and Paste pastes', async ({ appWindow, electronApp }) => {
  await electronApp.evaluate(({ Menu }) => {
    const shown: Electron.Menu[] = []
    Object.assign(globalThis, { shownEditMenus: shown })
    Menu.prototype.popup = function popup(this: Electron.Menu) { shown.push(this) }
  })
  const lastMenu = () => electronApp.evaluate(() => {
    const shown = (globalThis as unknown as { shownEditMenus: Electron.Menu[] }).shownEditMenus
    return shown.at(-1)?.items.filter(item => item.type !== 'separator').map(item => ({ id: item.id, label: item.label, enabled: item.enabled })) ?? null
  })
  const forgetMenus = () => electronApp.evaluate(() => {
    (globalThis as unknown as { shownEditMenus: Electron.Menu[] }).shownEditMenus.length = 0
  })
  const choose = (id: string) => electronApp.evaluate((_electron, itemId) => {
    const shown = (globalThis as unknown as { shownEditMenus: Electron.Menu[] }).shownEditMenus
    const item = shown.at(-1)!.items.find(candidate => candidate.id === itemId)!
    ;(item.click as () => void)()
  }, id)

  // In the address bar of a new tab, selected text is copied.
  await appWindow.evaluate(async () => (window as unknown as { hronaut: { newTab(options: { active: boolean }): Promise<unknown> } }).hronaut.newTab({ active: true }))
  const address = appWindow.getByRole('combobox', { name: 'Address', exact: true })
  await address.fill('hronaut.dev')
  await address.selectText()
  await address.click({ button: 'right' })
  await expect.poll(async () => (await lastMenu())?.find(item => item.id === 'copy')?.enabled).toBe(true)
  await choose('copy')
  await expect.poll(() => electronApp.evaluate(({ clipboard }) => clipboard.readText())).toBe('hronaut.dev')

  // The test profile has no secure storage, which the license field needs before it takes a key.
  await electronApp.evaluate(({ BrowserWindow, clipboard, ipcMain }) => {
    clipboard.writeText('ABCD-EFGH-IJKL-MNOP')
    const state = { status: 'not-activated', active: false, secureStorageAvailable: true }
    ipcMain.removeHandler('license:get-state')
    ipcMain.handle('license:get-state', () => state)
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send('license:changed', state)
  })
  await appWindow.getByRole('button', { name: 'Settings', exact: true }).click()
  const settings = appWindow.getByRole('tabpanel', { name: 'Settings', exact: true })
  await settings.locator('.settings-nav-item', { hasText: 'License' }).click()
  const key = settings.getByLabel('License key')
  await expect(key).toBeEnabled()
  await forgetMenus()
  await key.click({ button: 'right' })
  await expect.poll(async () => (await lastMenu())?.map(item => item.label))
    .toEqual(['Undo', 'Redo', 'Cut', 'Copy', 'Paste', 'Delete', 'Select All'])
  expect((await lastMenu())!.find(item => item.id === 'paste')!.enabled).toBe(true)
  await choose('paste')
  await expect(key).toHaveValue('ABCD-EFGH-IJKL-MNOP')
  // A password field keeps its key: it is not copied or cut out of it.
  await key.selectText()
  await forgetMenus()
  await key.click({ button: 'right' })
  await expect.poll(async () => (await lastMenu())?.find(item => item.id === 'select-all')?.enabled).toBe(true)
  // Delete is available, so the key is still selected when Cut and Copy are not.
  expect((await lastMenu())!.filter(item => ['cut', 'copy', 'delete'].includes(item.id)).map(item => item.enabled)).toEqual([false, false, true])
})
