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

function validateDesktopExecutablePath(value: string): void {
  const invalid = [...value].some((character) => {
    const codePoint = character.codePointAt(0)!
    return codePoint <= 0x1f || codePoint === 0x7f || character === '='
  })
  if (invalid) {
    throw new Error('The Hronaut executable path is not valid for desktop autostart')
  }
}

function desktopStringValue(value: string): string {
  validateDesktopExecutablePath(value)
  return [...value].map((character) => character === '\\' ? '\\\\' : character).join('')
}

function desktopExecArgument(value: string): string {
  validateDesktopExecutablePath(value)
  const encoded = [...value].map((character) => {
    if (character === '\\') return '\\\\\\\\'
    if (character === '%') return '%%'
    if (character === '`' || character === '$' || character === '"') return `\\\\${character}`
    return character
  }).join('')
  return `"${encoded}"`
}

function desktopEntryValues(entry: string): ReadonlyMap<string, string> | undefined {
  let inDesktopEntry = false
  let foundDesktopEntry = false
  const values = new Map<string, string>()
  for (const rawLine of entry.split(/\r?\n/u)) {
    const line = rawLine.trimStart()
    if (line.startsWith('#') || line.length === 0) continue
    if (line.startsWith('[')) {
      const isDesktopEntry = line.trim() === '[Desktop Entry]'
      if (isDesktopEntry && foundDesktopEntry) return undefined
      inDesktopEntry = isDesktopEntry
      foundDesktopEntry ||= isDesktopEntry
      continue
    }
    if (!inDesktopEntry) continue
    const separator = line.indexOf('=')
    if (separator < 1) continue
    const key = line.slice(0, separator).trimEnd()
    // Duplicate keys make a desktop entry invalid. Reject the whole group,
    // even when the duplicate is not one of the fields Hronaut reads.
    if (values.has(key)) return undefined
    values.set(key, line.slice(separator + 1).trimStart())
  }
  return values
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
        const values = desktopEntryValues(entry)
        if (!values) return false
        const hidden = values.get('Hidden')
        const command = values.get('Exec')
        return hidden?.trim().toLowerCase() !== 'true'
          && command === `${desktopExecArgument(this.options.executablePath)} ${STARTUP_LAUNCH_ARGUMENT}`
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
    validateDesktopExecutablePath(executable)
    return [
      '[Desktop Entry]',
      'Type=Application',
      'Version=1.0',
      'Name=Hronaut',
      'Comment=Visible local browser for coding agents',
      `TryExec=${desktopStringValue(executable)}`,
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
