import type { Component } from 'vue'
import IconSpaceDashboardOutlineRounded from '~icons/material-symbols/space-dashboard-outline-rounded'
import IconTabNewRightOutlineRounded from '~icons/material-symbols/tab-new-right-outline-rounded'
import IconTabSearchRounded from '~icons/material-symbols/tab-search-rounded'
import IconWorkspacesOutline from '~icons/material-symbols/workspaces-outline'
import IconDownloadRounded from '~icons/material-symbols/download-rounded'
import IconBookmarksOutlineRounded from '~icons/material-symbols/bookmarks-outline-rounded'
import IconHistoryRounded from '~icons/material-symbols/history-rounded'
import IconFindInPageOutlineRounded from '~icons/material-symbols/find-in-page-outline-rounded'
import IconRefreshRounded from '~icons/material-symbols/refresh-rounded'
import IconSyncProblemRounded from '~icons/material-symbols/sync-problem-rounded'
import IconScreenshotRegionRounded from '~icons/material-symbols/screenshot-region-rounded'
import IconSelectRounded from '~icons/material-symbols/select-rounded'
import IconScreenshotMonitorOutlineRounded from '~icons/material-symbols/screenshot-monitor-outline-rounded'
import IconFullscreenPortraitRounded from '~icons/material-symbols/fullscreen-portrait-rounded'
import IconContentCopyOutlineRounded from '~icons/material-symbols/content-copy-outline-rounded'
import IconArrowSelectorToolOutlineRounded from '~icons/material-symbols/arrow-selector-tool-outline-rounded'
import IconConstructionRounded from '~icons/material-symbols/construction-rounded'
import IconDatabaseOutline from '~icons/material-symbols/database-outline'
import IconDevicesOutlineRounded from '~icons/material-symbols/devices-outline-rounded'
import IconTuneRounded from '~icons/material-symbols/tune-rounded'
import IconTerminalRounded from '~icons/material-symbols/terminal-rounded'
import IconLanOutlineRounded from '~icons/material-symbols/lan-outline-rounded'
import IconRuleRounded from '~icons/material-symbols/rule-rounded'
import IconReportOutlineRounded from '~icons/material-symbols/report-outline-rounded'
import IconBugReportOutlineRounded from '~icons/material-symbols/bug-report-outline-rounded'
import IconRadioButtonCheckedOutline from '~icons/material-symbols/radio-button-checked-outline'
import IconDifferenceOutlineRounded from '~icons/material-symbols/difference-outline-rounded'
import IconCompareRounded from '~icons/material-symbols/compare-rounded'
import IconFactCheckOutlineRounded from '~icons/material-symbols/fact-check-outline-rounded'
import IconAccessibilityNewRounded from '~icons/material-symbols/accessibility-new-rounded'
import IconSpeedOutlineRounded from '~icons/material-symbols/speed-outline-rounded'
import IconPaletteOutline from '~icons/material-symbols/palette-outline'
import IconDataObjectRounded from '~icons/material-symbols/data-object-rounded'
import IconLockOutline from '~icons/material-symbols/lock-outline'
import IconDonutLargeRounded from '~icons/material-symbols/donut-large-rounded'
import IconMemoryRounded from '~icons/material-symbols/memory-rounded'
import IconMemoryAltOutlineRounded from '~icons/material-symbols/memory-alt-outline-rounded'
import IconCodeRounded from '~icons/material-symbols/code-rounded'
import IconFullscreenRounded from '~icons/material-symbols/fullscreen-rounded'
import IconSettingsOutlineRounded from '~icons/material-symbols/settings-outline-rounded'
import IconShieldPersonOutlineRounded from '~icons/material-symbols/shield-person-outline-rounded'
import IconAdminPanelSettingsOutlineRounded from '~icons/material-symbols/admin-panel-settings-outline-rounded'
import IconKeyOutlineRounded from '~icons/material-symbols/key-outline-rounded'
import IconSystemUpdateAltRounded from '~icons/material-symbols/system-update-alt-rounded'
import IconKeyboardOutlineRounded from '~icons/material-symbols/keyboard-outline-rounded'
import IconPauseCircleOutlineRounded from '~icons/material-symbols/pause-circle-outline-rounded'
import IconSmartToyOutlineRounded from '~icons/material-symbols/smart-toy-outline-rounded'
import IconFrontHandOutlineRounded from '~icons/material-symbols/front-hand-outline-rounded'
import type { CommandPaletteCommandId } from '../../shared/command-palette.js'

/** The icon drawn beside each command in the command palette. */
export const COMMAND_PALETTE_ICONS: Record<CommandPaletteCommandId, Component> = {
  home: IconSpaceDashboardOutlineRounded,
  'new-tab': IconTabNewRightOutlineRounded,
  'search-tabs': IconTabSearchRounded,
  'switch-workspace': IconWorkspacesOutline,
  downloads: IconDownloadRounded,
  bookmarks: IconBookmarksOutlineRounded,
  history: IconHistoryRounded,
  find: IconFindInPageOutlineRounded,
  reload: IconRefreshRounded,
  'reload-ignoring-cache': IconSyncProblemRounded,
  'capture-area': IconScreenshotRegionRounded,
  'capture-element': IconSelectRounded,
  'capture-viewport': IconScreenshotMonitorOutlineRounded,
  'capture-full-page': IconFullscreenPortraitRounded,
  'copy-snapshot': IconContentCopyOutlineRounded,
  'pick-element': IconArrowSelectorToolOutlineRounded,
  'page-tools': IconConstructionRounded,
  'site-storage': IconDatabaseOutline,
  'responsive-preview': IconDevicesOutlineRounded,
  environment: IconTuneRounded,
  console: IconTerminalRounded,
  network: IconLanOutlineRounded,
  'request-conditions': IconRuleRounded,
  issues: IconReportOutlineRounded,
  'debug-report': IconBugReportOutlineRounded,
  'repro-recorder': IconRadioButtonCheckedOutline,
  'dom-changes': IconDifferenceOutlineRounded,
  'visual-compare': IconCompareRounded,
  'quality-audit': IconFactCheckOutlineRounded,
  accessibility: IconAccessibilityNewRounded,
  performance: IconSpeedOutlineRounded,
  'design-overview': IconPaletteOutline,
  'page-metadata': IconDataObjectRounded,
  security: IconLockOutline,
  coverage: IconDonutLargeRounded,
  'cpu-profile': IconMemoryRounded,
  memory: IconMemoryAltOutlineRounded,
  'developer-tools': IconCodeRounded,
  'full-page-view': IconFullscreenRounded,
  settings: IconSettingsOutlineRounded,
  privacy: IconShieldPersonOutlineRounded,
  'site-permissions': IconAdminPanelSettingsOutlineRounded,
  'mcp-security': IconKeyOutlineRounded,
  updates: IconSystemUpdateAltRounded,
  'keyboard-shortcuts': IconKeyboardOutlineRounded,
  'toggle-mcp-pause': IconPauseCircleOutlineRounded,
  'agent-card': IconSmartToyOutlineRounded,
  'take-over': IconFrontHandOutlineRounded
}
