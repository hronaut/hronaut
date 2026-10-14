import type { ElectronApplication, Page } from '@playwright/test'
import { expect } from './fixtures.js'

/** Await the initial full-page layout before recording, with page tools closed. */
export async function waitForInitialVideoLayout(appWindow: Page, electronApp: ElectronApplication, fixtureUrl: string, observeMatch?: (matches: boolean) => void): Promise<void> {
  await expect(appWindow.getByRole('combobox', { name: 'Address', exact: true })).toHaveValue(fixtureUrl)
  await expect.poll(async () => {
    const shellBottom = await appWindow.locator('.shell').evaluate(element => element.getBoundingClientRect().bottom)
    const matches = await electronApp.evaluate(({ BrowserWindow, webContents }, { url, shellBottom }) => {
      const window = BrowserWindow.getAllWindows()[0]!
      const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)
      const view = window.contentView.children.find(candidate => 'webContents' in candidate && candidate.webContents === page)
      const bounds = view?.getBounds()
      const content = window.getContentBounds()
      return bounds?.y === Math.ceil(Math.ceil(shellBottom) * window.webContents.getZoomFactor())
        && bounds.height === content.height - bounds.y && bounds.width === content.width
    }, { url: fixtureUrl, shellBottom })
    observeMatch?.(matches)
    return matches
  }, 'Native recording viewport matches the rendered fixture shell').toBe(true)
}
