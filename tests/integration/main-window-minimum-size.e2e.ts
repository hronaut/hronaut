import type { HronautSettingsApi } from '../../src/shared/types.js'
import { expect, test } from './fixtures.js'

// The main window could not be narrower than 760 pixels, so it did not fit half of a 1280, 1366 or 1440-pixel screen
// beside another app, as Chrome's does. Its shell lays out from 600 CSS pixels at every interface size.

test('narrows to 600 CSS pixels of shell at each interface size, and grows when a larger one needs it', async ({ appWindow, electronApp }) => {
  const setScale = async (scale: 1 | 1.25) => await appWindow.evaluate(scale => (window as unknown as { hronautSettings: HronautSettingsApi })
    .hronautSettings.setInterfaceScale(scale), scale)
  const size = async () => await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getContentSize())
  try {
    await setScale(1)
    await electronApp.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]!.setSize(400, 400) })
    await expect.poll(size).toEqual([600, 520])
    await expect.poll(() => appWindow.evaluate(() => innerWidth)).toBe(600)

    // A larger size widens the window to its own minimum, the same 600 CSS pixels of shell.
    await setScale(1.25)
    await expect.poll(async () => (await size())[0]).toBe(750)
    await expect.poll(() => appWindow.evaluate(() => innerWidth)).toBe(600)

    // A larger size chosen while the window was maximized waits until it is restored, then grows it. The window is
    // only said to be maximized, as Xvfb has no window manager to maximize it.
    await setScale(1)
    await electronApp.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]!.setSize(620, 600) })
    await expect.poll(size).toEqual([620, 600])
    await electronApp.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]!.isMaximized = () => true })
    await setScale(1.25)
    await expect.poll(() => appWindow.evaluate(() => innerWidth)).toBe(496)
    expect(await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getMinimumSize())).toEqual([600, 520])
    expect(await size()).toEqual([620, 600])
    await electronApp.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]!
      Reflect.deleteProperty(window, 'isMaximized')
      window.emit('unmaximize')
    })
    await expect.poll(size).toEqual([750, 600])
  } finally {
    await setScale(1)
  }
})
