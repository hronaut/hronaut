import type { Page } from '@playwright/test'
import { VERTICAL_TAB_RAIL_COLLAPSED_WIDTH } from '../../src/shared/tab-position.js'
import type { BrowserState, HronautApi } from '../../src/shared/types.js'
import { expect, test } from './fixtures.js'

async function state(page: Page): Promise<BrowserState> {
  return page.evaluate('window.hronaut.getState()')
}

async function captureChrome(page: Page, path: string): Promise<void> {
  // Theme transitions can briefly leave the address field in the previous theme.
  await page.locator('.address-form').evaluate(async element => {
    await Promise.all(element.getAnimations().map(animation => animation.finished))
  })
  await page.screenshot({ path })
  const vertical = await page.locator('.browser-tabs-bar.vertical').count() > 0
  await page.locator(vertical ? '.topbar' : '.shell').screenshot({ path: path.replace(/\.png$/u, '-chrome.png') })
}

async function createWorkspace(page: Page, name: string, color: string): Promise<string> {
  const next = await page.evaluate<BrowserState>(`window.hronaut.createWorkspace(${JSON.stringify({ name, color, storage: 'scratch' })})`)
  return next.mcpTabGroups.find(group => group.name === name)!.id
}

for (const orientation of ['horizontal', 'vertical'] as const) {
  test(`nests tabs and trailing creation inside each ${orientation} workspace`, async ({ appWindow, electronApp }, testInfo) => {
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1900, 1000))
    await appWindow.evaluate(`window.hronautSettings.setTheme('light')`)
    await appWindow.evaluate(`window.hronautSettings.setTabPosition('${orientation === 'vertical' ? 'left' : 'top'}')`)
    const research = await createWorkspace(appWindow, 'Research', 'purple')
    const first = (await state(appWindow)).activeTabId!
    await appWindow.evaluate(`window.hronaut.navigate(${JSON.stringify({ tabId: first, url: 'data:text/html,<title>Product research and comparison notes</title><h1>Research notes</h1>' })})`)
    await appWindow.evaluate(`window.hronaut.newTab(${JSON.stringify({ mcpGroupId: research, url: 'data:text/html,<title>Requirements and a deliberately long document title</title><h1>Requirements</h1>', active: true })})`)
    const empty = await createWorkspace(appWindow, 'Empty review', 'cyan')
    for (const theme of ['light', 'dark']) {
      await appWindow.evaluate(`window.hronautSettings.setTheme('${theme}')`)
      await expect(appWindow.locator('.tab-group-label', { hasText: 'Research' })).toBeInViewport()
      await expect(appWindow.locator('.tab-group-label', { hasText: 'Empty review' })).toBeInViewport()
      await captureChrome(appWindow, testInfo.outputPath(`${orientation}-${theme}-two-workspaces.png`))
    }
    await appWindow.evaluate("window.hronautSettings.setTheme('light')")
    await appWindow.evaluate(`window.hronaut.closeTab(${JSON.stringify((await state(appWindow)).activeTabId)})`)
    const workspace = appWindow.locator('.workspace-tab-section', { has: appWindow.locator('.tab-group-label', { hasText: 'Research' }) })
    const tabs = workspace.getByRole('tab')
    const add = workspace.getByRole('button', { name: 'New tab in Research workspace' })
    await expect(tabs).toHaveCount(2)
    await workspace.scrollIntoViewIfNeeded()
    await captureChrome(appWindow, testInfo.outputPath(`${orientation}-before-or-after.png`))
    const geometry = await workspace.evaluate(element => {
      const group = element.getBoundingClientRect()
      const tab = element.querySelector('[role="tab"]')!.getBoundingClientRect()
      const last = [...element.querySelectorAll('[role="tab"]')].at(-1)!.getBoundingClientRect()
      const plus = element.querySelector('.workspace-new-tab')!.getBoundingClientRect()
      return { display: getComputedStyle(element).display, group: { x: group.x, y: group.y, right: group.right, bottom: group.bottom }, tab: { x: tab.x, y: tab.y, right: tab.right, bottom: tab.bottom }, last: { right: last.right, bottom: last.bottom }, plus: { x: plus.x, y: plus.y, right: plus.right, bottom: plus.bottom } }
    })
    expect(geometry.display, 'Workspace must own a rendered container, not display:contents').not.toBe('contents')
    expect(geometry.tab.x).toBeGreaterThan(geometry.group.x)
    expect(geometry.tab.y).toBeGreaterThan(geometry.group.y)
    expect(geometry.tab.right).toBeLessThan(geometry.group.right)
    expect(geometry.tab.bottom).toBeLessThan(geometry.group.bottom)
    expect(orientation === 'horizontal' ? geometry.plus.x : geometry.plus.y).toBeGreaterThanOrEqual(orientation === 'horizontal' ? geometry.last.right : geometry.last.bottom)
    expect(geometry.plus.right).toBeLessThan(geometry.group.right)
    expect(geometry.plus.bottom).toBeLessThan(geometry.group.bottom)

    // Creating from an inactive workspace must target that workspace, not the active one.
    await appWindow.evaluate(`window.hronaut.openHome()`)
    await add.click()
    await expect.poll(async () => (await state(appWindow)).tabs.find(tab => tab.active)?.mcpGroupId).toBe(research)
    await expect(tabs).toHaveCount(3)
    await expect(tabs.last()).toHaveAttribute('aria-selected', 'true')
    const header = workspace.locator('.tab-group-label')
    await header.click()
    await expect(tabs).toHaveCount(0)
    await expect(add).toBeVisible()
    await add.click()
    await expect(tabs).toHaveCount(4)
    await expect(tabs.last()).toHaveAttribute('aria-selected', 'true')

    const emptyAdd = appWindow.getByRole('button', { name: 'New tab in Empty review workspace' })
    await emptyAdd.click()
    await expect.poll(async () => (await state(appWindow)).tabs.find(tab => tab.active)?.mcpGroupId).toBe(empty)
    await header.click()
    await expect(header).toHaveAttribute('aria-expanded', 'false')
    await captureChrome(appWindow, testInfo.outputPath(`${orientation}-collapsed.png`))
    await header.press('Enter')
    await expect(tabs).toHaveCount(4)
    await tabs.first().focus()
    await tabs.first().press(orientation === 'horizontal' ? 'ArrowRight' : 'ArrowDown')
    await expect(tabs.nth(1)).toBeFocused()

    for (const theme of ['light', 'dark']) {
      await appWindow.evaluate(`window.hronautSettings.setTheme('${theme}')`)
      await captureChrome(appWindow, testInfo.outputPath(`${orientation}-${theme}-wide.png`))
      await testInfo.attach(`${orientation}-${theme}-address-colors`, {
        contentType: 'application/json',
        body: JSON.stringify(await appWindow.locator('.address-form').evaluate(element => ({
          theme: document.documentElement.dataset.theme,
          background: getComputedStyle(element).backgroundColor,
          surfaceMuted: getComputedStyle(element).getPropertyValue('--surface-muted').trim(),
          focusWithin: element.matches(':focus-within')
        })))
      })
      await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(760, 620))
      if (orientation === 'vertical') await appWindow.locator('.browser-tabs-bar').hover()
      await tabs.last().click()
      await expect(tabs.last()).toBeInViewport()
      await captureChrome(appWindow, testInfo.outputPath(`${orientation}-${theme}-narrow.png`))
      if (orientation === 'horizontal') {
        await expect(header).toBeInViewport()
        await expect.poll(async () => {
          const labelBounds = await header.boundingBox()
          const selectedBounds = await tabs.last().boundingBox()
          return selectedBounds!.x - labelBounds!.x - labelBounds!.width
        }).toBeGreaterThanOrEqual(-1)
      }
      expect(await appWindow.evaluate('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true)
      await captureChrome(appWindow, testInfo.outputPath(`${orientation}-${theme}-narrow.png`))
      const toolbar = await appWindow.locator('.toolbar').boundingBox()
      await expect.poll(() => electronApp.evaluate(({ BrowserWindow }, expected) => {
        const window = BrowserWindow.getAllWindows()[0]!
        return window.contentView.children.some(view => {
          const bounds = view.getBounds()
          return bounds.width > 0 && bounds.height > 0 && bounds.x === expected.x && bounds.y >= expected.y && bounds.y <= expected.y + 1
        })
      }, { x: orientation === 'vertical' ? VERTICAL_TAB_RAIL_COLLAPSED_WIDTH : 0, y: Math.ceil(toolbar!.y + toolbar!.height) })).toBe(true)
      if (orientation === 'vertical') {
        await appWindow.locator('input.address').focus()
        await appWindow.mouse.move(600, 450)
        await expect(appWindow.locator('.browser-tabs-bar')).toHaveClass(/rail-collapsed/)
        await captureChrome(appWindow, testInfo.outputPath(`vertical-${theme}-compact.png`))
        const selected = appWindow.locator('.tab[aria-selected="true"]')
        await expect(selected).toBeInViewport()
        const compact = await selected.evaluate(element => {
          const tab = element.getBoundingClientRect()
          const group = element.closest('.workspace-tab-section')!.getBoundingClientRect()
          return { tabLeft: tab.left, tabRight: tab.right, groupLeft: group.left, groupRight: group.right }
        })
        expect(compact.tabLeft).toBeGreaterThan(compact.groupLeft)
        expect(compact.tabRight).toBeLessThan(compact.groupRight)
      }
      await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1900, 1000))
    }
  })
}

test('backward Tab reveals a previous workspace trailing creation button beyond its sticky name', async ({ appWindow, electronApp }) => {
  await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(760, 620))
  await appWindow.evaluate("window.hronautSettings.setTabPosition('top')")
  const previous = await appWindow.evaluate(async () => {
    const bridge = (window as unknown as { hronaut: HronautApi }).hronaut
    const created = await bridge.createWorkspace({ name: 'Previous workspace', color: 'purple', storage: 'scratch' })
    const id = created.mcpTabGroups.find(group => group.name === 'Previous workspace')!.id
    for (let index = 0; index < 7; index += 1) await bridge.newTab({ mcpGroupId: id, url: 'about:blank', active: true })
    await bridge.createWorkspace({ name: 'Next workspace', color: 'cyan', storage: 'scratch' })
    return id
  })
  const next = appWindow.locator('.tab-group-label', { hasText: 'Next workspace' })
  const plus = appWindow.getByRole('button', { name: 'New tab in Previous workspace workspace', exact: true })
  await next.focus()
  await next.press('Shift+Tab')
  await expect(plus).toBeFocused()
  await expect.poll(() => plus.evaluate(element => {
    const box = element.getBoundingClientRect()
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
    return Boolean(hit && element.contains(hit))
  })).toBe(true)
  await plus.press('Enter')
  await expect.poll(() => appWindow.evaluate(async () => {
    const state = await (window as unknown as { hronaut: HronautApi }).hronaut.getState()
    return state.tabs.find(tab => tab.active)?.mcpGroupId
  })).toBe(previous)
})
