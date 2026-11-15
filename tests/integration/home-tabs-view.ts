import type { ElectronApplication, Locator, Page } from '@playwright/test'
import type { BrowserTabOverviewPreview, HronautApi } from '../../src/shared/types.js'
import { expect } from './fixtures.js'

/** Hronaut Home's page, once Playwright knows it. */
export async function homePage(electronApp: ElectronApplication): Promise<Page> {
  let found: Page | undefined
  await expect.poll(() => {
    found = electronApp.context().pages().find(page => page.url().startsWith('hronaut://home'))
    return found !== undefined
  }, { message: 'Playwright knows no Home page' }).toBe(true)
  return found!
}

export interface TabsView {
  home: Page
  view: Locator
  search: Locator
  results: Locator
}

/** Home's Tabs view and its parts, whether or not it is shown. */
export function tabsViewOf(home: Page): TabsView {
  const view = home.locator('#home-tabs')
  return { home, view, search: view.getByRole('searchbox', { name: 'Search tabs', exact: true }), results: view.locator('#tab-results') }
}

/**
 * Opens Search tabs as a person does, from the toolbar button or with the shortcut, and answers Home's Tabs view once
 * Home is the tab shown and its search field has the keyboard.
 */
export async function openTabsView(appWindow: Page, electronApp: ElectronApplication, how: 'button' | 'shortcut' = 'button'): Promise<TabsView> {
  if (how === 'button') await appWindow.getByRole('button', { name: 'Search tabs', exact: true }).click()
  else await appWindow.keyboard.press('ControlOrMeta+Shift+A')
  const parts = tabsViewOf(await homePage(electronApp))
  await expect(parts.view).toBeVisible()
  await expect(parts.search).toBeFocused()
  await expect.poll(() => activeTabUrl(appWindow)).toMatch(/^hronaut:\/\/home/u)
  return parts
}

/**
 * Presses a browser shortcut in Home as a person does: through Electron's input, which the browser reads before the
 * page, unlike Playwright's keys, which only the page sees.
 */
export async function pressShortcutInHome(electronApp: ElectronApplication, keyCode: string, modifiers: Array<'control' | 'shift' | 'alt' | 'meta'>): Promise<void> {
  await electronApp.evaluate(({ webContents }, input) => {
    const home = webContents.getAllWebContents().find(contents => contents.getURL().startsWith('hronaut://home'))
    if (!home) throw new Error('No Home web contents')
    home.focus()
    home.sendInputEvent({ type: 'keyDown', keyCode: input.keyCode, modifiers: input.modifiers })
    home.sendInputEvent({ type: 'keyUp', keyCode: input.keyCode, modifiers: input.modifiers })
  }, { keyCode, modifiers })
}

/** The address of the tab Hronaut shows. */
export function activeTabUrl(appWindow: Page): Promise<string | undefined> {
  return appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState()
    .then(state => state.tabs.find(tab => tab.id === state.activeTabId)?.url))
}

/** The title of the tab Hronaut shows. */
export function activeTabTitle(appWindow: Page): Promise<string | undefined> {
  return appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState()
    .then(state => state.tabs.find(tab => tab.id === state.activeTabId)?.title))
}

/** The stored pictures of these tabs, as Home's Tabs view reads them. */
export async function tabPreviews(electronApp: ElectronApplication, tabIds: string[]): Promise<BrowserTabOverviewPreview[]> {
  const home = await homePage(electronApp)
  return home.evaluate(ids => (window as unknown as { hronautHome: { getTabPreviews(ids: string[]): Promise<BrowserTabOverviewPreview[]> } }).hronautHome
    .getTabPreviews(ids), tabIds)
}

/** How many of these tabs have a stored picture. */
export async function storedPreviews(electronApp: ElectronApplication, tabIds: string[]): Promise<number> {
  return (await tabPreviews(electronApp, tabIds)).length
}
