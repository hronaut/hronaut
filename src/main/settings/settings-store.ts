import { readFile } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { isAttentionSoundCue, type AppSettings } from '../../shared/types.js'
import { isThemeName } from '../../shared/theme.js'
import { DEFAULT_MCP_PORT, isValidMcpPort } from '../../shared/mcp-port.js'
import { DEFAULT_SEARCH_ENGINE, isSearchEngineName } from '../../shared/search-engine.js'
import { readSiteSearches } from '../../shared/site-search.js'
import { DEFAULT_SECURE_DNS_MODE, readSecureDns } from '../../shared/secure-dns.js'
import { DEFAULT_INTERFACE_SCALE, isInterfaceScale } from '../../shared/interface-scale.js'
import {
  DEFAULT_MEMORY_SAVER_TIMEOUT_MINUTES,
  isMemorySaverTimeoutMinutes
} from '../../shared/memory-saver.js'
import { isLanguagePreference } from '../../shared/locale.js'
import { DEFAULT_TAB_POSITION, isTabPosition } from '../../shared/tab-position.js'
import {
  DEFAULT_MCP_TOOL_SET,
  isMcpToolSet
} from '../../shared/mcp-tool-sets.js'
import { writeTextFileAtomically } from '../atomic-file.js'

export const DEFAULT_SETTINGS: AppSettings = {
  // New profiles start in the look hronaut.dev shows; a saved theme, System included, stays as it is.
  theme: 'cyberpunk',
  interfaceScale: DEFAULT_INTERFACE_SCALE,
  tabPosition: DEFAULT_TAB_POSITION,
  useSystemTitleBar: false,
  searchEngine: DEFAULT_SEARCH_ENGINE,
  siteSearches: [],
  hideInTray: true,
  launchAtStartup: false,
  launchMinimized: false,
  attentionSound: true,
  attentionSoundCue: 'warning',
  challengeDetectionEnabled: false,
  omitAgentUrlDetail: false,
  allowWebsiteFileSaving: false,
  secureDnsMode: DEFAULT_SECURE_DNS_MODE,
  secureDnsTemplate: '',
  followAgentActivity: false,
  showAgentCursor: true,
  // Off by default for now; the default for everyone is still to be decided.
  pinAgentLiveStatus: false,
  mcpRemoteAccess: false,
  mcpAuthentication: true,
  mcpPort: DEFAULT_MCP_PORT,
  mcpToolSet: DEFAULT_MCP_TOOL_SET,
  downloadDirectory: null,
  askWhereToSaveDownloads: false,
  memorySaverEnabled: true,
  memorySaverTimeoutMinutes: DEFAULT_MEMORY_SAVER_TIMEOUT_MINUTES,
  graphicsAcceleration: true,
  checkForUpdatesOnStartup: true,
  languagePreference: 'system',
  spellCheck: true,
  spellCheckLanguages: []
}

export { isThemeName }

export function isDownloadDirectory(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 4_096
    && !value.includes('\0')
    && isAbsolute(value)
}

/** Spell check languages as saved: different language codes, such as `en-US`; which of them have dictionaries is checked where they apply. */
export function isSpellCheckLanguageList(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.length <= 64
    && new Set(value).size === value.length
    && value.every((language) => typeof language === 'string' && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(language))
}

export class SettingsStore {
  private saveQueue: Promise<void> = Promise.resolve()

  constructor(private readonly path: string) {}

  async load(): Promise<AppSettings> {
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ...DEFAULT_SETTINGS }
      const value = parsed as Partial<AppSettings>
      const checkForUpdatesOnStartup = typeof value.checkForUpdatesOnStartup === 'boolean'
        ? value.checkForUpdatesOnStartup
        : DEFAULT_SETTINGS.checkForUpdatesOnStartup
      return {
        theme: isThemeName(value.theme) ? value.theme : DEFAULT_SETTINGS.theme,
        interfaceScale: isInterfaceScale(value.interfaceScale) ? value.interfaceScale : DEFAULT_SETTINGS.interfaceScale,
        tabPosition: isTabPosition(value.tabPosition) ? value.tabPosition : DEFAULT_SETTINGS.tabPosition,
        useSystemTitleBar:
          typeof value.useSystemTitleBar === 'boolean'
            ? value.useSystemTitleBar
            : DEFAULT_SETTINGS.useSystemTitleBar,
        searchEngine: isSearchEngineName(value.searchEngine) ? value.searchEngine : DEFAULT_SETTINGS.searchEngine,
        siteSearches: readSiteSearches(value.siteSearches),
        hideInTray: typeof value.hideInTray === 'boolean' ? value.hideInTray : DEFAULT_SETTINGS.hideInTray,
        launchAtStartup:
          typeof value.launchAtStartup === 'boolean' ? value.launchAtStartup : DEFAULT_SETTINGS.launchAtStartup,
        launchMinimized:
          typeof value.launchMinimized === 'boolean' ? value.launchMinimized : DEFAULT_SETTINGS.launchMinimized,
        attentionSound:
          typeof value.attentionSound === 'boolean' ? value.attentionSound : DEFAULT_SETTINGS.attentionSound,
        attentionSoundCue: isAttentionSoundCue(value.attentionSoundCue)
          ? value.attentionSoundCue
          : DEFAULT_SETTINGS.attentionSoundCue,
        followAgentActivity:
          typeof value.followAgentActivity === 'boolean'
            ? value.followAgentActivity
            : DEFAULT_SETTINGS.followAgentActivity,
        showAgentCursor:
          typeof value.showAgentCursor === 'boolean' ? value.showAgentCursor : DEFAULT_SETTINGS.showAgentCursor,
        pinAgentLiveStatus:
          typeof value.pinAgentLiveStatus === 'boolean' ? value.pinAgentLiveStatus : DEFAULT_SETTINGS.pinAgentLiveStatus,
        challengeDetectionEnabled: value.challengeDetectionEnabled === true,
        omitAgentUrlDetail: value.omitAgentUrlDetail === true,
        allowWebsiteFileSaving: value.allowWebsiteFileSaving === true,
        ...readSecureDns(value.secureDnsMode, value.secureDnsTemplate),
        mcpRemoteAccess: value.mcpRemoteAccess === true,
        mcpAuthentication:
          typeof value.mcpAuthentication === 'boolean'
            ? value.mcpAuthentication
            : DEFAULT_SETTINGS.mcpAuthentication,
        mcpPort: isValidMcpPort(value.mcpPort) ? value.mcpPort : DEFAULT_SETTINGS.mcpPort,
        mcpToolSet: isMcpToolSet(value.mcpToolSet)
          ? value.mcpToolSet
          : DEFAULT_MCP_TOOL_SET,
        downloadDirectory: isDownloadDirectory(value.downloadDirectory) ? value.downloadDirectory : null,
        askWhereToSaveDownloads:
          typeof value.askWhereToSaveDownloads === 'boolean'
            ? value.askWhereToSaveDownloads
            : DEFAULT_SETTINGS.askWhereToSaveDownloads,
        memorySaverEnabled:
          typeof value.memorySaverEnabled === 'boolean'
            ? value.memorySaverEnabled
            : DEFAULT_SETTINGS.memorySaverEnabled,
        memorySaverTimeoutMinutes: isMemorySaverTimeoutMinutes(value.memorySaverTimeoutMinutes)
          ? value.memorySaverTimeoutMinutes
          : DEFAULT_SETTINGS.memorySaverTimeoutMinutes,
        // Only an explicit off turns it off, as readSavedGraphicsAcceleration reads it at startup.
        graphicsAcceleration: value.graphicsAcceleration !== false,
        checkForUpdatesOnStartup,
        languagePreference: isLanguagePreference(value.languagePreference)
          ? value.languagePreference
          : DEFAULT_SETTINGS.languagePreference,
        spellCheck: typeof value.spellCheck === 'boolean' ? value.spellCheck : DEFAULT_SETTINGS.spellCheck,
        spellCheckLanguages: isSpellCheckLanguageList(value.spellCheckLanguages)
          ? [...value.spellCheckLanguages]
          : [...DEFAULT_SETTINGS.spellCheckLanguages]
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
      return { ...DEFAULT_SETTINGS }
    }
  }

  save(settings: AppSettings): Promise<void> {
    const contents = `${JSON.stringify(settings, null, 2)}\n`
    const operation = this.saveQueue.then(async () => {
      await writeTextFileAtomically(this.path, contents)
    })
    this.saveQueue = operation.catch(() => undefined)
    return operation
  }
}
