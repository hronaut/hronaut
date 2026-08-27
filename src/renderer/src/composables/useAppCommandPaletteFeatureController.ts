import type { Ref } from 'vue'
import type { BrowserShortcutAction } from '../../../shared/browser-shortcuts.js'
import {
  useCommandPaletteShellController,
  type CommandPalettePanel
} from './useCommandPaletteShellController.js'
import type { SettingsSection } from './useSettingsDialogController.js'
import type { AppBrowserCollectionsFeatureController } from './useAppBrowserCollectionsFeatureController.js'
import type { AppEmulationFeatureController } from './useAppEmulationFeatureController.js'
import type { AppPageToolsFeatureController } from './useAppPageToolsFeatureController.js'
import type { AppPanelFeatureController } from './useAppPanelFeatureController.js'
import type { AppSiteManagementFeatureController } from './useAppSiteManagementFeatureController.js'

type BrowserCollectionCommands = Pick<
  AppBrowserCollectionsFeatureController,
  'toggleDownloads' | 'toggleBookmarks' | 'toggleVisitHistory'
>

type EmulationCommands = Pick<
  AppEmulationFeatureController,
  'toggleResponsivePreview' | 'toggleEnvironment'
>

type PageToolsCommands = Pick<
  AppPageToolsFeatureController,
  | 'toggleAreaCapture'
  | 'toggleElementPicker'
  | 'capturePageScreenshot'
  | 'copyPageSnapshot'
  | 'toggleInspectorIssues'
  | 'toggleDebugReport'
  | 'toggleReproRecorder'
  | 'toggleDomChanges'
  | 'toggleVisualCompare'
  | 'toggleQualityAudit'
  | 'toggleAccessibilityAudit'
  | 'togglePerformanceReport'
  | 'toggleDesignOverview'
  | 'togglePageMetadata'
  | 'toggleSecurityReport'
  | 'toggleCodeCoverage'
  | 'toggleCpuProfile'
  | 'toggleMemoryReport'
>

type PanelCommands = Pick<
  AppPanelFeatureController,
  'toggleConsole' | 'toggleNetworkMonitor' | 'openRequestConditions'
>

type SiteCommands = Pick<
  AppSiteManagementFeatureController,
  'toggleSiteStorage' | 'openPrivacySettings' | 'openUpdateSettings'
>

export interface AppCommandPaletteBrowserCommands {
  openHome: () => unknown
  runShortcut: (action: BrowserShortcutAction) => unknown
  toggleTabSearch: () => unknown
  openFind: () => unknown
  togglePageTools: () => unknown
  toggleDeveloperTools: () => unknown
}

export interface AppCommandPaletteSettingsCommands {
  openSection: (section: SettingsSection) => unknown
  openHelp: (tab: 'shortcuts') => unknown
  toggleMcpPaused: () => unknown
}

export interface AppCommandPaletteFeatureControllerOptions<
  TPanel extends CommandPalettePanel
> {
  open: Ref<boolean>
  panel: Readonly<Ref<TPanel | null>>
  beforeOpen: () => void
  browser: AppCommandPaletteBrowserCommands
  collections: BrowserCollectionCommands
  emulation: EmulationCommands
  pageTools: PageToolsCommands
  panels: PanelCommands
  site: SiteCommands
  settings: AppCommandPaletteSettingsCommands
}

export function useAppCommandPaletteFeatureController<
  TPanel extends CommandPalettePanel
>(options: AppCommandPaletteFeatureControllerOptions<TPanel>) {
  return useCommandPaletteShellController({
    open: options.open,
    panel: options.panel,
    beforeOpen: options.beforeOpen,
    actions: {
      home: options.browser.openHome,
      'new-tab': () => options.browser.runShortcut('new-tab'),
      'search-tabs': options.browser.toggleTabSearch,
      downloads: options.collections.toggleDownloads,
      bookmarks: options.collections.toggleBookmarks,
      history: options.collections.toggleVisitHistory,
      find: options.browser.openFind,
      reload: () => options.browser.runShortcut('reload'),
      'reload-ignoring-cache': () => options.browser.runShortcut('reload-ignoring-cache'),
      'capture-area': options.pageTools.toggleAreaCapture,
      'capture-element': () => options.pageTools.toggleElementPicker('screenshot'),
      'capture-viewport': () => options.pageTools.capturePageScreenshot('viewport'),
      'capture-full-page': () => options.pageTools.capturePageScreenshot('full-page'),
      'copy-snapshot': options.pageTools.copyPageSnapshot,
      'pick-element': () => options.pageTools.toggleElementPicker('context'),
      'page-tools': options.browser.togglePageTools,
      'site-storage': options.site.toggleSiteStorage,
      'responsive-preview': options.emulation.toggleResponsivePreview,
      environment: options.emulation.toggleEnvironment,
      console: options.panels.toggleConsole,
      network: options.panels.toggleNetworkMonitor,
      'request-conditions': options.panels.openRequestConditions,
      issues: options.pageTools.toggleInspectorIssues,
      'debug-report': options.pageTools.toggleDebugReport,
      'repro-recorder': options.pageTools.toggleReproRecorder,
      'dom-changes': options.pageTools.toggleDomChanges,
      'visual-compare': options.pageTools.toggleVisualCompare,
      'quality-audit': options.pageTools.toggleQualityAudit,
      accessibility: options.pageTools.toggleAccessibilityAudit,
      performance: options.pageTools.togglePerformanceReport,
      'design-overview': options.pageTools.toggleDesignOverview,
      'page-metadata': options.pageTools.togglePageMetadata,
      security: options.pageTools.toggleSecurityReport,
      coverage: options.pageTools.toggleCodeCoverage,
      'cpu-profile': options.pageTools.toggleCpuProfile,
      memory: options.pageTools.toggleMemoryReport,
      'developer-tools': options.browser.toggleDeveloperTools,
      settings: () => options.settings.openSection('appearance'),
      privacy: options.site.openPrivacySettings,
      'site-permissions': () => options.settings.openSection('permissions'),
      'mcp-security': () => options.settings.openSection('mcp'),
      updates: options.site.openUpdateSettings,
      'keyboard-shortcuts': () => options.settings.openHelp('shortcuts'),
      'toggle-mcp-pause': options.settings.toggleMcpPaused
    }
  })
}

export type AppCommandPaletteFeatureController = ReturnType<
  typeof useAppCommandPaletteFeatureController
>
