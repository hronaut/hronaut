import { readFileSync } from 'node:fs'
import type { App, IpcMain, IpcMainInvokeEvent } from 'electron'
import type { AppSettings } from '../shared/types.js'

/**
 * Whether the saved settings keep Use graphics acceleration when available on, read before Electron is ready, when
 * Chromium still takes the choice. A missing or unreadable settings file keeps it on, as a new profile has it.
 */
export function readSavedGraphicsAcceleration(settingsPath: string): boolean {
  try {
    const saved = JSON.parse(readFileSync(settingsPath, 'utf8')) as unknown
    return !(saved && typeof saved === 'object' && (saved as Partial<AppSettings>).graphicsAcceleration === false)
  } catch {
    return true
  }
}

/**
 * Turns graphics acceleration off for this run when the saved setting says so, as Chrome does at its start. Returns
 * whether this run uses it, which Chromium's own --disable-gpu, the way back for a window too black to reach Settings,
 * also turns off; a change made later applies at the next start.
 */
export function applySavedGraphicsAcceleration(
  app: Pick<App, 'disableHardwareAcceleration'> & { commandLine: Pick<App['commandLine'], 'hasSwitch'> },
  settingsPath: string
): boolean {
  const saved = readSavedGraphicsAcceleration(settingsPath)
  if (!saved) app.disableHardwareAcceleration()
  return saved && !app.commandLine.hasSwitch('disable-gpu')
}

interface GraphicsAccelerationIpcHost {
  assertTrustedSender(event: IpcMainInvokeEvent): void
  /** What this run applied at its start. */
  inUse: boolean
  /** The current settings; read on every use because each committed update replaces the object. */
  settings(): AppSettings
  updateSettings(updates: Partial<AppSettings>): Promise<AppSettings>
  publishSettings(): void
}

/** Settings' Use graphics acceleration when available: saved now, used from the next start. */
export function registerGraphicsAccelerationIpc(
  ipcMain: Pick<IpcMain, 'handle'>,
  host: GraphicsAccelerationIpcHost
): void {
  ipcMain.handle('settings:graphics-acceleration-in-use', (event) => {
    host.assertTrustedSender(event)
    return host.inUse
  })
  ipcMain.handle('settings:set-graphics-acceleration', async (event, enabled: unknown) => {
    host.assertTrustedSender(event)
    if (typeof enabled !== 'boolean') throw new TypeError('Graphics acceleration preference must be a boolean')
    await host.updateSettings({ graphicsAcceleration: enabled })
    host.publishSettings()
    return { ...host.settings() }
  })
}
