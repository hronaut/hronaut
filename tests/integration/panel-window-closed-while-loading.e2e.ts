import { expect, test } from './fixtures.js'

test('closing a panel window while it loads shows no error', async ({ appWindow, electronApp }) => {
  const windowCount = () => electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)
  await appWindow.getByRole('button', { name: 'New tab' }).click()
  await appWindow.getByRole('button', { name: 'Page tools' }).click()
  // The panel's window closes right after Hronaut creates it, while its page is still loading.
  await electronApp.evaluate(({ app }) => {
    app.once('browser-window-created', (_event, window) => { setImmediate(() => window.close()) })
  })
  await appWindow.getByRole('dialog', { name: 'Page tools' }).getByRole('combobox', { name: 'Dock page tools' }).selectOption('window')

  await expect.poll(windowCount).toBe(1)
  await appWindow.evaluate('window.hronaut.getState()')
  // The failed load was reported as "Browser action failed" with the load error, naming where Hronaut is installed.
  await expect(appWindow.getByRole('alert').filter({ hasText: 'ERR_FAILED' })).toHaveCount(0)
  await expect(appWindow.getByRole('alert', { name: 'Browser action failed' })).toHaveCount(0)
})
