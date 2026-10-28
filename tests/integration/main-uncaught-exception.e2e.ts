import { expect, test } from './fixtures.js'
import { mainUncaughtExceptions } from './main-uncaught-exceptions.js'

// Electron's own handler showed an uncaught exception in the main process in a native error box, a modal that blocked
// the main process until dismissed: a CI run's csp-disposition case hung on it until teardown aborted the app.

test('an uncaught exception in the main process is logged and the app keeps answering, with no native error box', async ({ electronApp, appWindow }, testInfo) => {
  await electronApp.evaluate(() => {
    setTimeout(() => { throw new Error('Deliberate uncaught exception') }, 0)
  })
  await expect.poll(() => mainUncaughtExceptions(testInfo).map((exception) => exception.lines.join('\n'))).toEqual([
    expect.stringMatching(/^\[main\] Uncaught exception: Error: Deliberate uncaught exception\n\s+at /)
  ])
  // A main process held by the box answers nothing, neither Playwright nor the window's own calls.
  expect(await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((window) => window.isVisible()))).toBe(true)
  expect(await appWindow.evaluate('window.hronaut.getState().then((state) => typeof state.activeTabId)')).toBe('string')
  // Caused on purpose, so the fixture that fails a test over one leaves this one alone.
  mainUncaughtExceptions(testInfo).splice(0)
})

// The first CI run with the check above caught one: the toast view's last message arrived after the closing window
// closed the view, and the listener's sender check threw. A one-way message has no one to take the error back to.
test('a one-way message the main process refuses is dropped, not an uncaught exception', async ({ electronApp, appWindow }, testInfo) => {
  await electronApp.evaluate(({ ipcMain, BrowserWindow }) => new Promise<void>((resolve) => {
    setTimeout(() => {
      try {
        // As if sent by the shell, which is not the toast view.
        ipcMain.emit('toast-overlay-view:measured', { sender: BrowserWindow.getAllWindows()[0]!.webContents, senderFrame: null }, { height: 40 })
      } finally {
        resolve()
      }
    }, 0)
  }))
  expect(await appWindow.evaluate('window.hronaut.getState().then((state) => typeof state.activeTabId)')).toBe('string')
  expect(mainUncaughtExceptions(testInfo)).toEqual([])
})
