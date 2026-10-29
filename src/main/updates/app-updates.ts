import { app, type BrowserWindow } from 'electron'
import type { AppUpdater } from 'electron-updater'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { updateErrorMessage, type UpdateOperation } from '../../shared/update-errors.js'
import { canStartUpdateOperation, replacedPackageVersion } from '../../shared/update-runtime.js'
import {
  linuxUpdateExecutable,
  scheduleLinuxUpdateRelaunch,
  updaterShouldAutoRunAfterInstall
} from './linux-update-relaunch.js'
import type { MessageKey, MessageParameters } from '../../shared/i18n.js'
import type { AppUpdateState } from '../../shared/types.js'

/**
 * The update state the shell shows, created once by index.ts and changed only by this module. Each change replaces the
 * object; the panel snapshot, the updates IPC and the main window's startup read the field when they run, so they
 * always see the latest state.
 */
export interface AppUpdatesState {
  /** The latest update state; idle when the app starts. */
  current: AppUpdateState
}

interface AppUpdatesHost {
  /** electron-updater's updater for this platform, created when the main entry loads. */
  autoUpdater: Pick<AppUpdater,
    | 'autoDownload' | 'autoRunAppAfterInstall' | 'autoInstallOnAppQuit' | 'on'
    | 'checkForUpdates' | 'downloadUpdate' | 'quitAndInstall'>
  /** Translates into the current interface language; read on every use because the language can change. */
  text(key: MessageKey, parameters?: MessageParameters): string
  /** The update state the shell shows; index.ts creates the record, and the shell's IPC and snapshots read it too. */
  state: AppUpdatesState
  sendToShellWindows(channel: string, ...args: unknown[]): void
  /** The main window, hidden while the app restarts into an update; read on every use because it can close. */
  mainWindow(): Pick<BrowserWindow, 'hide'> | null
  /** The detached panel window, if one is open; hidden with the main window. */
  panelWindow(): Pick<BrowserWindow, 'hide'> | null
  /**
   * Asks before a restart cancels downloads in progress, as Hronaut's own Quit does; resolves whether to restart, and
   * never rejects.
   */
  confirmQuit(): Promise<boolean>
}

function releaseNotesText(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return undefined
  const notes = value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return ''
      const version = 'version' in entry && typeof entry.version === 'string' ? entry.version : ''
      const note = 'note' in entry && typeof entry.note === 'string' ? entry.note : ''
      return [version && `Version ${version}`, note].filter(Boolean).join('\n')
    })
    .filter(Boolean)
  return notes.length ? notes.join('\n\n') : undefined
}

/**
 * Checking for, downloading and installing app updates, one operation at a time. Installation is always an
 * explicit action; on Linux the app restarts into a package that replaced it underneath.
 */
export function createAppUpdates(host: AppUpdatesHost): {
  configureAutoUpdater(): void
  checkForUpdates(): Promise<AppUpdateState>
  downloadUpdate(): Promise<AppUpdateState>
  installDownloadedUpdate(): Promise<boolean>
} {
  let updaterConfigured = false
  let updateInstallationInProgress = false
  let updateOperation: UpdateOperation | null = null

  function publishUpdateState(next: Partial<AppUpdateState>): AppUpdateState {
    host.state.current = { ...host.state.current, ...next, currentVersion: app.getVersion() }
    host.sendToShellWindows('updates:changed', host.state.current)
    return { ...host.state.current }
  }

  function configureAutoUpdater(): void {
    if (updaterConfigured) return
    updaterConfigured = true
    host.autoUpdater.autoDownload = false
    // BaseUpdater ignores quitAndInstall's force-run argument for an interactive
    // install and reads this property instead. A direct Linux relaunch races the
    // old single-instance owner and loses the graphical login-session context
    // needed by PolicyKit on the next .deb update. Our post-exit helper reopens
    // the installed desktop application after the lock is released.
    host.autoUpdater.autoRunAppAfterInstall = updaterShouldAutoRunAfterInstall(process.platform)
    // Installation is always an explicit user action. In particular, a failed
    // privilege prompt must not be retried unexpectedly on the next normal quit.
    host.autoUpdater.autoInstallOnAppQuit = false

    host.autoUpdater.on('checking-for-update', () => {
      publishUpdateState({ status: 'checking', percent: undefined, message: undefined })
    })
    host.autoUpdater.on('update-available', (info) => {
      publishUpdateState({
        status: 'available',
        availableVersion: info.version,
        releaseNotes: releaseNotesText(info.releaseNotes),
        percent: undefined,
        message: undefined
      })
    })
    host.autoUpdater.on('update-not-available', () => {
      publishUpdateState({
        status: 'up-to-date',
        availableVersion: undefined,
        releaseNotes: undefined,
        percent: undefined,
        message: undefined
      })
    })
    host.autoUpdater.on('download-progress', (progress) => {
      publishUpdateState({ status: 'downloading', percent: progress.percent, message: undefined })
    })
    host.autoUpdater.on('update-downloaded', (info) => {
      publishUpdateState({
        status: 'downloaded',
        availableVersion: info.version,
        releaseNotes: releaseNotesText(info.releaseNotes),
        percent: 100,
        message: undefined
      })
    })
    host.autoUpdater.on('error', (error) => {
      console.error('[updates] Auto-updater error:', error)
      publishUpdateState({
        status: updateOperation === 'install' ? 'install-error' : 'error',
        percent: undefined,
        message: updateErrorMessage(error, updateOperation, process.platform)
      })
    })
  }

  function updatesUnavailableInThisBuild(): AppUpdateState | null {
    if (app.isPackaged && process.env.HRONAUT_DISABLE_AUTO_UPDATE !== '1') return null
    return publishUpdateState({
      status: 'disabled',
      percent: undefined,
      message:
        process.env.HRONAUT_DISABLE_AUTO_UPDATE === '1'
          ? 'Update checks are disabled for this launch.'
          : 'Update checks are available in packaged builds.'
    })
  }

  async function checkForUpdates(): Promise<AppUpdateState> {
    const unavailable = updatesUnavailableInThisBuild()
    if (unavailable) return unavailable
    if (updateInstallationInProgress) return { ...host.state.current }
    if (!canStartUpdateOperation(host.state.current.status, updateOperation, 'check')) return { ...host.state.current }
    updateOperation = 'check'
    try {
      // Reserve ownership before the package read yields: concurrent checks must
      // not independently schedule a restart for the same replaced installation.
      if (await restartAfterPackageReplacement()) return { ...host.state.current }
      publishUpdateState({ status: 'checking', percent: undefined, message: undefined })
      await host.autoUpdater.checkForUpdates()
    } catch (error) {
      console.error('[updates] Check failed:', error)
      publishUpdateState({ status: 'error', percent: undefined, message: updateErrorMessage(error, updateOperation, process.platform) })
    } finally {
      updateOperation = null
    }
    return { ...host.state.current }
  }

  async function downloadUpdate(): Promise<AppUpdateState> {
    const unavailable = updatesUnavailableInThisBuild()
    if (unavailable) return unavailable
    if (updateInstallationInProgress) return { ...host.state.current }
    if (!canStartUpdateOperation(host.state.current.status, updateOperation, 'download')) return { ...host.state.current }
    updateOperation = 'download'
    publishUpdateState({ status: 'downloading', percent: 0, message: undefined })
    try {
      await host.autoUpdater.downloadUpdate()
    } catch (error) {
      console.error('[updates] Download failed:', error)
      publishUpdateState({ status: 'error', percent: undefined, message: updateErrorMessage(error, updateOperation, process.platform) })
    } finally {
      updateOperation = null
    }
    return { ...host.state.current }
  }

  async function restartAfterPackageReplacement(): Promise<boolean> {
    if (!app.isPackaged || process.platform !== 'linux' || updateInstallationInProgress) return false
    try {
      const manifest = await readFile(join(app.getAppPath(), 'package.json'), 'utf8')
      const replacementVersion = replacedPackageVersion(app.getVersion(), manifest)
      if (!replacementVersion) return false
      updateInstallationInProgress = true
      publishUpdateState({
        status: 'installing',
        availableVersion: replacementVersion,
        percent: undefined,
        message: host.text('native.dialog.restartingUpdate')
      })
      // Restarting cancels downloads in progress and deletes their files, as Quit does, so it asks first, with the update
      // card behind the question saying why. A person who keeps downloading restarts later by checking again.
      if (!(await host.confirmQuit().catch(() => true))) {
        updateInstallationInProgress = false
        publishUpdateState({
          status: 'error',
          availableVersion: replacementVersion,
          percent: undefined,
          message: host.text('native.dialog.restartAfterDownloads', { version: replacementVersion })
        })
        return true
      }
      console.warn(
        `[updates] Package ${replacementVersion} replaced the running ${app.getVersion()} process; restarting before another updater operation.`
      )
      scheduleLinuxUpdateRelaunch(process.pid, linuxUpdateExecutable(process.env, process.execPath))
      host.mainWindow()?.hide()
      host.panelWindow()?.hide()
      app.quit()
      return true
    } catch (error) {
      console.warn('[updates] Could not compare the running and installed package versions:', error)
      return false
    }
  }

  async function installDownloadedUpdate(): Promise<boolean> {
    if (updateInstallationInProgress) return false
    if (updatesUnavailableInThisBuild()) return false
    if (!canStartUpdateOperation(host.state.current.status, updateOperation, 'install')) return false
    updateInstallationInProgress = true
    updateOperation = 'install'
    publishUpdateState({
      status: 'installing',
      percent: undefined,
      message: host.text('native.dialog.installingUpdate')
    })
    try {
      // electron-updater only asks Electron to quit after the installer has
      // started successfully. Keep tabs and MCP alive when authorization fails;
      // the normal before-quit/will-quit handlers perform the eventual shutdown.
      // Linux package updaters call app.relaunch() before the current process has
      // released Hronaut's single-instance lock. Relaunch only after this PID has
      // exited so the newly installed binary becomes the lock owner.
      host.autoUpdater.quitAndInstall(false, false)
      const installed = host.state.current.status !== 'install-error'
      if (installed && process.platform === 'linux') {
        scheduleLinuxUpdateRelaunch(process.pid, linuxUpdateExecutable(process.env, process.execPath))
        host.mainWindow()?.hide()
        host.panelWindow()?.hide()
        // BaseUpdater defers this with setImmediate after the synchronous Linux
        // package installer returns. Quit now so no timer or human action can
        // ask the old process to load files from the newly replaced app.asar.
        app.quit()
      }
      if (!installed) updateInstallationInProgress = false
      return installed
    } catch (error) {
      updateInstallationInProgress = false
      console.error('[updates] Install failed:', error)
      publishUpdateState({
        status: 'install-error',
        percent: undefined,
        message: updateErrorMessage(error, updateOperation, process.platform)
      })
      return false
    } finally {
      updateOperation = null
    }
  }

  return { configureAutoUpdater, checkForUpdates, downloadUpdate, installDownloadedUpdate }
}
