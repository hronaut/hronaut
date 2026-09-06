import { execFile } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { Locator } from '@playwright/test'
import { expect, test } from './fixtures.js'
import type { HronautApi } from '../../src/shared/types.js'

const execFileAsync = promisify(execFile)

for (const position of ['top', 'left']) {
  for (const scale of [1, 1.25]) {
    for (const width of [760, 1200]) {
      test(`routes physical Split view menu actions above native pages at ${width}px and ${scale} scale with ${position} tabs`, async ({ appWindow, electronApp }, testInfo) => {
        await electronApp.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0]!.setContentSize(width, 800), width)
        await appWindow.evaluate(`window.hronautSettings.setInterfaceScale(${scale})`)
        await appWindow.evaluate(`window.hronautSettings.setTabPosition(${JSON.stringify(position)})`)
        for (const title of ['Native Alpha', 'Native Beta']) {
          const url = `data:text/html,${encodeURIComponent(`<title>${title}</title><body style="background:orange;height:100vh;margin:0"><h1>${title}</h1><script>document.addEventListener('click', () => document.body.dataset.clicks = String(Number(document.body.dataset.clicks || 0) + 1))</script>`)}`
          await appWindow.evaluate(url => (window as unknown as { hronaut: HronautApi }).hronaut.newTab({ url, active: true }), url)
        }
        await appWindow.evaluate(async () => {
          const state = await (window as unknown as { hronaut: HronautApi }).hronaut.getState()
          await (window as unknown as { hronaut: HronautApi }).hronaut.setAllHumanInteractionLocked(false)
          for (const tab of state.tabs) await (window as unknown as { hronaut: HronautApi }).hronaut.setTabHumanInteractionLocked(tab.id, false)
        })
        const session = await appWindow.context().newCDPSession(appWindow)
        await session.send('Emulation.setFocusEmulationEnabled', { enabled: false })
        const nativePages = () => electronApp.evaluate(({ BrowserWindow, WebContentsView }) => BrowserWindow.getAllWindows()[0]!.contentView.children
          .filter((view): view is InstanceType<typeof WebContentsView> => view instanceof WebContentsView && /^Native /.test(view.webContents.getTitle()) && view.getVisible())
          .map(view => ({ title: view.webContents.getTitle(), bounds: view.getBounds() })))
        const clicks = () => electronApp.evaluate(async ({ webContents }) => Promise.all(webContents.getAllWebContents().filter(page => /^Native /.test(page.getTitle())).map(async page => ({ title: page.getTitle(), clicks: Number(await page.executeJavaScript('document.body.dataset.clicks || 0')) }))))
        const physicalClick = async (target: Locator) => {
          await expect(target).toBeVisible()
          const rect = (await target.boundingBox())!
          const origin = await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getContentBounds())
          await execFileAsync('python3', [join(process.cwd(), 'tests/integration/x11-input.py'), String(origin.x + Math.round((rect.x + rect.width / 2) * scale)), String(origin.y + Math.round((rect.y + rect.height / 2) * scale)), '--click'])
        }
        const menu = appWindow.getByRole('dialog', { name: 'Split view' })
        const toggle = appWindow.getByRole('button', { name: 'Split view', exact: true })
        const verifyReservedBounds = async (expectedPages: number) => {
          await expect(menu).toBeVisible()
          const rect = (await menu.boundingBox())!
          expect(rect.x).toBeGreaterThanOrEqual(0)
          expect(rect.y).toBeGreaterThanOrEqual(0)
          expect(rect.y + rect.height).toBeLessThanOrEqual(800 / scale + 1)
          expect(rect.x + rect.width).toBeLessThanOrEqual(width / scale + 1)
          await expect.poll(async () => {
            const pages = await nativePages()
            return pages.length === expectedPages && pages.every(page => page.bounds.width > 0 && page.bounds.height > 0 && page.bounds.x + page.bounds.width <= Math.ceil(rect.x * scale) + 1)
          }).toBe(true)
        }
        const initialPages = await nativePages()
        await physicalClick(toggle)
        await verifyReservedBounds(1)
        await physicalClick(menu.locator('.split-candidate-list').getByRole('button', { name: /Native Alpha/ }))
        await expect(menu).toBeHidden()
        await expect.poll(async () => (await nativePages()).length).toBe(2)
        await physicalClick(toggle)
        await verifyReservedBounds(2)
        await physicalClick(menu.getByRole('button', { name: 'Stacked', exact: true }))
        await expect.poll(() => appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState().then(state => state.splitView?.orientation))).toBe('horizontal')
        const stacked = await nativePages()
        expect(new Set(stacked.map(page => page.bounds.y)).size).toBe(2)
        const beforeSwap = await appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState().then(state => state.splitView!.firstTabId))
        await physicalClick(menu.getByRole('button', { name: 'Swap panes' }))
        await expect.poll(() => appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState().then(state => state.splitView!.firstTabId))).not.toBe(beforeSwap)
        await physicalClick(menu.getByRole('button', { name: 'Side by side', exact: true }))
        await expect.poll(() => appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState().then(state => state.splitView?.orientation))).toBe('vertical')
        const sideBySide = await nativePages()
        expect(new Set(sideBySide.map(page => page.bounds.x)).size).toBe(2)
        await verifyReservedBounds(2)
        await physicalClick(menu.getByRole('button', { name: 'Exit split view' }))
        await expect(menu).toBeHidden()
        await expect.poll(async () => (await nativePages()).length).toBe(1)
        await physicalClick(toggle)
        await physicalClick(menu.locator('.panel-close'))
        await expect(menu).toBeHidden()
        const pageClicks = await clicks()
        expect(pageClicks).toHaveLength(2)
        expect(pageClicks.every(page => page.clicks === 0)).toBe(true)
        const pages = await nativePages()
        expect(pages[0]!.bounds.width).toBe(initialPages[0]!.bounds.width)
        const origin = await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getContentBounds())
        const page = pages[0]!
        await execFileAsync('python3', [join(process.cwd(), 'tests/integration/x11-input.py'), String(origin.x + page.bounds.x + Math.floor(page.bounds.width / 2)), String(origin.y + page.bounds.y + Math.floor(page.bounds.height / 2)), '--click'])
        await expect.poll(async () => (await clicks()).find(candidate => candidate.title === page.title)?.clicks).toBe(1)
        await writeFile(testInfo.outputPath('native-input-evidence.json'), JSON.stringify({ position, scale, width, stacked, sideBySide, final: pages, pageClicks }, null, 2))
      })
    }
  }
}
