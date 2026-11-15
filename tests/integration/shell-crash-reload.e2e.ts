import type { HronautApi } from '../../src/shared/types.js'
import { expect, test } from './fixtures.js'

// A crash of Hronaut's own window page left the window blank until the person quit.
test('the main window loads its page again after the page crashes, with the tabs it had', async ({ appWindow, electronApp }) => {
  await appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.newTab({ url: 'data:text/html,<title>Kept tab</title>', active: true }))
  await expect(appWindow.getByRole('tab', { name: /Kept tab/ }).first()).toBeVisible()
  const loads = await electronApp.evaluate(({ BrowserWindow }) => new Promise<number>((resolve) => {
    const contents = BrowserWindow.getAllWindows()[0]!.webContents
    contents.once('render-process-gone', () => {
      contents.once('did-finish-load', () => resolve(1))
    })
    contents.forcefullyCrashRenderer()
  }))
  expect(loads).toBe(1)
  // Playwright keeps its page crashed, so the shell is read from the main process.
  await expect.poll(() => electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.executeJavaScript(
    `[...document.querySelectorAll('[role="tab"]')].some(tab => tab.textContent.includes('Kept tab'))`
  ))).toBe(true)
})
