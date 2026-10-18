import type { SearchEngineName } from '../search-engine.js'
import type { MemorySaverTimeoutMinutes } from '../memory-saver.js'
import type { InterfaceScale } from '../interface-scale.js'
import type { LanguagePreference, SupportedLocale } from '../locale.js'
import type { TabPosition } from '../tab-position.js'
import type { WindowMaterial } from '../window-material.js'

export type ThemeName =
  | 'system'
  | 'light'
  | 'dark'
  | 'midnight'
  | 'sepia'
  | 'cyberpunk'
  | 'cyberpunk-turbo'
  | 'matrix'
  | 'machine'
  | 'galactic'

export const ATTENTION_SOUND_CUES = [
  'warning',
  'bell',
  'chime',
  'ping',
  'bubble',
  'pop',
  'ready',
  'complete',
  'sparkle',
  'success',
  'error'
] as const
export type AttentionSoundCue = (typeof ATTENTION_SOUND_CUES)[number]

export function isAttentionSoundCue(value: unknown): value is AttentionSoundCue {
  return typeof value === 'string' && ATTENTION_SOUND_CUES.includes(value as AttentionSoundCue)
}

export interface AppSettings {
  theme: ThemeName
  interfaceScale: InterfaceScale
  tabPosition: TabPosition
  useSystemTitleBar: boolean
  searchEngine: SearchEngineName
  hideInTray: boolean
  launchAtStartup: boolean
  launchMinimized: boolean
  attentionSound: boolean
  attentionSoundCue: AttentionSoundCue
  challengeDetectionEnabled: boolean
  followAgentActivity: boolean
  /** Draw each agent's named cursor on the page where it clicks, points or drags. */
  showAgentCursor: boolean
  /** Keep the live status of the workspace's agent in a strip below the toolbar. */
  pinAgentLiveStatus: boolean
  mcpRemoteAccess: boolean
  mcpAuthentication: boolean
  mcpPort: number
  mcpToolSet: import('../mcp-tool-sets.js').McpToolSet
  downloadDirectory: string | null
  askWhereToSaveDownloads: boolean
  memorySaverEnabled: boolean
  memorySaverTimeoutMinutes: MemorySaverTimeoutMinutes
  checkForUpdatesOnStartup: boolean
  languagePreference: LanguagePreference
}

export interface RendererSettingsState {
  settings: AppSettings
  systemTheme: 'light' | 'dark'
  systemLocale: SupportedLocale
  resolvedLocale: SupportedLocale
  /** What main shows behind the main window's tab rail; absent or null for the theme's solid surface. */
  windowMaterial?: WindowMaterial | null
}

export interface DownloadDirectorySelection {
  settings: AppSettings
  canceled: boolean
}

export type SitePermissionDecision = 'allow' | 'deny'

export interface SitePermissionEntry {
  origin: string
  permission: string
  decision: SitePermissionDecision
}
