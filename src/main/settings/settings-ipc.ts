import type { IpcMainInvokeEvent, OpenDialogReturnValue } from 'electron'
import type { TypedIpcMain } from '../typed-ipc.js'
import { resolve } from 'node:path'
import type { Browser } from '../browser/browser.js'
import type { McpCapabilityProfileStore } from '../mcp/capability-profile-store.js'
import { mcpCapabilityProfileInputFromPreset, type McpHttpServer } from '../mcp/server.js'
import { createDownloadFolder } from '../download-folder.js'
import { LocalizedError } from '../localized-error.js'
import type { McpTokenConfiguration } from '../mcp-runtime/mcp-token-store.js'
import { DEFAULT_SETTINGS, isThemeName } from './settings-store.js'
import type { StartupLaunchManager } from '../startup-launch.js'
import {
  DEFAULT_MEMORY_SAVER_TIMEOUT_MINUTES,
  isMemorySaverTimeoutMinutes
} from '../../shared/memory-saver.js'
import { isInterfaceScale } from '../../shared/interface-scale.js'
import { isTabPosition } from '../../shared/tab-position.js'
import { isMcpToolSet } from '../../shared/mcp-tool-sets.js'
import { isLanguagePreference } from '../../shared/locale.js'
import { isSearchEngineName } from '../../shared/search-engine.js'
import {
  isAttentionSoundCue,
  type AppSettings,
  type LanguagePreference,
  type McpCapabilityProfileCreateInput,
  type RendererSettingsState,
  type ThemeName
} from '../../shared/types.js'
import { setFollowAgentActivity } from '../browser/agent-follow/agent-follow.js'
import { setMemorySaverSettings } from '../browser/tab-sleep/memory-saver.js'
import { SETTINGS_IPC } from '../../shared/ipc/settings.js'

type SettingsIpcCapabilityProfiles = Pick<McpCapabilityProfileStore, 'list' | 'create' | 'derive' | 'update' | 'rotate' | 'revoke'>

interface SettingsIpcHost {
  assertTrustedSender(event: IpcMainInvokeEvent): void
  /** Registers a handler that is refused while saved workspaces are still initializing or failed to start. */
  handleBrowserIpc: TypedIpcMain['handle']
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
  /** Has every browser session check spelling, or stop, as the value says. */
  applySpellCheck(enabled: boolean): void
  /** Has every browser session check spelling in these languages, or the automatic one for none. */
  applySpellCheckLanguages(languages: readonly string[]): void
  startupLaunchManager(): Pick<StartupLaunchManager, 'setEnabled'> | null
  defaultDownloadDirectory(): string
  effectiveDownloadDirectory(): string
  /** Asks for a download folder in a native dialog on the main window; throws while that window is unavailable. */
  chooseDownloadDirectory(): Promise<Pick<OpenDialogReturnValue, 'canceled' | 'filePaths'>>
  applyDownloadSettings(updates: Partial<AppSettings>): Promise<AppSettings>
  /** Opens a folder in the system file manager; resolves to an error message, or an empty string on success. */
  openPath(path: string): Promise<string>
  tabs(): Browser | null
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
export function registerSettingsIpc(ipcMain: Pick<TypedIpcMain, 'handle'>, host: SettingsIpcHost): void {
  /** Counts Follow agent activity requests, so a failed save restores the setting only for the newest. */
  let followAgentActivityIntent = 0
  /** Turns Follow agent activity on or off in the browser, once it is up. */
  const followAgentActivity = (enabled: boolean): void => {
    const browser = host.tabs()
    if (browser) setFollowAgentActivity(browser, enabled)
  }
  const requireCapabilityProfiles = (): SettingsIpcCapabilityProfiles => {
    const profiles = host.mcpCapabilityProfiles()
    if (!profiles) throw new LocalizedError('appErrors.settings.capabilityProfilesUnavailable')
    return profiles
  }
  ipcMain.handle(SETTINGS_IPC.get, (event) => { host.assertTrustedSender(event); return { ...host.settings() } })
  ipcMain.handle(SETTINGS_IPC.getRendererState, (event) => {
    host.assertTrustedSender(event)
    return host.currentRendererSettingsState()
  })
  ipcMain.handle(SETTINGS_IPC.getSystemTheme, (event) => {
    host.assertTrustedSender(event)
    return host.shouldUseDarkColors() ? 'dark' : 'light'
  })
  // Reset to default in Settings → Appearance: how Hronaut looks.
  ipcMain.handle(SETTINGS_IPC.resetAppearance, async (event) => {
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
  // Reset to default in Settings → General: language and spell check, startup and tray, and how agent activity shows.
  ipcMain.handle(SETTINGS_IPC.resetGeneral, async (event) => {
    host.assertTrustedSender(event)
    if (host.isPackaged() && !host.startupLaunchManager()) {
      throw new LocalizedError('appErrors.settings.startupIntegrationUnavailable')
    }
    const startupLaunch = host.isPackaged() ? host.startupLaunchManager() : null
    await host.updateSettings({
      hideInTray: DEFAULT_SETTINGS.hideInTray,
      launchAtStartup: DEFAULT_SETTINGS.launchAtStartup,
      launchMinimized: DEFAULT_SETTINGS.launchMinimized,
      attentionSound: DEFAULT_SETTINGS.attentionSound,
      attentionSoundCue: DEFAULT_SETTINGS.attentionSoundCue,
      showAgentCursor: DEFAULT_SETTINGS.showAgentCursor,
      pinAgentLiveStatus: DEFAULT_SETTINGS.pinAgentLiveStatus,
      languagePreference: DEFAULT_SETTINGS.languagePreference,
      spellCheck: DEFAULT_SETTINGS.spellCheck,
      spellCheckLanguages: [...DEFAULT_SETTINGS.spellCheckLanguages]
    }, async (next) => {
      host.applySpellCheck(next.spellCheck)
      host.applySpellCheckLanguages(next.spellCheckLanguages)
      await startupLaunch?.setEnabled(next.launchAtStartup)
    })
    // Publishes the reset settings too, also when the language stays the same.
    await host.applyLanguagePreferenceRuntime(host.settings().languagePreference)
    return host.currentRendererSettingsState()
  })
  ipcMain.handle(SETTINGS_IPC.setTheme, async (event, theme: unknown) => {
    host.assertTrustedSender(event)
    if (!isThemeName(theme)) throw new TypeError('Unsupported theme')
    await host.updateSettings({ theme })
    host.applyTheme(theme)
    host.publishSettings()
    return { ...host.settings() }
  })
  ipcMain.handle(SETTINGS_IPC.setInterfaceScale, async (event, scale: unknown) => {
    host.assertTrustedSender(event)
    if (!isInterfaceScale(scale)) throw new TypeError('Unsupported interface size')
    await host.updateSettings({ interfaceScale: scale })
    host.applyInterfaceScale(scale)
    host.publishSettings()
    return { ...host.settings() }
  })
  ipcMain.handle(SETTINGS_IPC.setTabPosition, async (event, position: unknown) => {
    host.assertTrustedSender(event)
    if (!isTabPosition(position)) throw new TypeError('Invalid tab position')
    await host.updateSettings({ tabPosition: position })
    host.applyMainWindowTitleBarOverlay()
    host.applyMainWindowBackground()
    host.publishSettings()
    return { ...host.settings() }
  })
  ipcMain.handle(SETTINGS_IPC.setUseSystemTitleBar, async (event, enabled: unknown) => {
    host.assertTrustedSender(event)
    if (typeof enabled !== 'boolean') throw new TypeError('System title bar preference must be a boolean')
    await host.updateSettings({ useSystemTitleBar: enabled })
    host.publishSettings()
    return { ...host.settings() }
  })
  ipcMain.handle(SETTINGS_IPC.setSearchEngine, async (event, searchEngine: unknown) => {
    host.assertTrustedSender(event)
    if (!isSearchEngineName(searchEngine)) throw new TypeError('Unsupported search engine')
    await host.updateSettings({ searchEngine })
    host.publishSettings()
    return { ...host.settings() }
  })
  ipcMain.handle(SETTINGS_IPC.getDefaultDownloadDirectory, (event) => {
    host.assertTrustedSender(event)
    return host.defaultDownloadDirectory()
  })
  ipcMain.handle(SETTINGS_IPC.chooseDownloadDirectory, async (event) => {
    host.assertTrustedSender(event)
    const result = await host.chooseDownloadDirectory()
    const directory = result.filePaths[0]
    if (result.canceled || !directory) return { settings: { ...host.settings() }, canceled: true }
    return {
      settings: await host.applyDownloadSettings({ downloadDirectory: resolve(directory) }),
      canceled: false
    }
  })
  ipcMain.handle(SETTINGS_IPC.setAskWhereToSaveDownloads, (event, enabled: unknown) => {
    host.assertTrustedSender(event)
    if (typeof enabled !== 'boolean') throw new TypeError('Ask-before-saving must be a boolean')
    return host.applyDownloadSettings({ askWhereToSaveDownloads: enabled })
  })
  ipcMain.handle(SETTINGS_IPC.resetDownloads, (event) => {
    host.assertTrustedSender(event)
    return host.applyDownloadSettings({ downloadDirectory: null, askWhereToSaveDownloads: false })
  })
  ipcMain.handle(SETTINGS_IPC.openDownloadDirectory, async (event) => {
    host.assertTrustedSender(event)
    const directory = host.effectiveDownloadDirectory()
    await createDownloadFolder(directory)
    const error = await host.openPath(directory)
    if (error) throw new LocalizedError('appErrors.settings.downloadFolderOpenFailed', undefined, { message: error })
  })
  host.handleBrowserIpc(SETTINGS_IPC.setMemorySaverEnabled, async (event, enabled: unknown) => {
    host.assertTrustedSender(event)
    if (typeof enabled !== 'boolean') throw new TypeError('Memory Saver state must be a boolean')
    await host.updateSettings({ memorySaverEnabled: enabled })
    const browser = host.tabs()
    if (browser) setMemorySaverSettings(browser, host.settings().memorySaverEnabled, host.settings().memorySaverTimeoutMinutes)
    host.publishSettings()
    return { ...host.settings() }
  })
  host.handleBrowserIpc(SETTINGS_IPC.setMemorySaverTimeoutMinutes, async (event, timeoutMinutes: unknown) => {
    host.assertTrustedSender(event)
    if (!isMemorySaverTimeoutMinutes(timeoutMinutes)) throw new TypeError('Unsupported Memory Saver timeout')
    await host.updateSettings({ memorySaverTimeoutMinutes: timeoutMinutes })
    const browser = host.tabs()
    if (browser) setMemorySaverSettings(browser, host.settings().memorySaverEnabled, host.settings().memorySaverTimeoutMinutes)
    host.publishSettings()
    return { ...host.settings() }
  })
  host.handleBrowserIpc(SETTINGS_IPC.resetMemorySaver, async (event) => {
    host.assertTrustedSender(event)
    // Reset to default in Settings → Performance: Memory Saver, and graphics acceleration from the next start.
    await host.updateSettings({
      memorySaverEnabled: true,
      memorySaverTimeoutMinutes: DEFAULT_MEMORY_SAVER_TIMEOUT_MINUTES,
      graphicsAcceleration: DEFAULT_SETTINGS.graphicsAcceleration
    })
    const browser = host.tabs()
    if (browser) setMemorySaverSettings(browser, host.settings().memorySaverEnabled, host.settings().memorySaverTimeoutMinutes)
    host.publishSettings()
    return { ...host.settings() }
  })
  ipcMain.handle(SETTINGS_IPC.setHideInTray, async (event, enabled: unknown) => {
    host.assertTrustedSender(event)
    if (typeof enabled !== 'boolean') throw new TypeError('Hide in tray must be a boolean')
    await host.updateSettings({ hideInTray: enabled })
    host.publishSettings()
    return { ...host.settings() }
  })
  ipcMain.handle(SETTINGS_IPC.setLaunchAtStartup, async (event, enabled: unknown) => {
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
  ipcMain.handle(SETTINGS_IPC.setLaunchMinimized, async (event, enabled: unknown) => {
    host.assertTrustedSender(event)
    if (typeof enabled !== 'boolean') throw new TypeError('Launch-minimized preference must be a boolean')
    await host.updateSettings({ launchMinimized: enabled })
    host.publishSettings()
    return { ...host.settings() }
  })
  ipcMain.handle(SETTINGS_IPC.setAttentionSound, async (event, enabled: unknown) => {
    host.assertTrustedSender(event)
    if (typeof enabled !== 'boolean') throw new TypeError('Attention sound must be a boolean')
    await host.updateSettings({ attentionSound: enabled })
    host.publishSettings()
    return { ...host.settings() }
  })
  ipcMain.handle(SETTINGS_IPC.setAttentionSoundCue, async (event, cue: unknown) => {
    host.assertTrustedSender(event)
    if (!isAttentionSoundCue(cue)) throw new TypeError('Unsupported attention sound')
    await host.updateSettings({ attentionSoundCue: cue })
    host.publishSettings()
    return { ...host.settings() }
  })
  ipcMain.handle(SETTINGS_IPC.setShowAgentCursor, async (event, enabled: unknown) => {
    host.assertTrustedSender(event)
    if (typeof enabled !== 'boolean') throw new TypeError('Show agent cursor must be a boolean')
    await host.updateSettings({ showAgentCursor: enabled })
    host.publishSettings()
    return { ...host.settings() }
  })
  ipcMain.handle(SETTINGS_IPC.setPinAgentLiveStatus, async (event, enabled: unknown) => {
    host.assertTrustedSender(event)
    if (typeof enabled !== 'boolean') throw new TypeError('Pin agent live status must be a boolean')
    await host.updateSettings({ pinAgentLiveStatus: enabled })
    host.publishSettings()
    return { ...host.settings() }
  })
  ipcMain.handle(SETTINGS_IPC.setFollowAgentActivity, async (event, enabled: unknown) => {
    host.assertTrustedSender(event)
    if (typeof enabled !== 'boolean') throw new TypeError('Follow agent activity must be a boolean')
    // Applied at once, in the order asked, so following cannot move the view after the person
    // turned it off, such as with Stay here, while the setting is still being saved.
    const intent = ++followAgentActivityIntent
    followAgentActivity(enabled)
    try {
      await host.updateSettings({ followAgentActivity: enabled })
    } catch (error) {
      if (intent === followAgentActivityIntent) followAgentActivity(host.settings().followAgentActivity)
      throw error
    }
    host.publishSettings()
    return { ...host.settings() }
  })
  ipcMain.handle(SETTINGS_IPC.setChallengeDetectionEnabled, async (event, enabled: unknown) => {
    host.assertTrustedSender(event)
    if (typeof enabled !== 'boolean') throw new TypeError('Challenge detection must be a boolean')
    await host.updateSettings({ challengeDetectionEnabled: enabled })
    host.publishSettings()
    return { ...host.settings() }
  })
  ipcMain.handle(SETTINGS_IPC.setOmitAgentUrlDetail, async (event, enabled: unknown) => {
    host.assertTrustedSender(event)
    if (typeof enabled !== 'boolean') throw new TypeError('Omitting URL detail must be a boolean')
    await host.updateSettings({ omitAgentUrlDetail: enabled })
    host.publishSettings()
    return { ...host.settings() }
  })
  ipcMain.handle(SETTINGS_IPC.setAllowWebsiteFileSaving, async (event, enabled: unknown) => {
    host.assertTrustedSender(event)
    if (typeof enabled !== 'boolean') throw new TypeError('Website file saving must be a boolean')
    await host.updateSettings({ allowWebsiteFileSaving: enabled })
    host.publishSettings()
    return { ...host.settings() }
  })
  ipcMain.handle(SETTINGS_IPC.setMcpRemoteAccess, async (event, enabled: unknown) => {
    host.assertTrustedSender(event)
    if (typeof enabled !== 'boolean') throw new TypeError('Remote MCP access must be a boolean')
    const next = await host.updateSettings({ mcpRemoteAccess: enabled })
    host.mcpServer()?.setAuthenticationToken(next.mcpAuthentication ? host.mcpTokenConfiguration()?.token : undefined)
    host.publishSettings()
    host.refreshHomeAfterCommittedChange('mcp')
    return next
  })
  ipcMain.handle(SETTINGS_IPC.setMcpAuthentication, async (event, enabled: unknown) => {
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
  host.handleBrowserIpc(SETTINGS_IPC.setMcpPort, async (event, port: unknown) => {
    host.assertTrustedSender(event)
    return host.setMcpPort(port as number)
  })
  ipcMain.handle(SETTINGS_IPC.setMcpToolSet, async (event, toolSet: unknown) => {
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
  host.handleBrowserIpc(SETTINGS_IPC.resetMcp, async (event) => {
    host.assertTrustedSender(event)
    return host.resetMcpSettings()
  })
  ipcMain.handle(SETTINGS_IPC.listMcpCapabilityProfiles, (event) => {
    host.assertTrustedSender(event)
    return requireCapabilityProfiles().list()
  })
  ipcMain.handle(SETTINGS_IPC.createMcpCapabilityProfile, async (event, value: unknown) => {
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
  ipcMain.handle(SETTINGS_IPC.updateMcpCapabilityProfile, async (event, id: unknown, value: unknown) => {
    host.assertTrustedSender(event)
    if (typeof id !== 'string') throw new TypeError('MCP capability profile ID is invalid')
    const input = capabilityProfileInput(value)
    if (input.parentProfileId !== undefined) throw new TypeError('An existing MCP capability profile cannot be reparented')
    const result = await requireCapabilityProfiles().update(id, mcpCapabilityProfileInputFromPreset(input))
    return result
  })
  ipcMain.handle(SETTINGS_IPC.rotateMcpCapabilityProfile, async (event, id: unknown) => {
    host.assertTrustedSender(event)
    if (typeof id !== 'string') throw new TypeError('MCP capability profile ID is invalid')
    const result = await requireCapabilityProfiles().rotate(id)
    return result
  })
  ipcMain.handle(SETTINGS_IPC.revokeMcpCapabilityProfile, async (event, id: unknown) => {
    host.assertTrustedSender(event)
    if (typeof id !== 'string') throw new TypeError('MCP capability profile ID is invalid')
    const profile = await requireCapabilityProfiles().revoke(id)
    return profile
  })
  ipcMain.handle(SETTINGS_IPC.setCheckForUpdatesOnStartup, async (event, enabled: unknown) => {
    host.assertTrustedSender(event)
    if (typeof enabled !== 'boolean') throw new TypeError('Startup update check must be a boolean')
    await host.updateSettings({ checkForUpdatesOnStartup: enabled })
    host.publishSettings()
    return { ...host.settings() }
  })
  ipcMain.handle(SETTINGS_IPC.setLanguagePreference, async (event, preference: unknown) => {
    host.assertTrustedSender(event)
    if (!isLanguagePreference(preference)) throw new TypeError('Invalid language preference')
    await host.updateSettings({ languagePreference: preference })
    await host.applyLanguagePreferenceRuntime(preference)
    return host.currentRendererSettingsState()
  })
}
