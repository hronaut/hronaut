import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { ElectronApplication, Page } from '@playwright/test'
import type { BrowserState } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

const primaryModifier = process.platform === 'darwin' ? 'Meta' : 'Control'

async function state(appWindow: Page): Promise<BrowserState> {
  return appWindow.evaluate('window.hronaut.getState()') as Promise<BrowserState>
}

async function activeWorkspace(appWindow: Page): Promise<string | undefined> {
  const current = await state(appWindow)
  const groupId = current.tabs.find((tab) => tab.id === current.activeTabId)?.mcpGroupId
  return current.mcpTabGroups.find((group) => group.id === groupId)?.name
}

/** Ctrl/Cmd+K as the person presses it in a page shown in the window. */
async function pressInPage(electronApp: ElectronApplication, matches: string): Promise<void> {
  await electronApp.evaluate(({ BrowserWindow, WebContentsView }, { matches, darwin }) => {
    const view = BrowserWindow.getAllWindows()[0]?.contentView.children.find((candidate) => (
      candidate instanceof WebContentsView && candidate.webContents.getURL().startsWith(matches)
    )) as Electron.WebContentsView | undefined
    if (!view) throw new Error(`No page starting with ${matches} is shown`)
    view.webContents.focus()
    const modifiers: Array<'control' | 'meta'> = [darwin ? 'meta' : 'control']
    view.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'K', modifiers })
    view.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'K', modifiers })
  }, { matches, darwin: process.platform === 'darwin' })
}

test('switches, finds and restores workspaces from the rail, Ctrl/Cmd+K and the command palette', async ({ appWindow, electronApp }) => {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(`<title>${request.url === '/cart' ? 'Cart' : 'Fixture'}</title><main>Fixture</main><script>window.keys=[];onkeydown=e=>keys.push(e.key)</script>`)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const site = `127.0.0.1:${(server.address() as AddressInfo).port}`
  try {
    await electronApp.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]!.setSize(1440, 900) })
    await appWindow.evaluate("window.hronautSettings.setTabPosition('left')")
    await expect(appWindow.getByRole('navigation', { name: 'Tab navigation' })).toHaveClass(/vertical/)

    // An archived client, a shop with a site open in it, and the docs workspace in view.
    const old = await appWindow.evaluate("window.hronaut.createWorkspace({ name: 'Old client', storage: 'scratch' })") as BrowserState
    const oldId = old.mcpTabGroups.find((group) => group.name === 'Old client')!.id
    await appWindow.evaluate(`window.hronaut.saveAndCloseTabGroup(${JSON.stringify(oldId)})`)
    const shop = await appWindow.evaluate("window.hronaut.createWorkspace({ name: 'Shop', storage: 'scratch' })") as BrowserState
    const shopId = shop.mcpTabGroups.find((group) => group.name === 'Shop')!.id
    const shopTabId = shop.tabs.find((tab) => tab.mcpGroupId === shopId)!.id
    await appWindow.evaluate(`window.hronaut.navigate({ tabId: ${JSON.stringify(shopTabId)}, url: ${JSON.stringify(`http://${site}/cart`)} })`)
    await expect.poll(() => state(appWindow).then((current) => current.tabs.find((tab) => tab.id === shopTabId)?.title)).toBe('Cart')
    await appWindow.evaluate("window.hronaut.createWorkspace({ name: 'Docs', storage: 'scratch' })")
    await expect.poll(() => activeWorkspace(appWindow)).toBe('Docs')

    // The rail's search icon opens the switcher, with the workspace used before this one selected.
    const railButton = appWindow.locator('.workspace-rail-header').getByRole('button', { name: 'Switch workspace', exact: true })
    await railButton.click()
    const switcher = appWindow.getByRole('dialog', { name: 'Switch workspace' })
    await expect(switcher).toBeVisible()
    await expect(railButton).toHaveAttribute('aria-expanded', 'true')
    const search = switcher.getByRole('combobox', { name: 'Search workspaces' })
    await expect(search).toBeFocused()
    await expect(switcher.getByRole('option', { name: /^Docs, Current/ })).toHaveAttribute('aria-current', 'true')
    await expect(switcher.getByRole('option', { name: /^Shop,/ })).toHaveAttribute('aria-selected', 'true')
    await expect(switcher.getByRole('group', { name: 'Archived' }).getByRole('option', { name: /^Old client, Archived/ })).toBeVisible()
    // The command palette button does not claim the switcher as its own.
    await expect(appWindow.getByRole('button', { name: 'Open command palette', exact: true })).toHaveAttribute('aria-expanded', 'false')

    // A site finds its workspace, and Enter switches to it.
    await search.fill(site)
    await expect(switcher.getByRole('option')).toHaveCount(1)
    await expect(switcher.getByRole('option', { name: new RegExp(`^Shop, 1 tab · ${site.replace(/[.]/g, '\\.')}$`) })).toHaveAttribute('aria-selected', 'true')
    await search.press('Enter')
    await expect(switcher).toHaveCount(0)
    await expect.poll(() => activeWorkspace(appWindow)).toBe('Shop')

    // A website keeps Ctrl/Cmd+K for itself.
    await pressInPage(electronApp, `http://${site}/cart`)
    await expect.poll(() => electronApp.evaluate(({ webContents }, url) => (
      webContents.getAllWebContents().find((contents) => contents.getURL() === url)?.executeJavaScript('window.keys') as Promise<string[]>
    ), `http://${site}/cart`)).toEqual(['k'])
    await expect(switcher).toHaveCount(0)

    // From the window, Ctrl/Cmd+K opens the switcher, which brings back an archived workspace.
    await appWindow.locator('.app-home-button').focus()
    await appWindow.keyboard.press(`${primaryModifier}+K`)
    await expect(switcher).toBeVisible()
    await switcher.getByRole('combobox', { name: 'Search workspaces' }).fill('old')
    await expect(switcher.getByRole('option', { name: /^Old client, Archived/ })).toHaveAttribute('aria-selected', 'true')
    await appWindow.keyboard.press('Enter')
    await expect(switcher).toHaveCount(0)
    await expect.poll(() => state(appWindow).then((current) => ({
      archived: current.savedTabGroups.some((group) => group.id === oldId),
      open: current.mcpTabGroups.some((group) => group.name === 'Old client')
    }))).toEqual({ archived: false, open: true })

    // Ctrl/Cmd+K again closes it, and the command palette's own command opens it in the palette's place.
    await appWindow.keyboard.press(`${primaryModifier}+K`)
    await expect(switcher).toBeVisible()
    await appWindow.keyboard.press(`${primaryModifier}+K`)
    await expect(switcher).toHaveCount(0)
    await appWindow.keyboard.press(`${primaryModifier}+Shift+P`)
    const palette = appWindow.getByRole('dialog', { name: 'Commands' })
    await palette.getByRole('combobox', { name: 'Search commands' }).fill('switch workspace')
    await palette.getByRole('combobox', { name: 'Search commands' }).press('Enter')
    await expect(switcher).toBeVisible()
    await expect(palette).toHaveCount(0)

    // Its footer hands off to tab search.
    await switcher.getByRole('button', { name: 'Search tabs', exact: true }).click()
    await expect(switcher).toHaveCount(0)
    const tabs = appWindow.getByRole('dialog', { name: 'Tabs', exact: true })
    await expect(tabs).toBeVisible()
    await appWindow.keyboard.press('Escape')
    await expect(tabs).toHaveCount(0)

    // On Hronaut's Home page, Ctrl/Cmd+K is the switcher's.
    await appWindow.evaluate("window.hronaut.newTab({ url: 'hronaut://home/', active: true })")
    await expect.poll(() => electronApp.evaluate(({ BrowserWindow, WebContentsView }) => (
      BrowserWindow.getAllWindows()[0]?.contentView.children.some((candidate) => (
        candidate instanceof WebContentsView && candidate.webContents.getURL().startsWith('hronaut://home')
      ))
    ))).toBe(true)
    await pressInPage(electronApp, 'hronaut://home')
    await expect(switcher).toBeVisible()
    await appWindow.keyboard.press('Escape')
    await expect(switcher).toHaveCount(0)
  } finally {
    await appWindow.evaluate("window.hronautSettings.setTabPosition('top')").catch(() => undefined)
    await closeFixtureServer(server)
  }
})
