import type { IpcMain, IpcMainInvokeEvent, RelaunchOptions } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { registerAppRestartIpc, restartOptions, type RestartContext } from '../src/main/app-restart.js'

// A change that applies at the next start, such as graphics acceleration or the system title bar, only said to restart
// Hronaut, and closing its window may just hide it in the tray. As Chrome's Relaunch, Settings now restarts it.

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown

function restartIpc(confirmQuit: () => Promise<boolean> = async () => true, context: Partial<RestartContext> = {}) {
  const handlers = new Map<string, Handler>()
  const ipcMain = { handle: (channel: string, handler: Handler) => { handlers.set(channel, handler) } } as unknown as IpcMain
  const calls: string[] = []
  const host = {
    assertTrustedSender: vi.fn(),
    confirmQuit: vi.fn(confirmQuit),
    quitState: { quitting: false },
    relaunch: vi.fn((_options: RelaunchOptions) => { calls.push('relaunch') }),
    quit: vi.fn(() => { calls.push('quit') }),
    restartContext: () => ({ argv: ['/opt/Hronaut/hronaut'], defaultApp: false, appImage: undefined, ...context })
  }
  registerAppRestartIpc(ipcMain, host)
  const restart = () => Promise.resolve().then(() => handlers.get('app:restart')!({} as IpcMainInvokeEvent))
  return { restart, host, calls }
}

const nextTask = () => new Promise((resolve) => setImmediate(resolve))

describe('how Hronaut starts again', () => {
  it('keeps the switches it started with, without the addresses it was opened with', () => {
    expect(restartOptions({
      argv: ['/opt/Hronaut/hronaut', '--ozone-platform=wayland', 'https://example.test/', '--no-sandbox', '/home/me/page.html'],
      defaultApp: false,
      appImage: undefined
    })).toEqual({ args: ['--ozone-platform=wayland', '--no-sandbox'] })
  })

  it('drops the switches about this run only', () => {
    expect(restartOptions({
      argv: ['/opt/Hronaut/hronaut', '--disable-gpu', '--launch-at-login', '--force-device-scale-factor=1'],
      defaultApp: false,
      appImage: undefined
    })).toEqual({ args: ['--force-device-scale-factor=1'] })
  })

  it('starts the AppImage again rather than its mounted copy', () => {
    expect(restartOptions({
      argv: ['/tmp/.mount_HronauXYZ/hronaut', 'https://example.test/'],
      defaultApp: false,
      appImage: '/home/me/Applications/Hronaut.AppImage'
    })).toEqual({ execPath: '/home/me/Applications/Hronaut.AppImage', args: [] })
    expect(restartOptions({ argv: ['/opt/Hronaut/hronaut'], defaultApp: false, appImage: 'Hronaut.AppImage' })).toEqual({ args: [] })
  })

  it('keeps the app folder Electron runs in development', () => {
    expect(restartOptions({
      argv: ['/repo/node_modules/electron/dist/electron', '--inspect=0', '.', 'https://example.test/'],
      defaultApp: true,
      appImage: undefined
    })).toEqual({ args: ['--inspect=0', '.'] })
  })
})

describe('Restart in Settings', () => {
  it('asks about downloads first, then relaunches before it quits', async () => {
    const { restart, host, calls } = restartIpc(async () => true, { argv: ['/opt/Hronaut/hronaut', '--disable-gpu', '--no-sandbox'] })
    await expect(restart()).resolves.toBe(true)
    expect(host.assertTrustedSender).toHaveBeenCalledOnce()
    expect(host.confirmQuit).toHaveBeenCalledOnce()
    expect(host.quitState.quitting).toBe(true)
    expect(host.relaunch).toHaveBeenCalledWith({ args: ['--no-sandbox'] })
    await nextTask()
    expect(calls).toEqual(['relaunch', 'quit'])
  })

  it('stays open when downloads in progress are kept', async () => {
    const { restart, host } = restartIpc(async () => false)
    await expect(restart()).resolves.toBe(false)
    await nextTask()
    expect(host.quitState.quitting).toBe(false)
    expect(host.relaunch).not.toHaveBeenCalled()
    expect(host.quit).not.toHaveBeenCalled()
  })

  // Electron starts one more Hronaut for every relaunch it is asked for.
  it('restarts once however often Restart is pressed', async () => {
    let answer!: (confirmed: boolean) => void
    const question = new Promise<boolean>((resolve) => { answer = resolve })
    const { restart, host } = restartIpc(() => question)
    const first = restart()
    const second = restart()
    answer(true)
    await expect(Promise.all([first, second])).resolves.toEqual([true, true])
    await expect(restart()).resolves.toBe(true)
    await nextTask()
    expect(host.relaunch).toHaveBeenCalledOnce()
    expect(host.quit).toHaveBeenCalledOnce()
  })

  it('refuses windows other than Hronaut\'s own', async () => {
    const { restart, host } = restartIpc()
    host.assertTrustedSender.mockImplementation(() => { throw new Error('Untrusted sender') })
    await expect(restart()).rejects.toThrow('Untrusted sender')
    expect(host.confirmQuit).not.toHaveBeenCalled()
    expect(host.relaunch).not.toHaveBeenCalled()
  })
})
