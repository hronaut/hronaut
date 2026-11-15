import { createServer } from 'node:http'
import type { ElectronApplication, Page } from '@playwright/test'
import { closeFixtureServer, expect, test } from './fixtures.js'

interface HandoverState {
  activeTabId: string | null
  tabs: Array<{ id: string; mcpGroupId?: string; sleeping?: boolean }>
  mcpTabGroups: Array<{ id: string; name: string }>
}
type HandoverScope = typeof globalThis & {
  hronaut: {
    closeTab: (tabId: string) => Promise<unknown>
    createWorkspace: (options: { name: string; storage: string }) => Promise<unknown>
    getState: () => Promise<HandoverState>
    navigate: (options: { tabId: string; url: string }) => Promise<unknown>
    selectTab: (tabId: string) => Promise<unknown>
  }
}
type MenuScope = typeof globalThis & { __hronautTabMenu?: Electron.Menu }

const NAMES = ['Handover alpha', 'Handover beta', 'Handover gamma']

/** The name of the workspace whose tab is in view. */
async function workspaceInView(appWindow: Page): Promise<string | null> {
  const state = await appWindow.evaluate(() => (globalThis as HandoverScope).hronaut.getState())
  const tab = state.tabs.find((candidate) => candidate.id === state.activeTabId)
  return state.mcpTabGroups.find((group) => group.id === tab?.mcpGroupId)?.name ?? null
}

/** Puts the tab named by its title to sleep from its context menu, as a person does. */
async function sleepFromContextMenu(appWindow: Page, electronApp: ElectronApplication, title: RegExp): Promise<void> {
  await electronApp.evaluate(({ Menu }) => {
    ;(globalThis as MenuScope).__hronautTabMenu = undefined
    Menu.prototype.popup = function (): void {
      ;(globalThis as MenuScope).__hronautTabMenu = this
    }
  })
  await appWindow.getByRole('tab', { name: title }).click({ button: 'right' })
  await expect.poll(() => electronApp.evaluate(() => (globalThis as MenuScope).__hronautTabMenu?.getMenuItemById('sleep-tab')?.enabled ?? null))
    .toBe(true)
  await electronApp.evaluate(() => {
    const item = (globalThis as MenuScope).__hronautTabMenu?.getMenuItemById('sleep-tab')
    if (!item?.click) throw new Error('Put Tab to Sleep was not in the tab menu')
    ;(item.click as unknown as () => void)()
  })
}

test('closing or putting to sleep the tab in view passes over a folded workspace and leaves it folded, as Chrome does', async ({ appWindow, electronApp }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end('<!doctype html><title>Handover page</title><main>Handover page</main>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Handover fixture did not expose a port')
    await appWindow.evaluate("window.hronautSettings.setTabPosition('left')")
    await expect(appWindow.locator('.browser-tabs-bar.vertical')).toBeVisible()
    for (const name of NAMES) {
      await appWindow.evaluate((workspace) => (globalThis as HandoverScope).hronaut.createWorkspace({ name: workspace, storage: 'scratch' }), name)
    }
    await expect.poll(() => workspaceInView(appWindow)).toBe('Handover gamma')
    const beta = appWindow.getByRole('button', { name: /^(Collapse|Expand) workspace Handover beta/u })
    await beta.click()
    await expect(beta).toHaveAttribute('aria-expanded', 'false')

    const alphaTabId = await appWindow.evaluate(async () => {
      const state = await (globalThis as HandoverScope).hronaut.getState()
      const alpha = state.mcpTabGroups.find((group) => group.name === 'Handover alpha')
      return state.tabs.find((tab) => tab.mcpGroupId === alpha?.id)?.id ?? ''
    })
    expect(alphaTabId).not.toBe('')
    const showAlpha = async () => {
      await appWindow.evaluate((tabId) => (globalThis as HandoverScope).hronaut.selectTab(tabId), alphaTabId)
      await expect.poll(() => workspaceInView(appWindow)).toBe('Handover alpha')
    }
    await showAlpha()
    const pageUrl = `http://127.0.0.1:${address.port}/`
    await appWindow.evaluate((target) => (globalThis as HandoverScope).hronaut.navigate(target), { tabId: alphaTabId, url: pageUrl })
    await expect(appWindow.getByRole('tab', { name: /^Handover page/u })).toBeVisible()

    // Alpha's only tab goes to sleep: the view goes on to gamma rather than to the folded beta.
    await sleepFromContextMenu(appWindow, electronApp, /^Handover page/u)
    await expect.poll(() => workspaceInView(appWindow)).toBe('Handover gamma')
    await expect(beta).toHaveAttribute('aria-expanded', 'false')

    // So it does when that tab closes.
    await showAlpha()
    await appWindow.evaluate((tabId) => (globalThis as HandoverScope).hronaut.closeTab(tabId), alphaTabId)
    await expect.poll(async () => (await appWindow.evaluate(() => (globalThis as HandoverScope).hronaut.getState())).tabs
      .some((tab) => tab.id === alphaTabId)).toBe(false)
    await expect.poll(() => workspaceInView(appWindow)).toBe('Handover gamma')
    await expect(beta).toHaveAttribute('aria-expanded', 'false')
  } finally {
    await closeFixtureServer(server)
  }
})
