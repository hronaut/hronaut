import type { ElectronApplication, Locator } from '@playwright/test'
import type { HronautApi, McpTabActivity } from '../../src/shared/types.js'
import { expect, test } from './fixtures.js'

async function activity(app: ElectronApplication, tabId: string, phase: McpTabActivity['phase']): Promise<void> {
  await app.evaluate(({ BrowserWindow }, event) => {
    BrowserWindow.getAllWindows()[0]!.webContents.send('browser:mcp-tab-activity', event)
  }, { activityId: `activity-${tabId}`, tabId, toolName: 'browser_snapshot', phase, occurredAt: Date.now() })
}

async function expectBadgeFits(tab: Locator): Promise<void> {
  const badge = tab.locator('.tab-agent-activity')
  await expect(badge).toBeVisible()
  const tabBounds = (await tab.boundingBox())!
  const badgeBounds = (await badge.boundingBox())!
  expect(badgeBounds.x).toBeGreaterThanOrEqual(tabBounds.x)
  expect(badgeBounds.y).toBeGreaterThanOrEqual(tabBounds.y)
  expect(badgeBounds.x + badgeBounds.width).toBeLessThanOrEqual(tabBounds.x + tabBounds.width)
  expect(badgeBounds.y + badgeBounds.height).toBeLessThanOrEqual(tabBounds.y + tabBounds.height)
}

for (const position of ['top', 'left']) {
  test(`keeps agent activity distinct from tab selection with ${position} tabs`, async ({ appWindow, electronApp }, testInfo) => {
    await appWindow.evaluate(`window.hronautSettings.setTabPosition('${position}')`)
    const ids = await appWindow.evaluate(async () => {
      const api = (window as unknown as { hronaut: HronautApi }).hronaut
      const workspace = await api.createWorkspace({ name: 'Research', color: 'purple', storage: 'scratch' })
      const first = workspace.activeTabId!
      await api.navigate({ tabId: first, url: 'data:text/html,<title>Comparing product options</title><h1>Research</h1>' })
      const second = (await api.newTab({ url: 'data:text/html,<title>Project notes</title>', active: true })).activeTabId!
      const pinned = (await api.newTab({ url: 'data:text/html,<title>Pinned reference</title>', active: false })).tabs.at(-1)!.id
      await api.setTabPinned(pinned, true)
      return { first, second, pinned }
    })
    const workingTab = appWindow.locator(`[data-tab-id="${ids.first}"]`)
    const selectedTab = appWindow.locator(`[data-tab-id="${ids.second}"]`)
    const pinnedTab = appWindow.locator(`[data-tab-id="${ids.pinned}"]`)
    await activity(electronApp, ids.first, 'started')
    await activity(electronApp, ids.pinned, 'started')

    for (const theme of ['light', 'dark']) {
      await appWindow.evaluate(`window.hronautSettings.setTheme('${theme}')`)
      if (position === 'left') await workingTab.hover()
      await expect(workingTab).toHaveAttribute('aria-description', 'Agent active')
      await expect(workingTab).toHaveAttribute('aria-selected', 'false')
      await expect(selectedTab).toHaveAttribute('aria-selected', 'true')
      await expect(selectedTab.locator('.tab-agent-activity')).toHaveCount(0)
      await expectBadgeFits(workingTab)
      await expectBadgeFits(pinnedTab)
      await expect(workingTab.locator('.tab-close')).toBeVisible()
      await appWindow.locator(position === 'left' ? '.browser-tabs-bar' : '.topbar').screenshot({ path: testInfo.outputPath(`agent-activity-${position}-${theme}.png`) })
    }

    await appWindow.emulateMedia({ reducedMotion: 'reduce' })
    await expect(workingTab.locator('.tab-agent-activity-dot')).toHaveCSS('animation-name', 'none')
    await expectBadgeFits(workingTab)
    if (position === 'left') {
      await appWindow.getByRole('button', { name: 'Collapse tab rail when not in use', exact: true }).click()
      await appWindow.locator('.address-form input').focus()
      await appWindow.mouse.move(800, 400)
      await expect(appWindow.locator('.browser-tabs-bar')).toHaveClass(/rail-collapsed/)
      await expectBadgeFits(workingTab)
      await expectBadgeFits(pinnedTab)
      await appWindow.locator('.browser-tabs-bar').screenshot({ path: testInfo.outputPath('agent-activity-collapsed.png') })
    }
    await activity(electronApp, ids.first, 'finished')
    await expect(workingTab.locator('.tab-agent-activity')).toHaveCount(0)
    await expect(workingTab).not.toHaveAttribute('aria-description')
    await expectBadgeFits(pinnedTab)
    await activity(electronApp, ids.pinned, 'finished')
    await expect(pinnedTab.locator('.tab-agent-activity')).toHaveCount(0)
  })
}
