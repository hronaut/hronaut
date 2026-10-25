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
    restartContext: () => ({ ...packaged, ...context })
  }
  registerAppRestartIpc(ipcMain, host)
  const restart = () => Promise.resolve().then(() => handlers.get('app:restart')!({} as IpcMainInvokeEvent))
  return { restart, host, calls }
}

const nextTask = () => new Promise((resolve) => setImmediate(resolve))

const packaged: RestartContext = {
  argv: ['/opt/Hronaut/hronaut'],
  cwd: '/home/me',
  defaultApp: false,
  appPath: '/opt/Hronaut/resources/app.asar',
  appImage: undefined,
  portableExecutable: undefined
}
const development: RestartContext = { ...packaged, cwd: '/repo', defaultApp: true, appPath: '/repo' }

describe('how Hronaut starts again', () => {
  it('keeps the switches it started with, without the addresses it was opened with', () => {
    expect(restartOptions({
      ...packaged,
      argv: ['/opt/Hronaut/hronaut', '--ozone-platform=wayland', 'https://example.test/', '--no-sandbox', '/home/me/page.html']
    })).toEqual({ args: ['--ozone-platform=wayland', '--no-sandbox'] })
  })

  it('drops the switches about this run only', () => {
    expect(restartOptions({
      ...packaged,
      argv: ['/opt/Hronaut/hronaut', '--disable-gpu', '--launch-at-login', '--force-device-scale-factor=1']
    })).toEqual({ args: ['--force-device-scale-factor=1'] })
  })

  it('starts the AppImage again rather than its mounted copy', () => {
    expect(restartOptions({
      ...packaged,
      argv: ['/tmp/.mount_HronauXYZ/hronaut', 'https://example.test/'],
      appImage: '/home/me/Applications/Hronaut.AppImage'
    })).toEqual({ execPath: '/home/me/Applications/Hronaut.AppImage', args: [] })
    expect(restartOptions({ ...packaged, appImage: 'Hronaut.AppImage' })).toEqual({ args: [] })
  })

  // The portable build unpacks Hronaut to a temporary folder and deletes it once Hronaut exits, so a relaunch of the
  // unpacked copy would start from files being deleted.
  it('starts the portable Windows build again rather than its unpacked copy', () => {
    expect(restartOptions({
      ...packaged,
      argv: ['C:\\Users\\me\\AppData\\Local\\Temp\\ns1234.tmp\\app\\Hronaut.exe', '--lang=de'],
      portableExecutable: 'D:\\Tools\\hronaut-3.13.0-x64-windows-portable.exe'
    })).toEqual({ execPath: 'D:\\Tools\\hronaut-3.13.0-x64-windows-portable.exe', args: ['--lang=de'] })
    expect(restartOptions({ ...packaged, portableExecutable: 'hronaut-portable.exe' })).toEqual({ args: [] })
  })

  it('keeps the app folder Electron runs in development', () => {
    expect(restartOptions({
      ...development,
      argv: ['/repo/node_modules/electron/dist/electron', '--inspect=0', '.', 'https://example.test/', '--no-sandbox']
    })).toEqual({ args: ['--inspect=0', '.', '--no-sandbox'] })
  })

  // Restart opened Electron's own default app: the module after --require was taken for the app folder, and . dropped.
  it('keeps Electron\'s own options with their values before the app folder', () => {
    expect(restartOptions({
      ...development,
      argv: ['/repo/node_modules/electron/dist/electron', '--require', './hook.cjs', '.', 'https://example.test/']
    })).toEqual({ args: ['--require', './hook.cjs', '.'] })
  })

  it('keeps the main script Electron was given in development, whose folder is the app\'s', () => {
    expect(restartOptions({
      ...development,
      cwd: '/',
      argv: ['/repo/node_modules/electron/dist/electron', '-r', 'repo/hook.cjs', 'repo/main.js', '/home/me/page.html']
    })).toEqual({ args: ['-r', 'repo/hook.cjs', 'repo/main.js'] })
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
