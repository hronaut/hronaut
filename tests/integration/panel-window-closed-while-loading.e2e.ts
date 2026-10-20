import { expect, test } from './fixtures.js'

test('closing a panel window while it loads shows no error', async ({ appWindow, electronApp }) => {
  const windowCount = () => electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)
  await appWindow.getByRole('button', { name: 'New tab' }).click()
  await appWindow.getByRole('button', { name: 'Page tools' }).click()
  // The panel's window closes right after Hronaut creates it, while its page is still loading.
  await electronApp.evaluate(({ app }) => {
    app.once('browser-window-created', (_event, window) => {
      window.once('closed', () => { (globalThis as { panelWindowClosed?: boolean }).panelWindowClosed = true })
      setImmediate(() => window.close())
    })
  })
  const panel = appWindow.getByRole('dialog', { name: 'Page tools' })
  await panel.getByRole('combobox', { name: 'Dock page tools' }).selectOption('window')

  // The window count is 1 before the panel window exists too, so wait for that window to have closed.
  await expect.poll(() => electronApp.evaluate(() => (globalThis as { panelWindowClosed?: boolean }).panelWindowClosed === true)).toBe(true)
  expect(await windowCount()).toBe(1)
  await appWindow.evaluate('window.hronaut.getState()')
  // The failed load was reported as "Browser action failed" with the load error, naming where Hronaut is installed.
  await expect(appWindow.getByRole('alert').filter({ hasText: 'ERR_FAILED' })).toHaveCount(0)
  await expect(appWindow.getByRole('alert', { name: 'Browser action failed' })).toHaveCount(0)
  // The panel closes, as when its loaded window is closed, instead of going back to its earlier dock.
  await expect(panel).toBeHidden()
})
