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

// The first CI run with the check above caught one: the toast view's last report arrived after the closing window
// closed the view, and the listener's sender check threw. Nothing waits for an answer to a report, so it is dropped.
test('an overlay view report from anything but the current view is dropped, not an uncaught exception', async ({ electronApp, appWindow }, testInfo) => {
  const reached = await electronApp.evaluate(({ ipcMain, BrowserWindow }) => new Promise<boolean>((resolve) => {
    setTimeout(() => {
      let listened = false
      try {
        // As if sent by the shell, which is not the toast view.
        listened = ipcMain.emit('toast-overlay-view:measured', { sender: BrowserWindow.getAllWindows()[0]!.webContents, senderFrame: null }, { height: 40 })
      } finally {
        resolve(listened)
      }
    }, 0)
  }))
  expect(reached).toBe(true)
  expect(await appWindow.evaluate('window.hronaut.getState().then((state) => typeof state.activeTabId)')).toBe('string')
  expect(mainUncaughtExceptions(testInfo)).toEqual([])
})
