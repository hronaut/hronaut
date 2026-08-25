import { DEFAULT_INTERFACE_SCALE } from '../../../shared/interface-scale.js'
import type { SettingsSection } from './useSettingsDialogController.js'

type ResetResult = boolean | void | Promise<boolean | void>

export interface SettingsSectionResetControllerOptions {
  setTheme: (theme: 'system') => Promise<unknown>
  setInterfaceScale: (scale: typeof DEFAULT_INTERFACE_SCALE) => Promise<unknown>
  setTabPosition: (position: 'top') => Promise<unknown>
  setHideInTray: (enabled: true) => Promise<unknown>
  setAttentionSound: (enabled: true) => Promise<unknown>
  setAttentionSoundCue: (cue: 'warning') => Promise<unknown>
  setLanguagePreference: (preference: 'system') => Promise<unknown>
  resetSearch: () => ResetResult
  resetDownloads: () => ResetResult
  resetPerformance: () => ResetResult
  resetPrivacySelection: () => ResetResult
  clearSitePermissions: () => ResetResult
  resetMcp: () => ResetResult
  resetUpdates: () => ResetResult
}

export function useSettingsSectionResetController(options: SettingsSectionResetControllerOptions) {
  async function resetAppearance(): Promise<true> {
    await options.setTheme('system')
    await options.setInterfaceScale(DEFAULT_INTERFACE_SCALE)
    await options.setTabPosition('top')
    await options.setHideInTray(true)
    await options.setAttentionSound(true)
    await options.setAttentionSoundCue('warning')
    // Apply language last so the rest of a reset is not relabeled midway through.
    await options.setLanguagePreference('system')
    return true
  }

  function reset(section: SettingsSection): ResetResult {
    if (section === 'appearance') return resetAppearance()
    if (section === 'search') return options.resetSearch()
    if (section === 'downloads') return options.resetDownloads()
    if (section === 'performance') return options.resetPerformance()
    if (section === 'privacy') return options.resetPrivacySelection()
    if (section === 'permissions') return options.clearSitePermissions()
    if (section === 'mcp') return options.resetMcp()
    if (section === 'updates') return options.resetUpdates()
    return false
  }

  return { reset }
}

export type SettingsSectionResetController = ReturnType<typeof useSettingsSectionResetController>
