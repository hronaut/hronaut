import type { SearchEngineName } from '../search-engine.js'
import type { SiteSearch } from '../site-search.js'
import type { SecureDnsMode } from '../secure-dns.js'
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
  /** Shortcuts that search a site from the address bar, as Chrome's site search does; see site-search.ts. */
  siteSearches: SiteSearch[]
  hideInTray: boolean
  launchAtStartup: boolean
  launchMinimized: boolean
  attentionSound: boolean
  attentionSoundCue: AttentionSoundCue
  challengeDetectionEnabled: boolean
  /** Agents see tab addresses as origin and path, without credentials, query or fragment. */
  omitAgentUrlDetail: boolean
  /**
   * Websites may save to every single file they hold, such as one opened or dropped on them, and not only to the one
   * picked in their Save dialog. Off by default: Electron cannot tell such a file from one a rename would replace.
   */
  allowWebsiteFileSaving: boolean
  /** How website addresses are looked up: secure DNS when the DNS service offers it, through one provider only, or plain. */
  secureDnsMode: SecureDnsMode
  /** The chosen provider's DNS over HTTPS address, kept while another mode is on; empty until one is chosen. */
  secureDnsTemplate: string
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
  /**
   * Use graphics acceleration when available, as in Chrome: Chromium draws with the graphics card. Read at startup, so a
   * change applies at the next start.
   */
  graphicsAcceleration: boolean
  checkForUpdatesOnStartup: boolean
  languagePreference: LanguagePreference
  /** Check spelling in websites' text fields, as in Chrome: misspelled words are underlined and the menu suggests fixes. */
  spellCheck: boolean
  /**
   * The languages spell checking checks, as Chrome's spell check languages; none chosen means the one for Hronaut's
   * locale. Not on macOS, where the system's spell checker picks the language.
   */
  spellCheckLanguages: string[]
}

/** The spell check languages Settings offers. */
export interface SpellCheckLanguages {
  /** The languages Chromium has dictionaries for, as codes such as `en-US`; none on macOS. */
  available: string[]
  /** The language checked while none is chosen. */
  automatic: string[]
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

/** Where a saved site permission decision applies, besides its website and permission. */
export interface SitePermissionScope {
  /** The workspace the decision was made in; it applies only there. */
  workspaceId: string
  /**
   * The website, as an origin, of the page the requesting website was embedded in, such as the page around a video-call
   * widget. A decision for a page's own website has none.
   */
  embeddedIn?: string
}

export interface SitePermissionEntry extends SitePermissionScope {
  origin: string
  permission: string
  decision: SitePermissionDecision
}
