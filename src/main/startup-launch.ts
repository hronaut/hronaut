import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { writeTextFileAtomically } from './atomic-file.js'

export const STARTUP_LAUNCH_ARGUMENT = '--launch-at-login'
const AUTOSTART_FILE_NAME = 'hronaut.desktop'

interface LoginItemState {
  openAtLogin: boolean
  wasOpenedAtLogin?: boolean
}

interface NativeLoginItems {
  setLoginItemSettings(settings: {
    openAtLogin: boolean
    path?: string
    args?: string[]
  }): void
  getLoginItemSettings(options?: { path?: string; args?: string[] }): LoginItemState
}

interface StartupLaunchManagerOptions {
  platform: NodeJS.Platform
  isPackaged: boolean
  executablePath: string
  autostartDirectory: string
  nativeLoginItems?: NativeLoginItems
}

export interface StartupVisibilitySettings {
  launchAtStartup: boolean
  launchMinimized: boolean
}

export interface StartupLaunchContext {
  platform: NodeJS.Platform
  argv: string[]
  wasOpenedAtLogin?: boolean
}

function desktopExecArgument(value: string): string {
  if (/\r|\n/.test(value)) throw new Error('The Hronaut executable path is not valid for desktop autostart')
  return `"${value.replace(/%/g, '%%').replace(/[\\`$"]/g, '\\$&')}"`
}

export function shouldStartMinimized(
  settings: StartupVisibilitySettings,
  context: StartupLaunchContext
): boolean {
  if (!settings.launchAtStartup || !settings.launchMinimized) return false
  return context.platform === 'darwin'
    ? context.wasOpenedAtLogin === true
    : context.argv.includes(STARTUP_LAUNCH_ARGUMENT)
}

export class StartupLaunchManager {
  constructor(private readonly options: StartupLaunchManagerOptions) {}

  async isEnabled(): Promise<boolean> {
    if (this.options.platform === 'linux') {
      try {
        const entry = await readFile(this.autostartPath(), 'utf8')
        return !/^Hidden\s*=\s*true\s*$/imu.test(entry)
          && entry.includes(`Exec=${desktopExecArgument(this.options.executablePath)} ${STARTUP_LAUNCH_ARGUMENT}`)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
        throw error
      }
    }
    if (this.options.platform === 'darwin') {
      return this.requireNativeLoginItems().getLoginItemSettings().openAtLogin
    }
    if (this.options.platform === 'win32') {
      return this.requireNativeLoginItems().getLoginItemSettings(this.windowsOptions()).openAtLogin
    }
    return false
  }

  wasOpenedAtLogin(): boolean {
    if (this.options.platform !== 'darwin') return false
    return this.requireNativeLoginItems().getLoginItemSettings().wasOpenedAtLogin === true
  }

  async setEnabled(enabled: boolean): Promise<void> {
    if (!this.options.isPackaged) {
      throw new Error('Launch at sign-in is available in packaged Hronaut builds')
    }
    if (this.options.platform === 'linux') {
      if (enabled) await writeTextFileAtomically(this.autostartPath(), this.linuxDesktopEntry())
      else await rm(this.autostartPath(), { force: true })
    } else if (this.options.platform === 'darwin') {
      this.requireNativeLoginItems().setLoginItemSettings({ openAtLogin: enabled })
    } else if (this.options.platform === 'win32') {
      this.requireNativeLoginItems().setLoginItemSettings({ openAtLogin: enabled, ...this.windowsOptions() })
    } else {
      throw new Error('Launch at sign-in is not supported on this operating system')
    }
    if (await this.isEnabled() !== enabled) {
      if (enabled) await this.removeRegistration().catch(() => undefined)
      throw new Error(`Hronaut could not ${enabled ? 'enable' : 'disable'} launch at sign-in`)
    }
  }

  private autostartPath(): string {
    return join(this.options.autostartDirectory, AUTOSTART_FILE_NAME)
  }

  private linuxDesktopEntry(): string {
    const executable = this.options.executablePath
    if (/\r|\n/.test(executable)) throw new Error('The Hronaut executable path is not valid for desktop autostart')
    return [
      '[Desktop Entry]',
      'Type=Application',
      'Version=1.0',
      'Name=Hronaut',
      'Comment=Visible local browser for coding agents',
      `TryExec=${executable}`,
      `Exec=${desktopExecArgument(executable)} ${STARTUP_LAUNCH_ARGUMENT}`,
      'Terminal=false',
      'StartupNotify=false',
      ''
    ].join('\n')
  }

  private windowsOptions(): { path: string; args: string[] } {
    return { path: this.options.executablePath, args: [STARTUP_LAUNCH_ARGUMENT] }
  }

  private async removeRegistration(): Promise<void> {
    if (this.options.platform === 'linux') await rm(this.autostartPath(), { force: true })
    else if (this.options.platform === 'darwin') {
      this.requireNativeLoginItems().setLoginItemSettings({ openAtLogin: false })
    } else if (this.options.platform === 'win32') {
      this.requireNativeLoginItems().setLoginItemSettings({ openAtLogin: false, ...this.windowsOptions() })
    }
  }

  private requireNativeLoginItems(): NativeLoginItems {
    if (!this.options.nativeLoginItems) throw new Error('Native login-item integration is unavailable')
    return this.options.nativeLoginItems
  }
}
