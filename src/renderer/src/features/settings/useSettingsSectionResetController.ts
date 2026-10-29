import type { SettingsSection } from './useSettingsDialogController.js'

type ResetResult = boolean | void | Promise<boolean | void>

export interface SettingsSectionResetControllerOptions {
  resetAppearance: () => ResetResult
  resetGeneral: () => ResetResult
  resetSearch: () => ResetResult
  resetDownloads: () => ResetResult
  resetPerformance: () => ResetResult
  resetPrivacy: () => ResetResult
  clearSitePermissions: () => ResetResult
  resetMcp: () => ResetResult
  resetUpdates: () => ResetResult
}

export function useSettingsSectionResetController(options: SettingsSectionResetControllerOptions) {
  function reset(section: SettingsSection): ResetResult {
    if (section === 'appearance') return options.resetAppearance()
    if (section === 'general') return options.resetGeneral()
    if (section === 'search') return options.resetSearch()
    if (section === 'downloads') return options.resetDownloads()
    if (section === 'performance') return options.resetPerformance()
    if (section === 'privacy') return options.resetPrivacy()
    if (section === 'permissions') return options.clearSitePermissions()
    if (section === 'mcp') return options.resetMcp()
    if (section === 'updates') return options.resetUpdates()
    return false
  }

  return { reset }
}

export type SettingsSectionResetController = ReturnType<typeof useSettingsSectionResetController>
