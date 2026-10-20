import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Page } from '@playwright/test'
import type { BrowserState } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

async function state(appWindow: Page): Promise<BrowserState> {
  return appWindow.evaluate('window.hronaut.getState()') as Promise<BrowserState>
}

async function activeWorkspace(appWindow: Page): Promise<string | undefined> {
  const current = await state(appWindow)
  const groupId = current.tabs.find((tab) => tab.id === current.activeTabId)?.mcpGroupId
  return current.mcpTabGroups.find((group) => group.id === groupId)?.name
}

/** Holds Enter on a focused button that opens a search, and checks each repeat reaches that search while it is open. */
async function holdEnterIntoSearch(appWindow: Page, search: ReturnType<Page['getByRole']>): Promise<void> {
  await appWindow.keyboard.down('Enter')
  for (let repeat = 0; repeat < 6; repeat += 1) {
    // Repeats at about a keyboard's pace.
    await appWindow.waitForTimeout(50)
    await expect(search).toBeFocused()
    await appWindow.keyboard.down('Enter')
  }
  await appWindow.keyboard.up('Enter')
}

test('a held Enter on Switch workspace leaves the choice of workspace to the switcher', async ({ appWindow, electronApp }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end('<title>Held Enter shop</title><main>Shop</main><script>window.keys=[];onkeydown=e=>keys.push(e.key)</script>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  try {
    await electronApp.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]!.setSize(1440, 900) })
    await appWindow.evaluate("window.hronautSettings.setTabPosition('left')")
    await expect(appWindow.getByRole('navigation', { name: 'Tab navigation' })).toHaveClass(/vertical/)
    const shop = await appWindow.evaluate("window.hronaut.createWorkspace({ name: 'Shop', storage: 'scratch' })") as BrowserState
    const shopId = shop.mcpTabGroups.find((group) => group.name === 'Shop')!.id
    const shopTabId = shop.tabs.find((tab) => tab.mcpGroupId === shopId)!.id
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`
    await appWindow.evaluate(`window.hronaut.navigate({ tabId: ${JSON.stringify(shopTabId)}, url: ${JSON.stringify(url)} })`)
    await expect.poll(() => state(appWindow).then((current) => current.tabs.find((tab) => tab.id === shopTabId)?.title)).toBe('Held Enter shop')
    await appWindow.evaluate("window.hronaut.createWorkspace({ name: 'Docs', storage: 'scratch' })")
    await expect.poll(() => activeWorkspace(appWindow)).toBe('Docs')

    const railButton = appWindow.locator('.workspace-rail-header').getByRole('button', { name: 'Switch workspace', exact: true })
    await railButton.focus()
    await expect(railButton).toBeFocused()
    const switcher = appWindow.getByRole('dialog', { name: 'Switch workspace' })
    const search = switcher.getByRole('combobox', { name: 'Search workspaces' })
    // The switcher opens with the focus in its search field and Shop, the other workspace, selected.
    await holdEnterIntoSearch(appWindow, search)
    await expect(switcher.getByRole('option', { name: /^Shop,/ })).toHaveAttribute('aria-selected', 'true')
    expect(await activeWorkspace(appWindow)).toBe('Docs')

    await appWindow.keyboard.press('Enter')
    await expect(switcher).toHaveCount(0)
    await expect.poll(() => activeWorkspace(appWindow)).toBe('Shop')
  } finally {
    await closeFixtureServer(server)
  }
})

test('a held Enter on the command palette button leaves the choice of command to the palette', async ({ appWindow }) => {
  const commandButton = appWindow.getByRole('button', { name: 'Open command palette' })
  await commandButton.focus()
  await expect(commandButton).toBeFocused()
  const palette = appWindow.getByRole('dialog', { name: 'Commands' })
  const search = palette.getByRole('combobox', { name: 'Search commands' })
  await holdEnterIntoSearch(appWindow, search)
  await expect(palette).toBeVisible()

  await appWindow.keyboard.press('Escape')
  await expect(palette).toHaveCount(0)
})
