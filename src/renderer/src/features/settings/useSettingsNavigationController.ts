export interface SettingsNavigationControllerOptions {
  closeSiteControls: () => void
  activeOrigin: () => string | null
  openSiteStorage: () => Promise<void>
  openPrivacySettings: (origin?: string) => Promise<void>
  openSettingsSection: (section: 'permissions' | 'updates') => void
  settingsEntryBlocked: () => boolean
  closeHelp: () => void
  closeTransientCollections: () => void
}

export function useSettingsNavigationController(options: SettingsNavigationControllerOptions) {
  async function openSitePrivacySettings(): Promise<void> {
    options.closeSiteControls()
    await options.openSiteStorage()
  }

  function openSitePermissionSettings(): void {
    options.closeSiteControls()
    options.openSettingsSection('permissions')
  }

  function openUpdateSettings(): void {
    if (options.settingsEntryBlocked()) return
    options.closeHelp()
    options.closeTransientCollections()
    options.openSettingsSection('updates')
  }

  return {
    openSitePrivacySettings,
    openSitePermissionSettings,
    openUpdateSettings
  }
}

