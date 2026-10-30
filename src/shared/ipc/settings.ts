import type {
  AppSettings,
  AttentionSoundCue,
  DownloadDirectorySelection,
  InterfaceScale,
  LanguagePreference,
  McpCapabilityCredentialResult,
  McpCapabilityProfileCreateInput,
  McpCapabilityProfileSummary,
  MemorySaverTimeoutMinutes,
  RendererSettingsState,
  SearchEngineName,
  SpellCheckLanguages,
  TabPosition,
  ThemeName
} from '../types.js'
import type { McpToolSet } from '../mcp-tool-sets.js'
import type { SecureDnsMode } from '../secure-dns.js'
import type { SiteSearchDraft } from '../site-search.js'
import type { EventChannel, InvokeChannel } from './channel.js'

/**
 * Hronaut's settings, for Settings and everything in the shell that follows them. Each change answers with the
 * settings after it, the shell's own settings (RendererSettingsState) where that is what changed.
 */
export const SETTINGS_IPC = {
  /** Shell → main: the settings. */
  get: 'settings:get' as InvokeChannel<[], AppSettings>,
  /** Shell → main: the settings the shell draws with: theme, scale, tab position, language. */
  getRendererState: 'settings:get-renderer-state' as InvokeChannel<[], RendererSettingsState>,
  /** Shell → main: whether the system is in light or dark mode. */
  getSystemTheme: 'settings:get-system-theme' as InvokeChannel<[], 'light' | 'dark'>,
  /** Shell → main: resets Appearance. */
  resetAppearance: 'settings:reset-appearance' as InvokeChannel<[], RendererSettingsState>,
  /** Shell → main: resets General. */
  resetGeneral: 'settings:reset-general' as InvokeChannel<[], RendererSettingsState>,
  /** Shell → main: sets the theme. */
  setTheme: 'settings:set-theme' as InvokeChannel<[theme: ThemeName], AppSettings>,
  /** Shell → main: sets the interface scale. */
  setInterfaceScale: 'settings:set-interface-scale' as InvokeChannel<[scale: InterfaceScale], AppSettings>,
  /** Shell → main: sets where the tabs go. */
  setTabPosition: 'settings:set-tab-position' as InvokeChannel<[position: TabPosition], AppSettings>,
  /** Shell → main: turns the system's title bar, instead of Hronaut's, on or off. */
  setUseSystemTitleBar: 'settings:set-use-system-title-bar' as InvokeChannel<[enabled: boolean], AppSettings>,
  /** Shell → main: sets the search engine. */
  setSearchEngine: 'settings:set-search-engine' as InvokeChannel<[searchEngine: SearchEngineName], AppSettings>,
  /** Shell → main: adds a site search. */
  addSiteSearch: 'settings:add-site-search' as InvokeChannel<[draft: SiteSearchDraft], AppSettings>,
  /** Shell → main: changes a site search. */
  updateSiteSearch: 'settings:update-site-search' as InvokeChannel<[id: string, draft: SiteSearchDraft], AppSettings>,
  /** Shell → main: removes a site search. */
  removeSiteSearch: 'settings:remove-site-search' as InvokeChannel<[id: string], AppSettings>,
  /** Shell → main: sets how website addresses are looked up, with the provider's DNS over HTTPS address for Secure. */
  setSecureDns: 'settings:set-secure-dns' as InvokeChannel<[mode: SecureDnsMode, template: string], AppSettings>,
  /** Shell → main: turns hiding Hronaut in the tray on or off. */
  setHideInTray: 'settings:set-hide-in-tray' as InvokeChannel<[enabled: boolean], AppSettings>,
  /** Shell → main: turns starting Hronaut when the person logs in on or off. */
  setLaunchAtStartup: 'settings:set-launch-at-startup' as InvokeChannel<[enabled: boolean], AppSettings>,
  /** Shell → main: turns starting minimized on or off. */
  setLaunchMinimized: 'settings:set-launch-minimized' as InvokeChannel<[enabled: boolean], AppSettings>,
  /** Shell → main: turns the sound when an agent needs the person on or off. */
  setAttentionSound: 'settings:set-attention-sound' as InvokeChannel<[enabled: boolean], AppSettings>,
  /** Shell → main: sets which sound that is. */
  setAttentionSoundCue: 'settings:set-attention-sound-cue' as InvokeChannel<[cue: AttentionSoundCue], AppSettings>,
  /** Shell → main: turns following agent activity on or off. */
  setFollowAgentActivity: 'settings:set-follow-agent-activity' as InvokeChannel<[enabled: boolean], AppSettings>,
  /** Shell → main: turns drawing each agent's cursor on the page on or off. */
  setShowAgentCursor: 'settings:set-show-agent-cursor' as InvokeChannel<[enabled: boolean], AppSettings>,
  /** Shell → main: turns keeping the agent's live status below the toolbar on or off. */
  setPinAgentLiveStatus: 'settings:set-pin-agent-live-status' as InvokeChannel<[enabled: boolean], AppSettings>,
  /** Shell → main: turns spell check on or off. */
  setSpellCheck: 'settings:set-spell-check' as InvokeChannel<[enabled: boolean], AppSettings>,
  /** Shell → main: the spell check languages Hronaut has dictionaries for, and the one checked while none is chosen. */
  getSpellCheckLanguages: 'settings:spell-check-languages' as InvokeChannel<[], SpellCheckLanguages>,
  /** Shell → main: sets the spell check languages. */
  setSpellCheckLanguages: 'settings:set-spell-check-languages' as InvokeChannel<[languages: string[]], AppSettings>,
  /** Shell → main: turns challenge detection on or off. */
  setChallengeDetectionEnabled: 'settings:set-challenge-detection' as InvokeChannel<[enabled: boolean], AppSettings>,
  /** Shell → main: turns showing agents tab addresses as origin and path only on or off. */
  setOmitAgentUrlDetail: 'settings:set-omit-agent-url-detail' as InvokeChannel<[enabled: boolean], AppSettings>,
  /** Shell → main: turns letting websites save to every file they hold, not only one picked to save, on or off. */
  setAllowWebsiteFileSaving: 'settings:set-allow-website-file-saving' as InvokeChannel<[enabled: boolean], AppSettings>,
  /** Shell → main: turns MCP access from other devices on or off. */
  setMcpRemoteAccess: 'settings:set-mcp-remote-access' as InvokeChannel<[enabled: boolean], AppSettings>,
  /** Shell → main: turns MCP token authentication on or off. */
  setMcpAuthentication: 'settings:set-mcp-authentication' as InvokeChannel<[enabled: boolean], AppSettings>,
  /** Shell → main: sets the MCP port. */
  setMcpPort: 'settings:set-mcp-port' as InvokeChannel<[port: number], AppSettings>,
  /** Shell → main: sets which MCP tools agents get. */
  setMcpToolSet: 'settings:set-mcp-tool-set' as InvokeChannel<[toolSet: McpToolSet], AppSettings>,
  /** Shell → main: resets the MCP settings. */
  resetMcp: 'settings:reset-mcp' as InvokeChannel<[], AppSettings>,
  /** Shell → main: the MCP capability profiles. */
  listMcpCapabilityProfiles: 'settings:list-mcp-capability-profiles' as InvokeChannel<[], McpCapabilityProfileSummary[]>,
  /** Shell → main: creates a capability profile, answering with its credential. */
  createMcpCapabilityProfile: 'settings:create-mcp-capability-profile' as InvokeChannel<[input: McpCapabilityProfileCreateInput], McpCapabilityCredentialResult>,
  /** Shell → main: changes a capability profile, answering with its credential. */
  updateMcpCapabilityProfile: 'settings:update-mcp-capability-profile' as InvokeChannel<[id: string, input: McpCapabilityProfileCreateInput], McpCapabilityCredentialResult>,
  /** Shell → main: gives a capability profile a new credential. */
  rotateMcpCapabilityProfile: 'settings:rotate-mcp-capability-profile' as InvokeChannel<[id: string], McpCapabilityCredentialResult>,
  /** Shell → main: revokes a capability profile. */
  revokeMcpCapabilityProfile: 'settings:revoke-mcp-capability-profile' as InvokeChannel<[id: string], McpCapabilityProfileSummary>,
  /** Shell → main: the folder downloads go to unless the person chose another. */
  getDefaultDownloadDirectory: 'settings:get-default-download-directory' as InvokeChannel<[], string>,
  /** Shell → main: asks the person for the downloads folder in the system's dialog. */
  chooseDownloadDirectory: 'settings:choose-download-directory' as InvokeChannel<[], DownloadDirectorySelection>,
  /** Shell → main: turns asking where to save each download on or off. */
  setAskWhereToSaveDownloads: 'settings:set-ask-where-to-save-downloads' as InvokeChannel<[enabled: boolean], AppSettings>,
  /** Shell → main: resets the downloads settings. */
  resetDownloads: 'settings:reset-downloads' as InvokeChannel<[], AppSettings>,
  /** Shell → main: opens the downloads folder. */
  openDownloadDirectory: 'settings:open-download-directory' as InvokeChannel<[], void>,
  /** Shell → main: turns Memory Saver on or off. */
  setMemorySaverEnabled: 'settings:set-memory-saver-enabled' as InvokeChannel<[enabled: boolean], AppSettings>,
  /** Shell → main: sets how long a tab waits before Memory Saver puts it to sleep. */
  setMemorySaverTimeoutMinutes: 'settings:set-memory-saver-timeout' as InvokeChannel<[timeoutMinutes: MemorySaverTimeoutMinutes], AppSettings>,
  /** Shell → main: resets the Memory Saver settings. */
  resetMemorySaver: 'settings:reset-memory-saver' as InvokeChannel<[], AppSettings>,
  /** Shell → main: turns graphics acceleration on or off, from the next start. */
  setGraphicsAcceleration: 'settings:set-graphics-acceleration' as InvokeChannel<[enabled: boolean], AppSettings>,
  /** Shell → main: whether this run draws with graphics acceleration, as the saved setting said at its start. */
  graphicsAccelerationInUse: 'settings:graphics-acceleration-in-use' as InvokeChannel<[], boolean>,
  /** Shell → main: restarts Hronaut, after asking about downloads in progress as Quit does; false when they are kept. */
  restart: 'app:restart' as InvokeChannel<[], boolean>,
  /** Shell → main: turns checking for updates when Hronaut starts on or off. */
  setCheckForUpdatesOnStartup: 'settings:set-check-on-startup' as InvokeChannel<[enabled: boolean], AppSettings>,
  /** Shell → main: sets the language Hronaut is shown in. */
  setLanguagePreference: 'settings:set-language-preference' as InvokeChannel<[preference: LanguagePreference], RendererSettingsState>,
  /** Main → shells: the settings changed. */
  changed: 'settings:changed' as EventChannel<[settings: AppSettings]>,
  /** Main → shells: the system switched between light and dark mode. */
  systemThemeChanged: 'settings:system-theme-changed' as EventChannel<[theme: 'light' | 'dark']>,
  /** Main → shells: the settings the shell draws with changed. */
  rendererStateChanged: 'settings:renderer-state-changed' as EventChannel<[state: RendererSettingsState]>
} as const
