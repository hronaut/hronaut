import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { expect, test } from './fixtures.js'
import type { HronautApi } from '../../src/shared/types.js'

const exec = promisify(execFile)

test('retains the first physical drag when a second drag is canceled before its acknowledgement', async ({ appWindow, electronApp }) => {
  await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1200, 800))
  const state = await appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.newTab({ url: 'data:text/html,<title>Commit A</title>A', active: true }))
  await appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.newTab({ url: 'data:text/html,<title>Commit B</title>B', active: true }))
  await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.openSplitView(id), state.activeTabId!)
  await appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.setAllHumanInteractionLocked(false))
  const divider = appWindow.getByRole('separator', { name: 'Resize split view', exact: true })
  await expect(divider).toBeVisible()
  const cdp = await appWindow.context().newCDPSession(appWindow)
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: false })
  // Preserve the real privileged handler and its native preview; defer only
  // delivery of the first update reply to reproduce a slow IPC round trip.
  await electronApp.evaluate(({ ipcMain }) => {
    type Handler = (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown
    const handlers = (ipcMain as typeof ipcMain & { _invokeHandlers: Map<string, Handler> })._invokeHandlers
    const original = handlers.get('split-divider:update')!
    let release: (() => void) | undefined
    let delayed = false
    ipcMain.removeHandler('split-divider:update')
    ipcMain.handle('split-divider:update', async (event, ...args: unknown[]) => {
      const result = original(event, ...args)
      if (!delayed) {
        delayed = true
        await new Promise<void>(resolve => { release = resolve })
      }
      return result
    })
    ipcMain.once('qa:release-divider-reply', () => release?.())
    ipcMain.once('qa:restore-divider-handler', () => {
      release?.()
      ipcMain.removeAllListeners('qa:release-divider-reply')
      ipcMain.removeHandler('split-divider:update')
      ipcMain.handle('split-divider:update', original)
    })
  })
  const origin = await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getContentBounds())
  const point = async () => {
    const rect = (await divider.boundingBox())!
    return { x: origin.x + Math.round(rect.x + rect.width / 2), y: origin.y + Math.round(rect.y + rect.height / 2) }
  }
  const input = (action: string, p: { x: number; y: number }) => exec('python3', [join(process.cwd(), 'tests/integration/x11-input.py'), String(p.x), String(p.y), action])
  try {
    const start = await point()
    const moved = { x: start.x + 120, y: start.y }
    await input('--down', start)
    await input('--move', moved)
    await expect.poll(() => appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState().then(s => s.splitView!.ratio))).toBeGreaterThan(.59)
    const committed = await appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState().then(s => s.splitView!.ratio))
    await input('--up', moved)
    await input('--down', await point())
    await electronApp.evaluate(({ ipcMain }) => { ipcMain.emit('qa:release-divider-reply') })
    await input('--shortcut=Escape', moved)
    await input('--up', moved)
    await expect.poll(() => appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState().then(s => s.splitView!.ratio))).toBe(committed)
  } finally {
    await input('--up', origin)
    await electronApp.evaluate(({ ipcMain }) => { ipcMain.emit('qa:restore-divider-handler') })
    await cdp.detach()
  }
})
