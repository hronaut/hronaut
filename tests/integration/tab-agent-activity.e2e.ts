import type { ElectronApplication, Locator } from '@playwright/test'
import type { HronautApi, McpTabActivity } from '../../src/shared/types.js'
import { expect, test } from './fixtures.js'

async function activity(app: ElectronApplication, tabId: string, phase: McpTabActivity['phase']): Promise<void> {
  await app.evaluate(({ BrowserWindow }, event) => {
    BrowserWindow.getAllWindows()[0]!.webContents.send('browser:mcp-tab-activity', event)
  }, { activityId: `activity-${tabId}`, tabId, toolName: 'browser_snapshot', phase, occurredAt: Date.now() })
}

async function expectOutlineFits(tab: Locator): Promise<void> {
  await expect(tab).toHaveClass(/mcp-active/)
  const outline = await tab.evaluate(element => {
    const style = getComputedStyle(element, '::before')
    return {
      inset: [style.top, style.right, style.bottom, style.left],
      followsCorners: style.borderRadius === getComputedStyle(element).borderRadius,
      interceptsInput: style.pointerEvents !== 'none',
      fits: parseFloat(style.width) <= element.clientWidth + 1 && parseFloat(style.height) <= element.clientHeight + 1
    }
  })
  expect(outline).toEqual({ inset: ['0px', '0px', '0px', '0px'], followsCorners: true, interceptsInput: false, fits: true })
}

async function expectOutlinePulses(tab: Locator): Promise<void> {
  const opacity = await tab.evaluate(element => {
    const animation = element.getAnimations({ subtree: true }).find(candidate => (candidate as CSSAnimation).animationName === 'tab-agent-pulse')
    if (!animation) throw new Error(`Missing outline pulse: ${getComputedStyle(element, '::before').animation}`)
    animation.pause()
    const duration = Number(animation.effect!.getTiming().duration)
    animation.currentTime = 0
    const dim = Number(getComputedStyle(element, '::before').opacity)
    animation.currentTime = duration / 2
    const style = getComputedStyle(element, '::before')
    const bright = Number(style.opacity)
    return {
      dim,
      bright,
      duration,
      borderWidth: style.borderTopWidth,
      glow: style.boxShadow,
      tab: getComputedStyle(element).opacity
    }
  })
  expect(opacity.bright - opacity.dim).toBeGreaterThan(.5)
  expect(opacity.dim).toBeGreaterThan(.3)
  expect(opacity.duration).toBeLessThanOrEqual(800)
  expect(opacity.borderWidth).toBe('2px')
  expect(opacity.glow).not.toBe('none')
  expect(opacity.tab).toBe('1')
}

for (const position of ['top', 'left']) {
  test(`keeps agent activity distinct from tab selection with ${position} tabs`, async ({ appWindow, electronApp }, testInfo) => {
    await appWindow.emulateMedia({ reducedMotion: 'no-preference' })
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
    for (const theme of ['light', 'dark']) {
      await appWindow.evaluate(`window.hronautSettings.setTheme('${theme}')`)
      await expect(appWindow.locator('html')).toHaveAttribute('data-theme', theme)
      if (position === 'left') await workingTab.hover()
      await expect(workingTab.locator('.spinner')).toHaveCount(0)
      const titleWidth = await workingTab.locator('.tab-title').evaluate(element => element.getBoundingClientRect().width)
      await activity(electronApp, ids.first, 'started')
      await activity(electronApp, ids.pinned, 'started')
      await expect(workingTab).toHaveAttribute('aria-description', 'Agent active')
      await expect(workingTab).toHaveAttribute('aria-selected', 'false')
      await expect(selectedTab).toHaveAttribute('aria-selected', 'true')
      await expect(selectedTab).not.toHaveClass(/mcp-active/)
      await expectOutlineFits(workingTab)
      await expectOutlineFits(pinnedTab)
      await expectOutlinePulses(workingTab)
      await expectOutlinePulses(pinnedTab)
      expect(await workingTab.locator('.tab-title').evaluate(element => element.getBoundingClientRect().width)).toBeCloseTo(titleWidth, 0)
      await expect(workingTab.locator('.tab-close')).toBeVisible()
      await appWindow.locator(position === 'left' ? '.browser-tabs-bar' : '.topbar').screenshot({ path: testInfo.outputPath(`agent-activity-${position}-${theme}.png`) })
      await activity(electronApp, ids.first, 'finished')
      await activity(electronApp, ids.pinned, 'finished')
      await expect(workingTab).not.toHaveClass(/mcp-active/)
      await expect(pinnedTab).not.toHaveClass(/mcp-active/)
    }

    await appWindow.emulateMedia({ reducedMotion: 'reduce' })
    await activity(electronApp, ids.first, 'started')
    await activity(electronApp, ids.pinned, 'started')
    await expect.poll(() => workingTab.evaluate(element => getComputedStyle(element, '::before').animationName)).toBe('none')
    await expectOutlineFits(workingTab)
    if (position === 'left') {
      await appWindow.getByRole('button', { name: 'Collapse tab rail when not in use', exact: true }).click()
      await appWindow.locator('.address-form input').focus()
      await appWindow.mouse.move(800, 400)
      await expect(appWindow.locator('.browser-tabs-bar')).toHaveClass(/rail-collapsed/)
      await expectOutlineFits(workingTab)
      await expectOutlineFits(pinnedTab)
      await appWindow.locator('.browser-tabs-bar').screenshot({ path: testInfo.outputPath('agent-activity-collapsed.png') })
    }
    await activity(electronApp, ids.first, 'finished')
    await expect(workingTab).not.toHaveClass(/mcp-active/)
    await expect(workingTab).not.toHaveAttribute('aria-description')
    await expectOutlineFits(pinnedTab)
    await activity(electronApp, ids.pinned, 'finished')
    await expect(pinnedTab).not.toHaveClass(/mcp-active/)
  })
}
