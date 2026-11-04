import type { Page } from '@playwright/test'
import { expect, test } from './fixtures.js'

interface KeysState {
  activeTabId: string | null
  tabs: Array<{ id: string; mcpGroupId?: string }>
  mcpTabGroups: Array<{ id: string; name: string }>
}
type KeysScope = typeof globalThis & {
  hronaut: {
    createWorkspace: (options: { name: string; storage: string }) => Promise<unknown>
    getState: () => Promise<KeysState>
    selectTab: (tabId: string) => Promise<unknown>
  }
}

const NAMES = ['Keys alpha', 'Keys beta', 'Keys gamma']

/** The name of the workspace whose tab is in view. */
async function workspaceInView(appWindow: Page): Promise<string | null> {
  const state = await appWindow.evaluate(() => (globalThis as KeysScope).hronaut.getState())
  const tab = state.tabs.find((candidate) => candidate.id === state.activeTabId)
  return state.mcpTabGroups.find((group) => group.id === tab?.mcpGroupId)?.name ?? null
}

test('tab keys pass over the tabs of a folded workspace and leave it folded, as Chrome skips a collapsed group', async ({ appWindow }) => {
  const primary = process.platform === 'darwin' ? 'Meta' : 'Control'
  await appWindow.evaluate("window.hronautSettings.setTabPosition('left')")
  await expect(appWindow.locator('.browser-tabs-bar.vertical')).toBeVisible()
  for (const name of NAMES) {
    await appWindow.evaluate((workspace) => (globalThis as KeysScope).hronaut.createWorkspace({ name: workspace, storage: 'scratch' }), name)
  }
  await expect.poll(() => workspaceInView(appWindow)).toBe('Keys gamma')
  const beta = appWindow.getByRole('button', { name: /^(Collapse|Expand) workspace Keys beta/u })
  await beta.click()
  await expect(beta).toHaveAttribute('aria-expanded', 'false')

  const alphaTabId = await appWindow.evaluate(async () => {
    const state = await (globalThis as KeysScope).hronaut.getState()
    const alpha = state.mcpTabGroups.find((group) => group.name === 'Keys alpha')
    return state.tabs.find((tab) => tab.mcpGroupId === alpha?.id)?.id ?? ''
  })
  await appWindow.evaluate((tabId) => (globalThis as KeysScope).hronaut.selectTab(tabId), alphaTabId)
  await expect.poll(() => workspaceInView(appWindow)).toBe('Keys alpha')
  await appWindow.getByRole('button', { name: 'Open Hronaut Home' }).focus()

  await appWindow.keyboard.press('Control+Tab')
  await expect.poll(() => workspaceInView(appWindow)).toBe('Keys gamma')
  await appWindow.keyboard.press('Control+Shift+Tab')
  await expect.poll(() => workspaceInView(appWindow)).toBe('Keys alpha')
  // The last tab the strip shows is gamma's, after the folded workspace's.
  await appWindow.keyboard.press(`${primary}+9`)
  await expect.poll(() => workspaceInView(appWindow)).toBe('Keys gamma')
  await expect(beta).toHaveAttribute('aria-expanded', 'false')

  // Unfolded, the workspace's tab is the next one again.
  await beta.click()
  await expect(beta).toHaveAttribute('aria-expanded', 'true')
  await appWindow.getByRole('button', { name: 'Open Hronaut Home' }).focus()
  await appWindow.keyboard.press('Control+Shift+Tab')
  await expect.poll(() => workspaceInView(appWindow)).toBe('Keys beta')
})
