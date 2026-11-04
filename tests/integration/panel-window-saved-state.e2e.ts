import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from './fixtures.js'

// The panel's window saved whether it was maximized or in full screen, but always opened at its normal size.
test('opens the panel window maximized and in full screen as it was saved', async ({ appWindow, electronApp }) => {
  const userData = await electronApp.evaluate(({ app }) => app.getPath('userData'))
  await writeFile(join(userData, 'panel-window-state.json'), `${JSON.stringify({
    bounds: { x: 100, y: 100, width: 640, height: 720 }, displayId: 0, maximized: true, fullScreen: true
  })}\n`, 'utf8')
  // Xvfb runs no window manager, so a window never reports maximized there; the panel's window counts the maximize
  // asked of it.
  await electronApp.evaluate(({ app }) => {
    app.once('browser-window-created', (_event, window) => {
      const scope = globalThis as { __panelMaximizeCalls?: number }
      scope.__panelMaximizeCalls = 0
      const maximize = window.maximize.bind(window)
      window.maximize = () => {
        scope.__panelMaximizeCalls! += 1
        maximize()
      }
    })
  })
  await appWindow.getByRole('button', { name: 'New tab' }).click()
  await appWindow.getByRole('button', { name: 'Page tools' }).click()
  await appWindow.getByRole('dialog', { name: 'Page tools' }).getByRole('combobox', { name: 'Dock page tools' }).selectOption('window')

  await expect.poll(() => electronApp.evaluate(({ BrowserWindow }) => {
    const panel = BrowserWindow.getAllWindows().find((window) => window.getTitle().includes('Page tools'))
    return panel
      ? { visible: panel.isVisible(), fullScreen: panel.isFullScreen(), maximizeCalls: (globalThis as { __panelMaximizeCalls?: number }).__panelMaximizeCalls }
      : null
  })).toEqual({ visible: true, fullScreen: true, maximizeCalls: 1 })
})
