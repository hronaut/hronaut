import type { IpcMain, IpcMainInvokeEvent, RelaunchOptions } from 'electron'
import type { AppQuitState } from './app-lifecycle.js'
import { STARTUP_LAUNCH_ARGUMENT } from './startup-launch.js'

/**
 * Switches about the run they started rather than the next one: Chromium's --disable-gpu, the way back from a window
 * too black to reach Settings, would keep holding back the graphics acceleration a restart is often for, and a restart
 * from Settings is no start at login, which may open minimized.
 */
const ONE_RUN_SWITCHES = new Set(['--disable-gpu', STARTUP_LAUNCH_ARGUMENT])

export interface RestartContext {
  /** This run's command line, as `process.argv`. */
  argv: readonly string[]
  /** Whether Electron runs Hronaut's folder as an app, as in development, where it is the first argument. */
  defaultApp: boolean
  /** The AppImage Hronaut runs from, whose mounted copy is gone once this run exits. */
  appImage: string | undefined
}

/**
 * How Hronaut starts again, as Chrome's Relaunch does: with the switches this run started with, but without the
 * addresses or files it was opened with, whose tabs come back as restored tabs, and without the one-run switches above.
 */
export function restartOptions(context: RestartContext): RelaunchOptions {
  const args: string[] = []
  let keepAppFolder = context.defaultApp
  for (const argument of context.argv.slice(1)) {
    if (argument.startsWith('-')) {
      if (!ONE_RUN_SWITCHES.has(argument)) args.push(argument)
    } else if (keepAppFolder) {
      args.push(argument)
      keepAppFolder = false
    }
  }
  return context.appImage?.startsWith('/') ? { execPath: context.appImage, args } : { args }
}

interface AppRestartIpcHost {
  assertTrustedSender(event: IpcMainInvokeEvent): void
  /** Asks before cancelling downloads in progress, as Hronaut's own Quit does; resolves whether to go on. */
  confirmQuit(): Promise<boolean>
  quitState: AppQuitState
  relaunch(options: RelaunchOptions): void
  quit(): void
  restartContext(): RestartContext
}

/** Settings' Restart beside a change that applies at the next start, as Chrome's Relaunch. */
export function registerAppRestartIpc(ipcMain: Pick<IpcMain, 'handle'>, host: AppRestartIpcHost): void {
  // Electron starts one more Hronaut for every relaunch it is asked for, so a second click restarts only once.
  let restarting = false
  ipcMain.handle('app:restart', async (event) => {
    host.assertTrustedSender(event)
    if (restarting) return true
    if (!await host.confirmQuit()) return false
    if (restarting) return true
    restarting = true
    // Set first, so closing the window quits rather than hides it in the tray and nothing asks about downloads again.
    host.quitState.quitting = true
    host.relaunch(restartOptions(host.restartContext()))
    setImmediate(host.quit)
    return true
  })
}
