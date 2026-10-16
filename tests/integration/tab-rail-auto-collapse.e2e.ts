import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { ElectronApplication, Page } from '@playwright/test'
import { expect, test } from './fixtures.js'

const execFileAsync = promisify(execFile)

async function prepareAutoRail(appWindow: Page, electronApp: ElectronApplication, width = 1200, scale = 1) {
  await electronApp.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0]!.setContentSize(width, 800), width)
  await appWindow.evaluate(`window.hronautSettings.setInterfaceScale(${scale})`)
  await appWindow.evaluate("window.hronautSettings.setTabPosition('left')")
  for (const title of ['Rail Alpha', 'Rail Beta', 'Rail Gamma']) {
    await appWindow.evaluate(title => (window as unknown as {
      hronaut: { newTab(options: { url: string; active: boolean }): Promise<unknown> }
    }).hronaut.newTab({ url: `data:text/html,<title>${title}</title><main>${title}</main>`, active: true }), title)
  }
  await appWindow.getByRole('button', { name: 'Collapse tab rail when not in use', exact: true }).click()
  const address = appWindow.getByRole('combobox', { name: 'Address', exact: true })
  await address.hover()
  await address.focus()
  await address.press('Escape')
  await expect(appWindow.locator('.topbar')).toHaveCSS('width', '56px')
}

test('a direct click on a collapsed tab activates the tab originally under the pointer', async ({ appWindow, electronApp }) => {
  await prepareAutoRail(appWindow, electronApp)
  const target = appWindow.getByRole('tab', { name: /^Rail Alpha/ })
  const bounds = await target.boundingBox()
  if (!bounds) throw new Error('Collapsed target tab is not visible')
  await appWindow.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await expect(target).toHaveAttribute('aria-selected', 'true')
})

for (const { width, scale } of [{ width: 1200, scale: 1 }, { width: 760, scale: 1.25 }]) {
  test(`physical collapsed tab click preserves its target at ${width}px and ${scale} scale`, async ({ appWindow, electronApp }) => {
    await prepareAutoRail(appWindow, electronApp, width, scale)
    const session = await appWindow.context().newCDPSession(appWindow)
    await session.send('Emulation.setFocusEmulationEnabled', { enabled: false })
    const target = appWindow.getByRole('tab', { name: /^Rail Alpha/ })
    const bounds = await target.boundingBox()
    if (!bounds) throw new Error('Collapsed target tab is not visible')
    const origin = await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getContentBounds())
    await execFileAsync('python3', [join(process.cwd(), 'tests/integration/x11-input.py'),
      String(origin.x + Math.round((bounds.x + bounds.width / 2) * scale)),
      String(origin.y + Math.round((bounds.y + bounds.height / 2) * scale)), '--click'])
    await expect(target).toHaveAttribute('aria-selected', 'true')
  })
}

test('preserves a deliberately scrolled tab list when the rail expands', async ({ appWindow, electronApp }) => {
  await prepareAutoRail(appWindow, electronApp)
  await appWindow.evaluate(async () => {
    const browser = (window as unknown as {
      hronaut: { newTab(options: { url: string; active: boolean }): Promise<unknown> }
    }).hronaut
    for (let index = 0; index < 20; index += 1) {
      await browser.newTab({ url: `data:text/html,<title>Later rail tab ${index}</title>`, active: false })
    }
  })
  await expect(appWindow.getByRole('tab', { name: /^Later rail tab 19/ })).toHaveCount(1)
  const strip = appWindow.locator('.tabs-strip')
  await strip.evaluate(element => { element.scrollTop = element.scrollHeight })
  const anchor = () => strip.evaluate(element => {
    const viewport = element.getBoundingClientRect()
    return [...element.querySelectorAll<HTMLElement>('[role=tab]')].find(tab => {
      const bounds = tab.getBoundingClientRect()
      return bounds.top >= viewport.top + 32 && bounds.bottom <= viewport.bottom
    })?.dataset.tabId
  })
  const before = await anchor()
  expect(before).toBeTruthy()
  await appWindow.locator('.app-home-button').hover()
  await expect(appWindow.locator('.topbar')).toHaveCSS('width', '280px')
  await expect.poll(anchor).toBe(before)
})

test('revealing the rail preserves the vertical position of its tab targets', async ({ appWindow, electronApp }, testInfo) => {
  await prepareAutoRail(appWindow, electronApp)
  // The pin and Create workspace move into the header rows once the rail opens; everything below keeps its row.
  const targets = appWindow.locator('.app-home-button, .tab-group-label, .tab, .workspace-new-tab')
  const positions = () => targets.evaluateAll(elements => elements.map(element => ({
    label: element.getAttribute('aria-label'),
    y: element.getBoundingClientRect().y,
    height: element.getBoundingClientRect().height
  })))
  const home = appWindow.locator('.app-home-button')
  const pin = appWindow.locator('.tab-rail-pin')
  const create = appWindow.getByRole('button', { name: 'Create workspace', exact: true })
  const collapsed = await positions()
  // Folded, the rail keeps every command it showed before: the pin under Home and Create workspace at the end.
  await expect(pin).toBeVisible()
  await expect(create).toBeVisible()
  await expect(appWindow.locator('.workspace-rail-header')).toBeHidden()
  const foldedHome = (await home.boundingBox())!
  expect((await pin.boundingBox())!.y).toBeGreaterThanOrEqual(foldedHome.y + foldedHome.height)
  expect(await appWindow.locator('.tabs-strip .new-workspace').count()).toBe(1)
  await appWindow.locator('.topbar').screenshot({ path: testInfo.outputPath('rail-collapsed.png') })
  await home.hover()
  await expect(appWindow.locator('.topbar')).toHaveCSS('width', '280px')
  const expanded = await positions()
  await appWindow.locator('.topbar').screenshot({ path: testInfo.outputPath('rail-expanded.png') })
  // Open, the pin sits on Home's row, and the Workspaces header holds the workspace switcher and Create workspace.
  const openHome = (await home.boundingBox())!
  const openPin = (await pin.boundingBox())!
  expect(Math.abs(openPin.y - openHome.y)).toBeLessThanOrEqual(1)
  expect(openPin.x).toBeGreaterThanOrEqual(openHome.x + openHome.width)
  const header = appWindow.locator('.workspace-rail-header')
  await expect(header.getByRole('button', { name: 'Switch workspace', exact: true })).toBeVisible()
  await expect(header.getByRole('button', { name: 'Create workspace', exact: true })).toBeVisible()
  expect(await appWindow.locator('.tabs-strip .new-workspace').count()).toBe(0)
  expect(expanded.map(({ label }) => label)).toEqual(collapsed.map(({ label }) => label))
  for (let index = 0; index < collapsed.length; index += 1) {
    expect(Math.abs(expanded[index]!.y - collapsed[index]!.y), collapsed[index]!.label ?? 'Rail control').toBeLessThanOrEqual(1)
    expect(expanded[index]!.height).toBe(collapsed[index]!.height)
  }
})

test('a dialog opened from the rail returns focus to Home after the rail folds behind it', async ({ appWindow, electronApp }) => {
  await prepareAutoRail(appWindow, electronApp)
  const topbar = appWindow.locator('.topbar')
  const home = appWindow.locator('.app-home-button')
  const search = appWindow.locator('.workspace-rail-header').getByRole('button', { name: 'Switch workspace', exact: true })
  // Keyboard focus opens the rail and the workspace switcher button in its header.
  await home.focus()
  await expect(topbar).toHaveCSS('width', '280px')
  await search.focus()
  await search.press('Enter')
  const dialog = appWindow.getByRole('dialog', { name: 'Switch workspace' })
  await expect(dialog).toBeVisible()
  // With focus in the dialog and no pointer over the rail, the unpinned rail folds and hides that button.
  await expect(topbar).toHaveClass(/rail-collapsed/)
  await expect(search).toBeHidden()
  await appWindow.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(home).toBeFocused()
  await expect(topbar).toHaveCSS('width', '280px')
})
