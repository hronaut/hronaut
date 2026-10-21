import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { translate } from '../src/shared/i18n.js'
import type { AppUpdatesState } from '../src/main/app-updates.js'

const electron = vi.hoisted(() => ({
  app: { isPackaged: true, getVersion: () => '3.3.1', getAppPath: () => '/opt/Hronaut/resources/app.asar', quit: vi.fn() }
}))
const relaunch = vi.hoisted(() => ({ scheduleLinuxUpdateRelaunch: vi.fn() }))

vi.mock('electron', () => electron)
// The package manager replaced Hronaut 3.3.1 with 3.4.0 while it ran.
vi.mock('node:fs/promises', () => ({ readFile: vi.fn(async () => JSON.stringify({ version: '3.4.0' })) }))
vi.mock('../src/main/linux-update-relaunch.js', () => ({
  linuxUpdateExecutable: () => '/opt/Hronaut/hronaut',
  scheduleLinuxUpdateRelaunch: relaunch.scheduleLinuxUpdateRelaunch,
  updaterShouldAutoRunAfterInstall: () => false
}))

const { createAppUpdates } = await import('../src/main/app-updates.js')

// After the package manager updated Hronaut on Linux, checking for updates restarted it at once, which cancelled the
// downloads in progress and deleted their files without the question Hronaut's own Quit asks.

const platform = Object.getOwnPropertyDescriptor(process, 'platform')!

beforeAll(() => {
  Object.defineProperty(process, 'platform', { ...platform, value: 'linux' })
})

afterAll(() => {
  Object.defineProperty(process, 'platform', platform)
})

beforeEach(() => {
  electron.app.quit.mockClear()
  relaunch.scheduleLinuxUpdateRelaunch.mockClear()
})

function createHarness(answers: boolean[]) {
  const state: AppUpdatesState = { current: { status: 'idle', currentVersion: '3.3.1' } }
  const hidden: string[] = []
  const autoUpdater = { on: vi.fn(), checkForUpdates: vi.fn(async () => null), downloadUpdate: vi.fn(), quitAndInstall: vi.fn() }
  let release: ((restart: boolean) => void) | undefined
  const confirmQuit = vi.fn(() => answers.length > 0
    ? Promise.resolve(answers.shift()!)
    : new Promise<boolean>((resolve) => { release = resolve }))
  const updates = createAppUpdates({
    autoUpdater: autoUpdater as never,
    text: (key, parameters) => translate('en-US', key, parameters),
    state,
    sendToShellWindows: () => undefined,
    mainWindow: () => ({ hide: () => { hidden.push('main') } }),
    panelWindow: () => ({ hide: () => { hidden.push('panel') } }),
    confirmQuit
  })
  return { state, hidden, autoUpdater, confirmQuit, updates, release: (restart: boolean) => release!(restart) }
}

describe('restarting into a package that replaced Hronaut', () => {
  it('keeps the downloads in progress when the person keeps downloading, and restarts once they check again', async () => {
    const { state, hidden, autoUpdater, confirmQuit, updates } = createHarness([false, true])
    expect(await updates.checkForUpdates()).toMatchObject({
      status: 'error',
      availableVersion: '3.4.0',
      message: 'Hronaut 3.4.0 is installed. Once your downloads finish, choose Try again to restart Hronaut and use it.'
    })
    expect(confirmQuit).toHaveBeenCalledTimes(1)
    expect(electron.app.quit).not.toHaveBeenCalled()
    expect(relaunch.scheduleLinuxUpdateRelaunch).not.toHaveBeenCalled()
    expect(hidden).toEqual([])
    // The running process belongs to the old package, so it asks no update server about it.
    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled()

    expect(await updates.checkForUpdates()).toMatchObject({ status: 'installing', availableVersion: '3.4.0' })
    expect(confirmQuit).toHaveBeenCalledTimes(2)
    expect(relaunch.scheduleLinuxUpdateRelaunch).toHaveBeenCalledTimes(1)
    expect(electron.app.quit).toHaveBeenCalledTimes(1)
    expect(hidden).toEqual(['main', 'panel'])
    expect(state.current.message).toBe('The new package is installed. Restarting Hronaut to finish the update.')
    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled()
  })

  it('asks once and restarts once when the person checks again while the question is open', async () => {
    const { confirmQuit, updates, release } = createHarness([])
    const first = updates.checkForUpdates()
    await vi.waitFor(() => expect(confirmQuit).toHaveBeenCalledTimes(1))
    expect(await updates.checkForUpdates()).toMatchObject({ status: 'idle' })
    expect(await updates.downloadUpdate()).toMatchObject({ status: 'idle' })
    release(true)
    expect(await first).toMatchObject({ status: 'installing' })
    expect(confirmQuit).toHaveBeenCalledTimes(1)
    expect(relaunch.scheduleLinuxUpdateRelaunch).toHaveBeenCalledTimes(1)
    expect(electron.app.quit).toHaveBeenCalledTimes(1)
  })
})
