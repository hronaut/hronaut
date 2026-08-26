import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute } from 'node:path'
import { isAttentionSoundCue, type AppSettings } from '../shared/types.js'
import { isThemeName } from '../shared/theme.js'
import { DEFAULT_MCP_PORT, isValidMcpPort } from '../shared/mcp-port.js'
import { DEFAULT_SEARCH_ENGINE, isSearchEngineName } from '../shared/search-engine.js'
import { DEFAULT_INTERFACE_SCALE, isInterfaceScale } from '../shared/interface-scale.js'
import {
  DEFAULT_MEMORY_SAVER_TIMEOUT_MINUTES,
  isMemorySaverTimeoutMinutes
} from '../shared/memory-saver.js'
import { isLanguagePreference } from '../shared/locale.js'
import { DEFAULT_TAB_POSITION, isTabPosition } from '../shared/tab-position.js'

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  interfaceScale: DEFAULT_INTERFACE_SCALE,
  tabPosition: DEFAULT_TAB_POSITION,
  searchEngine: DEFAULT_SEARCH_ENGINE,
  hideInTray: true,
  attentionSound: true,
  attentionSoundCue: 'warning',
  mcpAuthentication: false,
  mcpPort: DEFAULT_MCP_PORT,
  downloadDirectory: null,
  askWhereToSaveDownloads: false,
  memorySaverEnabled: true,
  memorySaverTimeoutMinutes: DEFAULT_MEMORY_SAVER_TIMEOUT_MINUTES,
  checkForUpdatesOnStartup: true,
  languagePreference: 'system'
}

export { isThemeName }

export function isDownloadDirectory(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 4_096
    && !value.includes('\0')
    && isAbsolute(value)
}

export class SettingsStore {
  private saveQueue: Promise<void> = Promise.resolve()

  constructor(private readonly path: string) {}

  async load(): Promise<AppSettings> {
    try {
      const value = JSON.parse(await readFile(this.path, 'utf8')) as Partial<AppSettings> & { autoUpdate?: unknown }
      const checkForUpdatesOnStartup = typeof value.autoUpdate === 'boolean'
        ? value.autoUpdate && (typeof value.checkForUpdatesOnStartup === 'boolean' ? value.checkForUpdatesOnStartup : true)
        : typeof value.checkForUpdatesOnStartup === 'boolean'
          ? value.checkForUpdatesOnStartup
          : DEFAULT_SETTINGS.checkForUpdatesOnStartup
      return {
        theme: isThemeName(value.theme) ? value.theme : DEFAULT_SETTINGS.theme,
        interfaceScale: isInterfaceScale(value.interfaceScale) ? value.interfaceScale : DEFAULT_SETTINGS.interfaceScale,
        tabPosition: isTabPosition(value.tabPosition) ? value.tabPosition : DEFAULT_SETTINGS.tabPosition,
        searchEngine: isSearchEngineName(value.searchEngine) ? value.searchEngine : DEFAULT_SETTINGS.searchEngine,
        hideInTray: typeof value.hideInTray === 'boolean' ? value.hideInTray : DEFAULT_SETTINGS.hideInTray,
        attentionSound:
          typeof value.attentionSound === 'boolean' ? value.attentionSound : DEFAULT_SETTINGS.attentionSound,
        attentionSoundCue: isAttentionSoundCue(value.attentionSoundCue)
          ? value.attentionSoundCue
          : DEFAULT_SETTINGS.attentionSoundCue,
        mcpAuthentication:
          typeof value.mcpAuthentication === 'boolean'
            ? value.mcpAuthentication
            : DEFAULT_SETTINGS.mcpAuthentication,
        mcpPort: isValidMcpPort(value.mcpPort) ? value.mcpPort : DEFAULT_SETTINGS.mcpPort,
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
        checkForUpdatesOnStartup,
        languagePreference: isLanguagePreference(value.languagePreference)
          ? value.languagePreference
          : DEFAULT_SETTINGS.languagePreference
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
      await mkdir(dirname(this.path), { recursive: true })
      const temporaryPath = `${this.path}.tmp`
      await writeFile(temporaryPath, contents, 'utf8')
      await rename(temporaryPath, this.path)
    })
    this.saveQueue = operation.catch(() => undefined)
    return operation
  }
}
