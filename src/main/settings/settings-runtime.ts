import { app, nativeTheme, type Session } from 'electron'
import { join, resolve } from 'node:path'
import { createDownloadFolder } from '../download-folder.js'
import { commitRuntimeSetting } from './runtime-setting-commit.js'
import { SettingsStore } from './settings-store.js'
import type { BrowserTabsManager } from '../browser/tabs-manager.js'
import type { McpRuntimeState } from '../mcp-runtime/mcp-runtime.js'
import { StartupLaunchManager } from '../startup-launch.js'
import type { MainWindowRefs } from '../windows/main-window.js'
import { translate, type MessageKey, type MessageParameters } from '../../shared/i18n.js'
import { resolveLocalePreference, resolveSupportedLocale } from '../../shared/locale.js'
import { mcpLocalHost } from '../../shared/mcp-network.js'
import { isValidMcpPort } from '../../shared/mcp-port.js'
import type { AppSettings, RendererSettingsState, SupportedLocale } from '../../shared/types.js'

/**
 * The settings the app runs with, the interface language and the operating system's launch at login setting, created
 * once by index.ts. A committed update replaces the current and saved settings together; every reader reads the fields
 * when it runs, so it always sees the committed values.
 */
export interface SettingsState {
  /** The settings file, once startup loaded it. */
  store: SettingsStore | null
  /** The settings as saved, without the overrides from the environment; resetting the MCP settings starts from them. */
  persisted: AppSettings
  /** The settings the app runs with: the saved ones with the environment's MCP port and authentication overrides. */
  current: AppSettings
  /** The operating system's language, read when settings load and when the language preference returns to it. */
  systemLocale: SupportedLocale
  /** The interface language: the preferred one, or the system's while the preference follows the system. */
  resolvedLocale: SupportedLocale
  /** The settings updates still running, chained so each starts from the one before; shutdown waits for them. */
  mutationQueue: Promise<void>
  /** The operating system's launch at login setting, once startup created its manager; settings IPC changes it too. */
  startupLaunchManager: StartupLaunchManager | null
}

interface SettingsRuntimeHost {
  /** The settings and the interface language; index.ts creates the record, and most of the main process reads it. */
  state: SettingsState
  /** The material behind the main window's tab rail, which the renderer settings state reports. */
  mainWindowRefs: Pick<MainWindowRefs, 'material'>
  sendToShellWindows(channel: string, ...args: unknown[]): void
  /** The MCP listener's address, which loading settings sets from the port and remote access settings. */
  mcpRuntime: Pick<McpRuntimeState, 'host' | 'port' | 'url'>
  /** Whether HRONAUT_DISABLE_MCP_AUTH turned MCP authentication off for this run; index.ts reads it while loading. */
  mcpAuthDisabled: boolean
  /** The browser profile's session, whose download folder follows the setting; null until startup configures it. */
  persistentSession(): Pick<Session, 'setDownloadPath'> | null
  /** The tab runtime, whose downloads follow the settings; null until the window opens. */
  tabs(): Pick<BrowserTabsManager, 'setDownloadPreferences'> | null
}

/**
 * Settings at runtime: loading them at startup with the environment's overrides, translating into the interface
 * language, committing updates one after another so each is saved before it becomes current, telling both shell
 * windows, the download folder, and creating the manager of the operating system's launch at login setting and
 * matching the setting to it.
 */
export function createSettingsRuntime(host: SettingsRuntimeHost): {
  text(key: MessageKey, parameters?: MessageParameters): string
  defaultDownloadDirectory(): string
  effectiveDownloadDirectory(value?: AppSettings): string
  updateSettings(
    updates: Partial<AppSettings>,
    applyRuntime?: (value: AppSettings) => void | Promise<void>
  ): Promise<AppSettings>
  currentRendererSettingsState(): RendererSettingsState
  applyDownloadSettings(updates: Partial<AppSettings>): Promise<AppSettings>
  publishSettings(): void
  createStartupLaunchManager(): StartupLaunchManager
  loadAuthoritativeSettings(): Promise<void>
  reconcileStartupSetting(): Promise<void>
} {
  function text(key: MessageKey, parameters?: MessageParameters): string {
    return translate(host.state.resolvedLocale, key, parameters)
  }

  function defaultDownloadDirectory(): string {
    return resolve(process.env.HRONAUT_DOWNLOAD_DIR || app.getPath('downloads'))
  }

  function effectiveDownloadDirectory(value: AppSettings = host.state.current): string {
    return resolve(value.downloadDirectory || defaultDownloadDirectory())
  }

  function updateSettings(
    updates: Partial<AppSettings>,
    applyRuntime?: (value: AppSettings) => void | Promise<void>
  ): Promise<AppSettings> {
    let committed: AppSettings | undefined
    const operation = host.state.mutationQueue.then(async () => {
      const previous = host.state.current
      const next = { ...host.state.current, ...updates }
      const nextPersisted = { ...host.state.persisted, ...updates }
      if (applyRuntime) {
        await commitRuntimeSetting({
          previous,
          next,
          apply: applyRuntime,
          persist: () => host.state.store!.save(nextPersisted)
        })
      } else {
        await host.state.store!.save(nextPersisted)
      }
      host.state.persisted = nextPersisted
      host.state.current = next
      committed = { ...host.state.current }
    })
    host.state.mutationQueue = operation.catch(() => undefined)
    return operation.then(() => committed!)
  }

  function currentRendererSettingsState(): RendererSettingsState {
    return {
      settings: { ...host.state.current },
      systemTheme: nativeTheme.shouldUseDarkColors ? 'dark' : 'light',
      systemLocale: host.state.systemLocale,
      resolvedLocale: host.state.resolvedLocale,
      windowMaterial: host.mainWindowRefs.material
    }
  }

  async function applyDownloadSettings(updates: Partial<AppSettings>): Promise<AppSettings> {
    const directory = effectiveDownloadDirectory({ ...host.state.current, ...updates })
    await createDownloadFolder(directory)
    const next = await updateSettings(updates)
    const committedDirectory = effectiveDownloadDirectory(next)
    host.persistentSession()?.setDownloadPath(committedDirectory)
    host.tabs()?.setDownloadPreferences(committedDirectory, next.askWhereToSaveDownloads)
    publishSettings()
    return { ...host.state.current }
  }

  function publishSettings(): void {
    host.sendToShellWindows('settings:changed', host.state.current)
    host.sendToShellWindows('settings:renderer-state-changed', currentRendererSettingsState())
  }

  /** Creates the manager of the operating system's launch at login setting, keeps it in the state and returns it. */
  function createStartupLaunchManager(): StartupLaunchManager {
    host.state.startupLaunchManager = new StartupLaunchManager({
      platform: process.platform,
      isPackaged: app.isPackaged,
      executablePath: process.platform === 'linux' && process.env.APPIMAGE
        ? resolve(process.env.APPIMAGE)
        : process.execPath,
      autostartDirectory: join(app.getPath('appData'), 'autostart'),
      nativeLoginItems: app,
      warn: (message, error) => { console.warn(`[startup] ${message}:`, error) }
    })
    return host.state.startupLaunchManager
  }

  async function loadAuthoritativeSettings(): Promise<void> {
    host.state.store = new SettingsStore(join(app.getPath('userData'), 'settings.json'))
    host.state.persisted = await host.state.store.load()
    await host.state.store.save(host.state.persisted)
    host.state.current = { ...host.state.persisted }
    host.state.systemLocale = resolveSupportedLocale(app.getLocale())
    host.state.resolvedLocale = resolveLocalePreference(host.state.current.languagePreference, host.state.systemLocale)
    if (process.env.HRONAUT_MCP_PORT !== undefined) {
      const overriddenPort = Number(process.env.HRONAUT_MCP_PORT)
      if (!isValidMcpPort(overriddenPort)) throw new Error('HRONAUT_MCP_PORT must be an integer from 1024 through 65535')
      host.state.current = { ...host.state.current, mcpPort: overriddenPort }
    }
    if (host.mcpAuthDisabled) host.state.current = { ...host.state.current, mcpAuthentication: false }
    if (host.state.current.mcpRemoteAccess) host.mcpRuntime.host = '0.0.0.0'
    host.mcpRuntime.port = host.state.current.mcpPort
    host.mcpRuntime.url = `http://${mcpLocalHost(host.mcpRuntime.host)}:${host.mcpRuntime.port}/mcp`
  }

  async function reconcileStartupSetting(): Promise<void> {
    if (!host.state.startupLaunchManager) return
    try {
      const launchAtStartup = await host.state.startupLaunchManager!.isEnabled()
      if (launchAtStartup !== host.state.current.launchAtStartup) await updateSettings({ launchAtStartup })
    } catch (error) {
      console.warn('[startup] Could not read the operating-system startup setting:', error)
    }
  }

  return {
    text,
    defaultDownloadDirectory,
    effectiveDownloadDirectory,
    updateSettings,
    currentRendererSettingsState,
    applyDownloadSettings,
    publishSettings,
    createStartupLaunchManager,
    loadAuthoritativeSettings,
    reconcileStartupSetting
  }
}
