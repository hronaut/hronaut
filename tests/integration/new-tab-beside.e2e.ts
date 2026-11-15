import { expect, test } from './fixtures.js'

type State = { activeTabId?: string; tabs: Array<{ id: string; url: string; title: string; mcpGroupId?: string }> }
type Api = { hronaut: { newTab(options: { url: string; active: boolean }): Promise<State>; getState(): Promise<State> } }
type MenuGlobal = typeof globalThis & { __hronautTabMenu?: Electron.Menu }

// The tab menu's New Tab opened at the end of the workspace, where Chrome's New tab to the right opens beside the tab.
test('the tab menu opens a new tab right after its tab, as Chrome\'s New tab to the right', async ({ electronApp, appWindow }) => {
  const urls = ['First', 'Second', 'Third'].map(name => `data:text/html,<title>Beside ${name}</title><main>${name}</main>`)
  for (const url of urls) await appWindow.evaluate(url => (window as unknown as Api).hronaut.newTab({ url, active: true }), url)
  const websiteTabs = () => appWindow.evaluate(async () => {
    const state = await (window as unknown as Api).hronaut.getState()
    return state.tabs.filter(tab => tab.mcpGroupId).map(tab => ({ url: tab.url, active: tab.id === state.activeTabId }))
  })
  await expect.poll(async () => (await websiteTabs()).length).toBe(3)

  await electronApp.evaluate(({ Menu }) => {
    ;(globalThis as MenuGlobal).__hronautTabMenu = undefined
    Menu.prototype.popup = function (): void {
      ;(globalThis as MenuGlobal).__hronautTabMenu = this
    }
  })
  const second = appWindow.getByRole('tab', { name: /^Beside Second/ })
  await second.click()
  await expect.poll(async () => (await websiteTabs()).findIndex(tab => tab.active)).toBe(1)
  await second.click({ button: 'right' })
  await expect.poll(() => electronApp.evaluate(() => (globalThis as MenuGlobal).__hronautTabMenu?.getMenuItemById('new-tab')?.label ?? null))
    .toBe('New Tab to the Right')
  await electronApp.evaluate(() => { (globalThis as MenuGlobal).__hronautTabMenu!.getMenuItemById('new-tab')!.click() })

  await expect.poll(websiteTabs).toEqual([
    { url: urls[0], active: false },
    { url: urls[1], active: false },
    { url: 'about:blank', active: true },
    { url: urls[2], active: false }
  ])
  // As from the + button, the cursor waits in the address field.
  await expect(appWindow.getByRole('combobox', { name: 'Address' })).toBeFocused()
})
