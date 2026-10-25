import type { IpcMain, IpcMainInvokeEvent, OpenDialogReturnValue } from 'electron'
import { resolve } from 'node:path'
import type { BrowserTabsManager } from './browser/tabs-manager.js'
import type { McpCapabilityProfileStore } from './mcp/capability-profile-store.js'
import { mcpCapabilityProfileInputFromPreset, type McpHttpServer } from './mcp/server.js'
import { createDownloadFolder } from './download-folder.js'
import { LocalizedError } from './localized-error.js'
import type { McpTokenConfiguration } from './mcp-token-store.js'
import { DEFAULT_SETTINGS, isThemeName } from './settings-store.js'
import type { StartupLaunchManager } from './startup-launch.js'
import {
  DEFAULT_MEMORY_SAVER_TIMEOUT_MINUTES,
  isMemorySaverTimeoutMinutes
} from '../shared/memory-saver.js'
import { isInterfaceScale } from '../shared/interface-scale.js'
import { isTabPosition } from '../shared/tab-position.js'
import { isMcpToolSet } from '../shared/mcp-tool-sets.js'
import { isLanguagePreference } from '../shared/locale.js'
import { isSearchEngineName } from '../shared/search-engine.js'
import {
  isAttentionSoundCue,
  type AppSettings,
  type LanguagePreference,
  type McpCapabilityProfileCreateInput,
  type RendererSettingsState,
  type ThemeName
} from '../shared/types.js'

type SettingsIpcCapabilityProfiles = Pick<McpCapabilityProfileStore, 'list' | 'create' | 'derive' | 'update' | 'rotate' | 'revoke'>

interface SettingsIpcHost {
  assertTrustedSender(event: IpcMainInvokeEvent): void
  /** Registers a handler that is refused while saved workspaces are still initializing or failed to start. */
  handleBrowserIpc(channel: string, listener: Parameters<IpcMain['handle']>[1]): void
  /** The current settings; read on every use because each committed update replaces the object. */
  settings(): AppSettings
  currentRendererSettingsState(): RendererSettingsState
  updateSettings(
    updates: Partial<AppSettings>,
    applyRuntime?: (value: AppSettings) => void | Promise<void>
  ): Promise<AppSettings>
  publishSettings(): void
  isPackaged(): boolean
  shouldUseDarkColors(): boolean
  applyTheme(theme: ThemeName): void
  applyInterfaceScale(scale: AppSettings['interfaceScale']): void
  applyLanguagePreferenceRuntime(preference: LanguagePreference): void
  applyMainWindowTitleBarOverlay(): void
  applyMainWindowBackground(): void
  startupLaunchManager(): Pick<StartupLaunchManager, 'setEnabled'> | null
  defaultDownloadDirectory(): string
  effectiveDownloadDirectory(): string
  /** Asks for a download folder in a native dialog on the main window; throws while that window is unavailable. */
  chooseDownloadDirectory(): Promise<Pick<OpenDialogReturnValue, 'canceled' | 'filePaths'>>
  applyDownloadSettings(updates: Partial<AppSettings>): Promise<AppSettings>
  /** Opens a folder in the system file manager; resolves to an error message, or an empty string on success. */
  openPath(path: string): Promise<string>
  tabs(): Pick<BrowserTabsManager, 'setMemorySaverSettings' | 'setFollowAgentActivity'> | null
  mcpServer(): Pick<McpHttpServer, 'setAuthenticationToken' | 'setToolSet'> | null
  mcpTokenConfiguration(): Pick<McpTokenConfiguration, 'token'> | null
  refreshHomeAfterCommittedChange(scope: 'mcp'): void
  setMcpPort(port: number): Promise<AppSettings>
  resetMcpSettings(): Promise<AppSettings>
  mcpCapabilityProfiles(): SettingsIpcCapabilityProfiles | null
}

function capabilityProfileInput(value: unknown): McpCapabilityProfileCreateInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('MCP capability profile input is required')
  }
  const input = value as Partial<McpCapabilityProfileCreateInput>
  const argumentConstraints = input.argumentConstraints
  const jsonSafe = (candidate: unknown, depth = 0): boolean => {
    if (candidate === null || typeof candidate === 'string' || typeof candidate === 'boolean') return true
    if (typeof candidate === 'number') return Number.isFinite(candidate)
    if (depth >= 12) return false
    if (Array.isArray(candidate)) return candidate.length <= 256
      && candidate.every(entry => jsonSafe(entry, depth + 1))
    return !!candidate && typeof candidate === 'object'
      && Object.keys(candidate).length <= 256
      && Object.values(candidate as Record<string, unknown>).every(entry => jsonSafe(entry, depth + 1))
  }
  const invalidArgumentConstraints = argumentConstraints !== undefined && (
    !argumentConstraints || typeof argumentConstraints !== 'object' || Array.isArray(argumentConstraints)
    || Object.keys(argumentConstraints).length > 256
    || Object.values(argumentConstraints).some(values => !Array.isArray(values) || !values.length
      || values.length > 256 || !values.every(entry => jsonSafe(entry)))
    || (() => {
      try { return JSON.stringify(argumentConstraints).length > 65_536 } catch { return true }
    })()
  )
  if (typeof input.name !== 'string'
    || typeof input.preset !== 'string'
    || (input.parentProfileId !== undefined && typeof input.parentProfileId !== 'string')
    || (input.workspaceIds !== undefined && (!Array.isArray(input.workspaceIds)
      || input.workspaceIds.some(id => typeof id !== 'string')))
    || (input.origins !== undefined && (!Array.isArray(input.origins)
      || input.origins.some(origin => typeof origin !== 'string')))
    || invalidArgumentConstraints
    || (input.expiresInMinutes !== undefined && typeof input.expiresInMinutes !== 'number')
    || (input.singleUse !== undefined && typeof input.singleUse !== 'boolean')) {
    throw new TypeError('MCP capability profile input is invalid')
  }
  return input as McpCapabilityProfileCreateInput
}

/** Dependencies stay lazy because handlers are registered before the window loads. */
export function registerSettingsIpc(ipcMain: Pick<IpcMain, 'handle'>, host: SettingsIpcHost): void {
  /** Counts Follow agent activity requests, so a failed save restores the setting only for the newest. */
  let followAgentActivityIntent = 0
  const requireCapabilityProfiles = (): SettingsIpcCapabilityProfiles => {
    const profiles = host.mcpCapabilityProfiles()
    if (!profiles) throw new LocalizedError('appErrors.settings.capabilityProfilesUnavailable')
    return profiles
  }
  ipcMain.handle('settings:get', (event) => { host.assertTrustedSender(event); return { ...host.settings() } })
  ipcMain.handle('settings:get-renderer-state', (event) => {
    host.assertTrustedSender(event)
    return host.currentRendererSettingsState()
  })
  ipcMain.handle('settings:get-system-theme', (event) => {
    host.assertTrustedSender(event)
    return host.shouldUseDarkColors() ? 'dark' : 'light'
  })
  // Reset to default in Settings → Appearance: how Hronaut looks.
  ipcMain.handle('settings:reset-appearance', async (event) => {
    host.assertTrustedSender(event)
    await host.updateSettings({
      theme: DEFAULT_SETTINGS.theme,
      interfaceScale: DEFAULT_SETTINGS.interfaceScale,
      tabPosition: DEFAULT_SETTINGS.tabPosition,
      useSystemTitleBar: DEFAULT_SETTINGS.useSystemTitleBar
    })
    host.applyTheme(host.settings().theme)
    host.applyInterfaceScale(host.settings().interfaceScale)
    host.publishSettings()
    return host.currentRendererSettingsState()
  })
  // Reset to default in Settings → General: language, startup and tray, and how agent activity shows.
  ipcMain.handle('settings:reset-general', async (event) => {
    host.assertTrustedSender(event)
    if (host.isPackaged() && !host.startupLaunchManager()) {
      throw new LocalizedError('appErrors.settings.startupIntegrationUnavailable')
    }
    await host.updateSettings({
      hideInTray: DEFAULT_SETTINGS.hideInTray,
      launchAtStartup: DEFAULT_SETTINGS.launchAtStartup,
      launchMinimized: DEFAULT_SETTINGS.launchMinimized,
      attentionSound: DEFAULT_SETTINGS.attentionSound,
      attentionSoundCue: DEFAULT_SETTINGS.attentionSoundCue,
      showAgentCursor: DEFAULT_SETTINGS.showAgentCursor,
      pinAgentLiveStatus: DEFAULT_SETTINGS.pinAgentLiveStatus,
      languagePreference: DEFAULT_SETTINGS.languagePreference
    }, host.isPackaged()
      ? (next) => host.startupLaunchManager()!.setEnabled(next.launchAtStartup)
      : undefined)
    // Publishes the reset settings too, also when the language stays the same.
    await host.applyLanguagePreferenceRuntime(host.settings().languagePreference)
    return host.currentRendererSettingsState()
  })
  ipcMain.handle('settings:set-theme', async (event, theme: unknown) => {
    host.assertTrustedSender(event)
    if (!isThemeName(theme)) throw new TypeError('Unsupported theme')
    await host.updateSettings({ theme })
    host.applyTheme(theme)
    host.publishSettings()
    return { ...host.settings() }
  })
  ipcMain.handle('settings:set-interface-scale', async (event, scale: unknown) => {
    host.assertTrustedSender(event)
    if (!isInterfaceScale(scale)) throw new TypeError('Unsupported interface size')
    await host.updateSettings({ interfaceScale: scale })
    host.applyInterfaceScale(scale)
    host.publishSettings()
    return { ...host.settings() }
  })
  ipcMain.handle('settings:set-tab-position', async (event, position: unknown) => {
    host.assertTrustedSender(event)
    if (!isTabPosition(position)) throw new TypeError('Invalid tab position')
    await host.updateSettings({ tabPosition: position })
    host.applyMainWindowTitleBarOverlay()
    host.applyMainWindowBackground()
    host.publishSettings()
    return { ...host.settings() }
  })
  ipcMain.handle('settings:set-use-system-title-bar', async (event, enabled: unknown) => {
    host.assertTrustedSender(event)
    if (typeof enabled !== 'boolean') throw new TypeError('System title bar preference must be a boolean')
    await host.updateSettings({ useSystemTitleBar: enabled })
    host.publishSettings()
    return { ...host.settings() }
  })
  ipcMain.handle('settings:set-search-engine', async (event, searchEngine: unknown) => {
    host.assertTrustedSender(event)
    if (!isSearchEngineName(searchEngine)) throw new TypeError('Unsupported search engine')
    await host.updateSettings({ searchEngine })
    host.publishSettings()
    return { ...host.settings() }
  })
  ipcMain.handle('settings:get-default-download-directory', (event) => {
    host.assertTrustedSender(event)
    return host.defaultDownloadDirectory()
  })
  ipcMain.handle('settings:choose-download-directory', async (event) => {
    host.assertTrustedSender(event)
    const result = await host.chooseDownloadDirectory()
    const directory = result.filePaths[0]
    if (result.canceled || !directory) return { settings: { ...host.settings() }, canceled: true }
    return {
      settings: await host.applyDownloadSettings({ downloadDirectory: resolve(directory) }),
      canceled: false
    }
  })
  ipcMain.handle('settings:set-ask-where-to-save-downloads', (event, enabled: unknown) => {
    host.assertTrustedSender(event)
    if (typeof enabled !== 'boolean') throw new TypeError('Ask-before-saving must be a boolean')
    return host.applyDownloadSettings({ askWhereToSaveDownloads: enabled })
  })
  ipcMain.handle('settings:reset-downloads', (event) => {
    host.assertTrustedSender(event)
    return host.applyDownloadSettings({ downloadDirectory: null, askWhereToSaveDownloads: false })
  })
  ipcMain.handle('settings:open-download-directory', async (event) => {
    host.assertTrustedSender(event)
    const directory = host.effectiveDownloadDirectory()
    await createDownloadFolder(directory)
    const error = await host.openPath(directory)
    if (error) throw new LocalizedError('appErrors.settings.downloadFolderOpenFailed', undefined, { message: error })
  })
  host.handleBrowserIpc('settings:set-memory-saver-enabled', async (event, enabled: unknown) => {
    host.assertTrustedSender(event)
    if (typeof enabled !== 'boolean') throw new TypeError('Memory Saver state must be a boolean')
    await host.updateSettings({ memorySaverEnabled: enabled })
    host.tabs()?.setMemorySaverSettings(host.settings().memorySaverEnabled, host.settings().memorySaverTimeoutMinutes)
    host.publishSettings()
    return { ...host.settings() }
  })
  host.handleBrowserIpc('settings:set-memory-saver-timeout', async (event, timeoutMinutes: unknown) => {
    host.assertTrustedSender(event)
    if (!isMemorySaverTimeoutMinutes(timeoutMinutes)) throw new TypeError('Unsupported Memory Saver timeout')
    await host.updateSettings({ memorySaverTimeoutMinutes: timeoutMinutes })
    host.tabs()?.setMemorySaverSettings(host.settings().memorySaverEnabled, host.settings().memorySaverTimeoutMinutes)
    host.publishSettings()
    return { ...host.settings() }
  })
  host.handleBrowserIpc('settings:reset-memory-saver', async (event) => {
    host.assertTrustedSender(event)
    // Reset to default in Settings → Performance: Memory Saver, and graphics acceleration from the next start.
    await host.updateSettings({
      memorySaverEnabled: true,
      memorySaverTimeoutMinutes: DEFAULT_MEMORY_SAVER_TIMEOUT_MINUTES,
      graphicsAcceleration: DEFAULT_SETTINGS.graphicsAcceleration
    })
    host.tabs()?.setMemorySaverSettings(host.settings().memorySaverEnabled, host.settings().memorySaverTimeoutMinutes)
    host.publishSettings()
    return { ...host.settings() }
  })
  ipcMain.handle('settings:set-hide-in-tray', async (event, enabled: unknown) => {
    host.assertTrustedSender(event)
    if (typeof enabled !== 'boolean') throw new TypeError('Hide in tray must be a boolean')
    await host.updateSettings({ hideInTray: enabled })
    host.publishSettings()
    return { ...host.settings() }
  })
  ipcMain.handle('settings:set-launch-at-startup', async (event, enabled: unknown) => {
    host.assertTrustedSender(event)
    if (typeof enabled !== 'boolean') throw new TypeError('Launch-at-startup preference must be a boolean')
    if (!host.startupLaunchManager()) throw new LocalizedError('appErrors.settings.startupIntegrationUnavailable')
    await host.updateSettings(
      { launchAtStartup: enabled },
      (next) => host.startupLaunchManager()!.setEnabled(next.launchAtStartup)
    )
    host.publishSettings()
    return { ...host.settings() }
  })
  ipcMain.handle('settings:set-launch-minimized', async (event, enabled: unknown) => {
    host.assertTrustedSender(event)
    if (typeof enabled !== 'boolean') throw new TypeError('Launch-minimized preference must be a boolean')
    await host.updateSettings({ launchMinimized: enabled })
    host.publishSettings()
    return { ...host.settings() }
  })
  ipcMain.handle('settings:set-attention-sound', async (event, enabled: unknown) => {
    host.assertTrustedSender(event)
    if (typeof enabled !== 'boolean') throw new TypeError('Attention sound must be a boolean')
    await host.updateSettings({ attentionSound: enabled })
    host.publishSettings()
    return { ...host.settings() }
  })
  ipcMain.handle('settings:set-attention-sound-cue', async (event, cue: unknown) => {
    host.assertTrustedSender(event)
    if (!isAttentionSoundCue(cue)) throw new TypeError('Unsupported attention sound')
    await host.updateSettings({ attentionSoundCue: cue })
    host.publishSettings()
    return { ...host.settings() }
  })
  ipcMain.handle('settings:set-show-agent-cursor', async (event, enabled: unknown) => {
    host.assertTrustedSender(event)
    if (typeof enabled !== 'boolean') throw new TypeError('Show agent cursor must be a boolean')
    await host.updateSettings({ showAgentCursor: enabled })
    host.publishSettings()
    return { ...host.settings() }
  })
  ipcMain.handle('settings:set-pin-agent-live-status', async (event, enabled: unknown) => {
    host.assertTrustedSender(event)
    if (typeof enabled !== 'boolean') throw new TypeError('Pin agent live status must be a boolean')
    await host.updateSettings({ pinAgentLiveStatus: enabled })
    host.publishSettings()
    return { ...host.settings() }
  })
  ipcMain.handle('settings:set-follow-agent-activity', async (event, enabled: unknown) => {
    host.assertTrustedSender(event)
    if (typeof enabled !== 'boolean') throw new TypeError('Follow agent activity must be a boolean')
    // Applied at once, in the order asked, so following cannot move the view after the person
    // turned it off, such as with Stay here, while the setting is still being saved.
    const intent = ++followAgentActivityIntent
    host.tabs()?.setFollowAgentActivity(enabled)
    try {
      await host.updateSettings({ followAgentActivity: enabled })
    } catch (error) {
      if (intent === followAgentActivityIntent) host.tabs()?.setFollowAgentActivity(host.settings().followAgentActivity)
      throw error
    }
    host.publishSettings()
    return { ...host.settings() }
  })
  ipcMain.handle('settings:set-challenge-detection', async (event, enabled: unknown) => {
    host.assertTrustedSender(event)
    if (typeof enabled !== 'boolean') throw new TypeError('Challenge detection must be a boolean')
    await host.updateSettings({ challengeDetectionEnabled: enabled })
    host.publishSettings()
    return { ...host.settings() }
  })
  ipcMain.handle('settings:set-omit-agent-url-detail', async (event, enabled: unknown) => {
    host.assertTrustedSender(event)
    if (typeof enabled !== 'boolean') throw new TypeError('Omitting URL detail must be a boolean')
    await host.updateSettings({ omitAgentUrlDetail: enabled })
    host.publishSettings()
    return { ...host.settings() }
  })
  ipcMain.handle('settings:set-allow-website-file-saving', async (event, enabled: unknown) => {
    host.assertTrustedSender(event)
    if (typeof enabled !== 'boolean') throw new TypeError('Website file saving must be a boolean')
    await host.updateSettings({ allowWebsiteFileSaving: enabled })
    host.publishSettings()
    return { ...host.settings() }
  })
  ipcMain.handle('settings:set-mcp-remote-access', async (event, enabled: unknown) => {
    host.assertTrustedSender(event)
    if (typeof enabled !== 'boolean') throw new TypeError('Remote MCP access must be a boolean')
    const next = await host.updateSettings({ mcpRemoteAccess: enabled })
    host.mcpServer()?.setAuthenticationToken(next.mcpAuthentication ? host.mcpTokenConfiguration()?.token : undefined)
    host.publishSettings()
    host.refreshHomeAfterCommittedChange('mcp')
    return next
  })
  ipcMain.handle('settings:set-mcp-authentication', async (event, enabled: unknown) => {
    host.assertTrustedSender(event)
    if (typeof enabled !== 'boolean') throw new TypeError('MCP authentication must be a boolean')
    const next = await host.updateSettings({ mcpAuthentication: enabled })
    host.mcpServer()?.setAuthenticationToken(next.mcpAuthentication ? host.mcpTokenConfiguration()?.token : undefined)
    host.publishSettings()
    host.refreshHomeAfterCommittedChange('mcp')
    console.warn(enabled
      ? '[mcp] Authentication enabled.'
      : '[mcp] Authentication disabled in Settings. Anyone who can reach the listener can control this profile.')
    return { ...host.settings() }
  })
  host.handleBrowserIpc('settings:set-mcp-port', async (event, port: unknown) => {
    host.assertTrustedSender(event)
    return host.setMcpPort(port as number)
  })
  ipcMain.handle('settings:set-mcp-tool-set', async (event, toolSet: unknown) => {
    host.assertTrustedSender(event)
    if (!isMcpToolSet(toolSet)) throw new TypeError('Unsupported MCP tool set')
    await host.updateSettings(
      { mcpToolSet: toolSet },
      (next) => host.mcpServer()?.setToolSet(next.mcpToolSet)
    )
    host.publishSettings()
    host.refreshHomeAfterCommittedChange('mcp')
    return { ...host.settings() }
  })
  host.handleBrowserIpc('settings:reset-mcp', async (event) => {
    host.assertTrustedSender(event)
    return host.resetMcpSettings()
  })
  ipcMain.handle('settings:list-mcp-capability-profiles', (event) => {
    host.assertTrustedSender(event)
    return requireCapabilityProfiles().list()
  })
  ipcMain.handle('settings:create-mcp-capability-profile', async (event, value: unknown) => {
    host.assertTrustedSender(event)
    const input = capabilityProfileInput(value)
    const profiles = requireCapabilityProfiles()
    const normalized = mcpCapabilityProfileInputFromPreset(input)
    if (!input.parentProfileId) return profiles.create(normalized)
    const parent = profiles.list().find(profile => profile.id === input.parentProfileId)
    if (!parent) throw new LocalizedError('appErrors.settings.parentProfileMissing')
    return profiles.derive({
      profileId: parent.id,
      revision: parent.revision,
      credentialId: parent.credentialId
    }, normalized)
  })
  ipcMain.handle('settings:update-mcp-capability-profile', async (event, id: unknown, value: unknown) => {
    host.assertTrustedSender(event)
    if (typeof id !== 'string') throw new TypeError('MCP capability profile ID is invalid')
    const input = capabilityProfileInput(value)
    if (input.parentProfileId !== undefined) throw new TypeError('An existing MCP capability profile cannot be reparented')
    const result = await requireCapabilityProfiles().update(id, mcpCapabilityProfileInputFromPreset(input))
    return result
  })
  ipcMain.handle('settings:rotate-mcp-capability-profile', async (event, id: unknown) => {
    host.assertTrustedSender(event)
    if (typeof id !== 'string') throw new TypeError('MCP capability profile ID is invalid')
    const result = await requireCapabilityProfiles().rotate(id)
    return result
  })
  ipcMain.handle('settings:revoke-mcp-capability-profile', async (event, id: unknown) => {
    host.assertTrustedSender(event)
    if (typeof id !== 'string') throw new TypeError('MCP capability profile ID is invalid')
    const profile = await requireCapabilityProfiles().revoke(id)
    return profile
  })
  ipcMain.handle('settings:set-check-on-startup', async (event, enabled: unknown) => {
    host.assertTrustedSender(event)
    if (typeof enabled !== 'boolean') throw new TypeError('Startup update check must be a boolean')
    await host.updateSettings({ checkForUpdatesOnStartup: enabled })
    host.publishSettings()
    return { ...host.settings() }
  })
  ipcMain.handle('settings:set-language-preference', async (event, preference: unknown) => {
    host.assertTrustedSender(event)
    if (!isLanguagePreference(preference)) throw new TypeError('Invalid language preference')
    await host.updateSettings({ languagePreference: preference })
    await host.applyLanguagePreferenceRuntime(preference)
    return host.currentRendererSettingsState()
  })
}
