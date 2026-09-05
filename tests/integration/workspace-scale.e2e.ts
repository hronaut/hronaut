import { writeFile } from 'node:fs/promises'
import type { ElectronApplication, Locator } from '@playwright/test'
import type { BrowserState, HronautApi } from '../../src/shared/types.js'
import { expect, test } from './fixtures.js'

async function captureChrome(app: ElectronApplication, path: string): Promise<void> {
  const image = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.capturePage()).toPNG().toString('base64'))
  await writeFile(path, Buffer.from(image, 'base64'))
}

async function expectControlUncovered(control: Locator): Promise<void> {
  await expect(control).toBeFocused()
  await expect.poll(() => control.evaluate(element => {
    const rect = element.getBoundingClientRect()
    const strip = element.closest('.tabs-strip')!.getBoundingClientRect()
    const inside = rect.left >= strip.left - 1 && rect.right <= strip.right + 1
      && rect.top >= strip.top - 1 && rect.bottom <= strip.bottom + 1
    const points = [0.15, 0.5, 0.85].map(fraction => document.elementFromPoint(rect.x + rect.width * fraction, rect.y + rect.height / 2))
    return inside && points.every(hit => hit !== null && element.contains(hit))
  }), 'Keyboard target must fit the visible strip and remain uncovered by sticky labels').toBe(true)
}

for (const orientation of ['horizontal', 'vertical'] as const) {
  test(`keeps crowded ${orientation} workspace controls usable at minimum size and 125 percent scale`, async ({ appWindow, electronApp }, testInfo) => {
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(760, 520))
    await appWindow.evaluate("window.hronautSettings.setInterfaceScale(1.25)")
    await appWindow.evaluate(`window.hronautSettings.setTabPosition('${orientation === 'horizontal' ? 'top' : 'left'}')`)
    await expect.poll(() => appWindow.evaluate('innerWidth')).toBe(608)
    const researchId = await appWindow.evaluate(async () => {
      const bridge = (window as unknown as { hronaut: HronautApi }).hronaut
      const created = await bridge.createWorkspace({ name: 'Research workspace', color: 'purple', storage: 'scratch' })
      const id = created.mcpTabGroups.find(group => group.name === 'Research workspace')!.id
      for (let index = 1; index <= 7; index += 1) {
        await bridge.newTab({ mcpGroupId: id, url: `data:text/html,<title>Research document ${index} with a long title</title><h1>Visible research document ${index}</h1>`, active: true })
      }
      await bridge.createWorkspace({ name: 'Next workspace', color: 'cyan', storage: 'scratch' })
      return id
    })
    const research = appWindow.locator('.workspace-tab-section', { has: appWindow.locator('.tab-group-label', { hasText: 'Research workspace' }) })
    const tabs = research.getByRole('tab')
    await tabs.first().focus()
    await tabs.first().press(orientation === 'horizontal' ? 'ArrowRight' : 'ArrowDown')
    // A resize delivered after keyboard navigation must preserve its target,
    // even while the selected page belongs to a different workspace.
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(780, 540))
    await expect.poll(() => appWindow.evaluate('innerWidth')).toBe(624)
    await expectControlUncovered(tabs.nth(1))
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(760, 520))
    await expect.poll(() => appWindow.evaluate('innerWidth')).toBe(608)
    await captureChrome(electronApp, testInfo.outputPath(`${orientation}-scaled-keyboard.png`))
    await expectControlUncovered(tabs.nth(1))
    await tabs.nth(1).press('Enter')
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true')
    await expect(appWindow.locator('.address-form')).toBeVisible()
    expect(await appWindow.evaluate('document.documentElement.scrollWidth <= innerWidth')).toBe(true)

    expect(await appWindow.locator('.topbar-actions button, .toolbar button').evaluateAll(elements => elements.filter(element => {
      const box = element.getBoundingClientRect()
      return box.width > 0 && box.height > 0
    }).every(element => {
      const box = element.getBoundingClientRect()
      return box.left >= 0 && box.right <= innerWidth + 1
    })), 'All visible chrome actions must fit the scaled viewport').toBe(true)

    // Native content starts after the whole shell, including its bottom border.
    // Wait for the renderer's resize report to reach the native view.
    await expect.poll(async () => {
      const shellBottom = await appWindow.locator('.shell').evaluate(element => element.getBoundingClientRect().bottom)
      const contentTop = await electronApp.evaluate(({ BrowserWindow, webContents }) => {
        const page = webContents.getAllWebContents().find(contents => contents.getTitle() === 'Research document 1 with a long title')!
        return BrowserWindow.getAllWindows()[0]!.contentView.children.find(view => 'webContents' in view && view.webContents === page)!.getBounds().y
      })
      return contentTop - Math.ceil(Math.ceil(shellBottom) * 1.25)
    }, 'Native page must begin immediately after the scaled shell').toBe(0)
    const content = await electronApp.evaluate(async ({ BrowserWindow, webContents }) => {
      const page = webContents.getAllWebContents().find(contents => contents.getTitle() === 'Research document 1 with a long title')!
      const view = BrowserWindow.getAllWindows()[0]!.contentView.children.find(view => 'webContents' in view && view.webContents === page)!
      const heading = await page.executeJavaScript(`(() => {
        const heading = document.querySelector('h1');
        const rect = heading.getBoundingClientRect();
        return { text: heading.textContent, visible: rect.top >= 0 && rect.bottom <= innerHeight };
      })()`)
      return { bounds: view.getBounds(), heading, image: (await page.capturePage()).toPNG().toString('base64') }
    })
    expect(content.bounds.width).toBeGreaterThan(0)
    expect(content.bounds.height).toBeGreaterThan(0)
    expect(content.heading).toEqual({ text: 'Visible research document 1', visible: true })
    await writeFile(testInfo.outputPath(`${orientation}-scaled-content.png`), Buffer.from(content.image, 'base64'))
    await captureChrome(electronApp, testInfo.outputPath(`${orientation}-scaled-page.png`))

    const nextHeader = appWindow.locator('.tab-group-label', { hasText: 'Next workspace' })
    await nextHeader.focus()
    await nextHeader.press('Shift+Tab')
    const add = research.locator('.workspace-new-tab')
    await expectControlUncovered(add)
    await add.press('Enter')
    await expect.poll(() => appWindow.evaluate<BrowserState>('window.hronaut.getState()').then(state => state.tabs.find(tab => tab.active)?.mcpGroupId)).toBe(researchId)
    await expect(tabs).toHaveCount(9)
    await captureChrome(electronApp, testInfo.outputPath(`${orientation}-scaled-created.png`))
  })
}
