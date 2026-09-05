import { execFile } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { expect, test } from './fixtures.js'

const execFileAsync = promisify(execFile)

for (const scale of [1, 1.25]) {
  test(`physical compact rail tab click reaches chrome at ${scale} scale`, async ({ appWindow, electronApp }, testInfo) => {
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(760, 520))
    await appWindow.evaluate(`window.hronautSettings.setInterfaceScale(${scale})`)
    await appWindow.evaluate("window.hronautSettings.setTabPosition('left')")
    await appWindow.evaluate("window.hronaut.newTab({ url: 'data:text/html,<title>Target Alpha</title><h1>Alpha</h1>', active: true })")
    await appWindow.evaluate("window.hronaut.newTab({ url: 'data:text/html,<title>Current Beta</title><body style=background:orange><h1>Beta receives page clicks</h1></body>', active: true })")
    await appWindow.evaluate(`(async () => {
      const state = await window.hronaut.getState()
      await window.hronaut.setAllHumanInteractionLocked(false)
      await window.hronaut.setTabHumanInteractionLocked(state.activeTabId, false)
    })()`)
    const session = await appWindow.context().newCDPSession(appWindow)
    await session.send('Emulation.setFocusEmulationEnabled', { enabled: false })
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.focus())
    await appWindow.locator('.app-home-button').focus()
    await expect(appWindow.locator('.topbar')).toHaveCSS('width', '280px')
    const target = appWindow.getByRole('tab', { name: /^Target Alpha/ })
    const rect = (await target.boundingBox())!
    const point = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
    const before = await electronApp.evaluate(async ({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]!
      const view = window.contentView.children.find(view => 'webContents' in view && (view as Electron.WebContentsView).webContents.getTitle() === 'Current Beta') as Electron.WebContentsView
      await view.webContents.executeJavaScript('document.addEventListener("click", () => document.body.dataset.clicked = "yes")')
      return { origin: window.getContentBounds(), page: view.getBounds(), visible: view.getVisible() }
    })
    await execFileAsync('python3', [join(process.cwd(), 'tests/integration/x11-input.py'), String(before.origin.x + Math.round(point.x * scale)), String(before.origin.y + Math.round(point.y * scale)), '--click'])
    const after = await electronApp.evaluate(async ({ webContents }) => {
      const page = webContents.getAllWebContents().find(page => page.getTitle() === 'Current Beta')!
      return { pageClicked: await page.executeJavaScript('document.body.dataset.clicked'), pageFocused: webContents.getFocusedWebContents()?.id === page.id }
    })
    await writeFile(testInfo.outputPath('native-hit-evidence.json'), JSON.stringify({ scale, targetRect: rect, point, before, after }, null, 2))
    await expect(target).toHaveAttribute('aria-selected', 'true', { timeout: 2000 })
    expect(after.pageClicked).not.toBe('yes')

    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.focus())
    await appWindow.locator('.app-home-button').focus()
    const count = () => appWindow.evaluate('window.hronaut.getState().then(state => state.tabs.length)')
    const initialCount = await count()
    const addControl = appWindow.locator('.workspace-new-tab').first()
    await addControl.scrollIntoViewIfNeeded()
    await expect(appWindow.locator('.topbar')).toHaveCSS('width', '280px')
    const add = (await addControl.boundingBox())!
    await execFileAsync('python3', [join(process.cwd(), 'tests/integration/x11-input.py'), String(before.origin.x + Math.round((add.x + add.width / 2) * scale)), String(before.origin.y + Math.round((add.y + add.height / 2) * scale)), '--click'])
    await expect.poll(count).toBe(Number(initialCount) + 1)
    await target.click()
    await expect(target).toHaveAttribute('aria-selected', 'true')
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.focus())
    await appWindow.locator('.app-home-button').focus()
    const handle = appWindow.getByRole('separator', { name: 'Resize workspace panel', exact: true })
    const resize = (await handle.boundingBox())!
    const resizeX = before.origin.x + Math.round((resize.x + resize.width / 2) * scale)
    const resizeY = before.origin.y + Math.round((resize.y + 100) * scale)
    await execFileAsync('python3', [join(process.cwd(), 'tests/integration/x11-input.py'), String(resizeX), String(resizeY), `--drag-to=${resizeX - Math.round(40 * scale)},${resizeY}`])
    await expect(handle).toHaveAttribute('aria-valuenow', '240')
    await expect.poll(() => electronApp.evaluate(({ BrowserWindow }) => {
      const view = BrowserWindow.getAllWindows()[0]!.contentView.children.find(view => 'webContents' in view && (view as Electron.WebContentsView).webContents.getTitle() === 'Target Alpha')!
      return view.getBounds().x
    })).toBe(Math.round(240 * scale))
    await handle.dblclick()
    await expect(handle).toHaveAttribute('aria-valuenow', '280')
    const layout = await appWindow.locator('.toolbar').evaluate(toolbar => {
      const bounds = toolbar.getBoundingClientRect()
      const address = toolbar.querySelector<HTMLInputElement>('input.address')!.getBoundingClientRect()
      return { height: bounds.height, addressWidth: address.width, fits: [...toolbar.querySelectorAll('button')].filter(button => button.getBoundingClientRect().width > 0).every(button => {
        const rect = button.getBoundingClientRect()
        return rect.left >= bounds.left && rect.right <= bounds.right + 1 && rect.top >= bounds.top && rect.bottom <= bounds.bottom + 1
      }) }
    })
    expect(layout.fits).toBe(true)
    expect(layout.addressWidth).toBeGreaterThan(200)
    await appWindow.locator('.toolbar').screenshot({ path: testInfo.outputPath('expanded-toolbar.png') })
    const pagePoint = await electronApp.evaluate(async ({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]!
      const view = window.contentView.children.find(view => 'webContents' in view && (view as Electron.WebContentsView).webContents.getTitle() === 'Target Alpha') as Electron.WebContentsView
      await view.webContents.executeJavaScript('document.addEventListener("click", () => document.body.dataset.clicked = "yes")')
      const bounds = view.getBounds()
      return { x: bounds.x + bounds.width - 50, y: bounds.y + 80, width: bounds.width }
    })
    expect(pagePoint.width / scale).toBeGreaterThanOrEqual(320)
    await execFileAsync('python3', [join(process.cwd(), 'tests/integration/x11-input.py'), String(before.origin.x + pagePoint.x), String(before.origin.y + pagePoint.y), '--click'])
    await expect.poll(() => electronApp.evaluate(async ({ webContents }) => {
      const page = webContents.getAllWebContents().find(page => page.getTitle() === 'Target Alpha')!
      return page.executeJavaScript('document.body.dataset.clicked')
    })).toBe('yes')
    await expect(appWindow.locator('.topbar')).toHaveCSS('width', '56px')
    await expect(appWindow.locator('.toolbar')).toHaveCSS('height', '60px')
  })

  test(`keeps address suggestions anchored while the compact toolbar reflows at ${scale} scale`, async ({ appWindow, electronApp }) => {
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(760, 520))
    await appWindow.evaluate(`window.hronautSettings.setInterfaceScale(${scale})`)
    await appWindow.evaluate("window.hronautSettings.setTabPosition('left')")
    await appWindow.evaluate("window.hronaut.newTab({ url: 'data:text/html,<title>Anchor page</title>', active: true })")
    await appWindow.evaluate("window.hronautBookmarks.add('https://example.test/anchor', 'Anchor fixture')")
    const address = appWindow.getByRole('combobox', { name: 'Address', exact: true })
    await address.fill('Anchor')
    await expect(address).toHaveAttribute('aria-expanded', 'true')
    const offset = async () => {
      const expectedY = await appWindow.locator('.address-form').evaluate(form => Math.ceil(form.getBoundingClientRect().bottom + 7))
      const actualY = await electronApp.evaluate(({ BrowserWindow }) => {
        const view = BrowserWindow.getAllWindows()[0]!.contentView.children.find(view => 'webContents' in view && (view as Electron.WebContentsView).webContents.getURL().includes('address-overlay.html'))
        return view?.getBounds().y
      })
      return (actualY ?? -1000) - Math.round(expectedY * scale)
    }
    await expect.poll(offset).toBe(0)
    await appWindow.locator('.app-home-button').hover()
    await expect(appWindow.locator('.topbar')).toHaveCSS('width', '280px')
    await expect(address).toBeFocused()
    await expect.poll(offset).toBe(0)
    await appWindow.mouse.move(700 / scale, 400 / scale)
    await expect(appWindow.locator('.topbar')).toHaveCSS('width', '56px')
    await expect.poll(offset).toBe(0)
  })
}
