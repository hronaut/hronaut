import { writeFile } from 'node:fs/promises'
import type { HronautApi, HronautSettingsApi } from '../../src/shared/types.js'
import { expect, test } from './fixtures.js'

for (const width of [760, 1200]) {
  test(`keeps split pages usable when opening a left dock after the Split view menu at ${width}px`, async ({ appWindow, electronApp }, testInfo) => {
    await electronApp.evaluate(({ BrowserWindow }, contentWidth) => {
      BrowserWindow.getAllWindows()[0]!.setContentSize(contentWidth, 520)
    }, width)
    await appWindow.evaluate(async () => {
      const { hronaut: browser, hronautSettings: settings } = window as unknown as {
        hronaut: HronautApi
        hronautSettings: HronautSettingsApi
      }
      await settings.setInterfaceScale(1.25)
      await settings.setTabPosition('left')
      const first = await browser.newTab({
        url: 'data:text/html,<title>Split fixture Alpha</title><h1>Alpha</h1>',
        active: true
      })
      const firstTabId = first.activeTabId!
      await browser.newTab({
        url: 'data:text/html,<title>Split fixture Beta</title><h1>Beta</h1>',
        active: true
      })
      await browser.openSplitView(firstTabId)
    })

    const nativePages = () => electronApp.evaluate(({ BrowserWindow, WebContentsView }) => (
      BrowserWindow.getAllWindows()[0]!.contentView.children
        .filter((view): view is InstanceType<typeof WebContentsView> => (
          view instanceof WebContentsView
          && view.getVisible()
          && view.webContents.getTitle().startsWith('Split fixture ')
        ))
        .map(view => ({ title: view.webContents.getTitle(), bounds: view.getBounds() }))
    ))
    const expectUsablePages = async () => {
      await expect.poll(async () => {
        const pages = await nativePages()
        return pages.length === 2 && pages.every(({ bounds }) => (
          bounds.width > 100
          && bounds.height > 0
          && bounds.x >= 0
          && bounds.x + bounds.width <= width
        ))
      }).toBe(true)
    }
    await expectUsablePages()

    const pageToolsButton = appWindow.getByRole('button', { name: 'Page tools', exact: true })
    const panel = appWindow.getByRole('dialog', { name: 'Page tools', exact: true })
    const splitButton = appWindow.getByRole('button', { name: 'Split view', exact: true })
    const menu = appWindow.getByRole('dialog', { name: 'Split view', exact: true })
    await pageToolsButton.click()
    await panel.getByRole('combobox', { name: 'Dock page tools' }).selectOption('left')
    await panel.getByRole('button', { name: 'Close page tools' }).click()
    await splitButton.click()
    await expect(menu).toBeVisible()
    await pageToolsButton.click()
    await expect(panel).toBeVisible()
    await expect(menu).toBeHidden()
    await expectUsablePages()

    const pages = await nativePages()
    const dockBounds = await panel.boundingBox()
    const capture = await electronApp.evaluate(async ({ desktopCapturer }) => {
      const [screen] = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 1920, height: 1080 }
      })
      return screen!.thumbnail.toPNG().toString('base64')
    })
    await writeFile(testInfo.outputPath('native-desktop.png'), Buffer.from(capture, 'base64'))
    await writeFile(testInfo.outputPath('bounds-evidence.json'), JSON.stringify({ width, dockBounds, pages }, null, 2))

    // Reverse opening order also keeps only the newly requested surface.
    await splitButton.click()
    await expect(menu).toBeVisible()
    await expect(panel).toBeHidden()
    await menu.getByRole('button', { name: 'Close split view menu', exact: true }).click()
    await expect(menu).toBeHidden()
    await expectUsablePages()
  })
}
