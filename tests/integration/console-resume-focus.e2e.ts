import { expect, test } from './capability-fixtures.js'

test('retains Console resume focus during a pending read without stealing later focus', async ({ capabilities, appWindow, electronApp }) => {
  await capabilities.openPageTool('Open Console')
  const panel = appWindow.getByRole('dialog', { name: 'Console' })
  await expect(panel).toHaveAttribute('aria-busy', 'false')
  await panel.getByRole('button', { name: 'Pause displayed updates', exact: true }).click()
  await electronApp.evaluate(({ ipcMain }) => {
    type Handler = (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown
    const original = (ipcMain as typeof ipcMain & { _invokeHandlers: Map<string, Handler> })._invokeHandlers.get('browser:console')!
    let armed = false
    let reads = 0
    let release: (() => void) | undefined
    Reflect.set(ipcMain, 'consoleFocusReads', () => reads)
    const arm = () => { armed = true }
    ipcMain.on('qa:arm-console-focus', arm)
    ipcMain.removeHandler('browser:console')
    ipcMain.handle('browser:console', async (event, ...args: unknown[]) => {
      reads += 1
      const hold = armed
      armed = false
      const result = await original(event, ...args)
      if (hold) await new Promise<void>(resolve => {
        release = resolve
        ipcMain.once('qa:release-console-focus', () => resolve())
      })
      return result
    })
    ipcMain.once('qa:restore-console-focus', () => {
      release?.()
      ipcMain.removeListener('qa:arm-console-focus', arm)
      ipcMain.removeAllListeners('qa:release-console-focus')
      ipcMain.removeHandler('browser:console')
      ipcMain.handle('browser:console', original)
      Reflect.deleteProperty(ipcMain, 'consoleFocusReads')
    })
  })
  try {
    for (const moveFocus of [false, true]) {
      const before = await electronApp.evaluate(({ ipcMain }) => Reflect.get(ipcMain, 'consoleFocusReads')())
      await electronApp.evaluate(({ ipcMain }) => ipcMain.emit('qa:arm-console-focus'))
      const resume = panel.getByRole('button', { name: 'Resume displayed updates', exact: true })
      await resume.focus()
      await appWindow.keyboard.press('Enter')
      await expect.poll(() => electronApp.evaluate(({ ipcMain }) => ipcMain.listenerCount('qa:release-console-focus'))).toBe(1)
      const pause = panel.getByRole('button', { name: 'Pause displayed updates', exact: true })
      await expect(panel).toHaveAttribute('aria-busy', 'true')
      await expect(pause).toBeFocused()
      await expect(pause).toHaveAttribute('aria-disabled', 'true')
      await appWindow.keyboard.press('Enter')
      await appWindow.keyboard.press('Space')
      await expect(pause).toHaveAttribute('aria-pressed', 'false')
      expect(await electronApp.evaluate(({ ipcMain }) => Reflect.get(ipcMain, 'consoleFocusReads')())).toBe(before + 1)
      const search = panel.getByRole('searchbox', { name: 'Filter Console messages', exact: true })
      if (moveFocus) await search.focus()
      await electronApp.evaluate(({ ipcMain }) => ipcMain.emit('qa:release-console-focus'))
      await expect(panel).toHaveAttribute('aria-busy', 'false')
      await expect(pause).toHaveAttribute('aria-disabled', 'false')
      await expect(moveFocus ? search : pause).toBeFocused()
      await pause.focus()
      await appWindow.keyboard.press('Space')
      await expect(panel.getByRole('button', { name: 'Resume displayed updates', exact: true })).toHaveAttribute('aria-pressed', 'true')
    }
  } finally {
    await electronApp.evaluate(({ ipcMain }) => ipcMain.emit('qa:restore-console-focus'))
  }
})
