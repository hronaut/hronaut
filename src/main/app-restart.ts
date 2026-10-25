import { dirname, resolve, win32 } from 'node:path'
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
  /** The folder this run started in, which relative arguments are read from. */
  cwd: string
  /** Whether Electron runs Hronaut's folder as an app, as in development, where it is the first argument. */
  defaultApp: boolean
  /** Hronaut's app folder, as `app.getAppPath()`. */
  appPath: string
  /** The AppImage Hronaut runs from, whose mounted copy is gone once this run exits. */
  appImage: string | undefined
  /** The portable Windows build's own file, which unpacks Hronaut to a folder it deletes once this run exits. */
  portableExecutable: string | undefined
}

/**
 * How Hronaut starts again, as Chrome's Relaunch does: with the switches this run started with, but without the
 * addresses or files a launcher passed it, such as a desktop file's %U, and without the one-run switches above. In
 * development, Electron's own options before the app folder, or its main script, stay with it, values and all.
 */
export function restartOptions(context: RestartContext): RelaunchOptions {
  const rest = context.argv.slice(1)
  const appArgument = context.defaultApp ? appArgumentIndex(rest, context) : -1
  const args = rest.filter((argument, index) => !ONE_RUN_SWITCHES.has(argument)
    && (index <= appArgument || argument.startsWith('-')))
  if (context.appImage?.startsWith('/')) return { execPath: context.appImage, args }
  if (context.portableExecutable && win32.isAbsolute(context.portableExecutable)) {
    return { execPath: context.portableExecutable, args }
  }
  return { args }
}

/**
 * Where Electron was given Hronaut's folder, or else its main script, which Electron runs from that file's folder. The
 * script is the last such file, since a module for --require before it may sit in the same folder.
 */
function appArgumentIndex(args: readonly string[], { cwd, appPath }: RestartContext): number {
  const folder = args.findIndex((argument) => !argument.startsWith('-') && resolve(cwd, argument) === appPath)
  if (folder >= 0) return folder
  return args.findLastIndex((argument) => !argument.startsWith('-') && dirname(resolve(cwd, argument)) === appPath)
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

/**
 * Settings' Restart beside a change that applies at the next start, as Chrome's Relaunch. Electron's relaunch starts
 * the next run once this one has exited, so the next run takes the single-instance lock, and from this run's login
 * session and environment, so it opens the same profile.
 */
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
