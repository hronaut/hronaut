import type { Component } from 'vue'
import IconBedtime from '~icons/material-symbols/bedtime-rounded'
import IconContrast from '~icons/material-symbols/contrast-rounded'
import IconDownload from '~icons/material-symbols/download-rounded'
import IconFavorite from '~icons/material-symbols/favorite-rounded'
import IconKey from '~icons/material-symbols/key-rounded'
import IconWallet from '~icons/material-symbols/account-balance-wallet-rounded'
import IconWorkspaces from '~icons/material-symbols/workspaces-rounded'
import IconPrivacy from '~icons/material-symbols/privacy-tip-rounded'
import IconGeneral from '~icons/material-symbols/settings-applications-rounded'
import IconSearch from '~icons/material-symbols/search-rounded'
import IconShieldLock from '~icons/material-symbols/shield-lock-rounded'
import IconSystemUpdate from '~icons/material-symbols/system-update-alt-rounded'
import type { SettingsSection } from './composables/useSettingsDialogController.js'

export interface SettingsNavigationItem {
  section: SettingsSection
  labelKey: string
  descriptionKey: string
  icon: Component
}

/** Settings' sections in the order its sidebar lists them, as Settings and the command palette name them; General comes first, as in other apps. */
export const SETTINGS_NAVIGATION: readonly SettingsNavigationItem[] = [
  { section: 'general', labelKey: 'settings.nav.general', descriptionKey: 'settings.nav.generalDescription', icon: IconGeneral },
  { section: 'appearance', labelKey: 'settings.nav.appearance', descriptionKey: 'settings.nav.appearanceDescription', icon: IconContrast },
  { section: 'search', labelKey: 'settings.nav.search', descriptionKey: 'settings.nav.searchDescription', icon: IconSearch },
  { section: 'downloads', labelKey: 'settings.nav.downloads', descriptionKey: 'settings.nav.downloadsDescription', icon: IconDownload },
  { section: 'performance', labelKey: 'settings.nav.performance', descriptionKey: 'settings.nav.performanceDescription', icon: IconBedtime },
  { section: 'mcp', labelKey: 'settings.nav.mcp', descriptionKey: 'settings.nav.mcpDescription', icon: IconShieldLock },
  { section: 'privacy', labelKey: 'settings.nav.privacy', descriptionKey: 'settings.nav.privacyDescription', icon: IconWorkspaces },
  { section: 'permissions', labelKey: 'settings.nav.permissions', descriptionKey: 'settings.nav.permissionsDescription', icon: IconPrivacy },
  { section: 'credentials', labelKey: 'settings.nav.passwords', descriptionKey: 'settings.nav.passwordsDescription', icon: IconKey },
  { section: 'wallets', labelKey: 'settings.nav.wallets', descriptionKey: 'settings.nav.walletsDescription', icon: IconWallet },
  { section: 'updates', labelKey: 'settings.nav.updates', descriptionKey: 'settings.nav.updatesDescription', icon: IconSystemUpdate },
  { section: 'support', labelKey: 'settings.nav.support', descriptionKey: 'settings.nav.supportDescription', icon: IconFavorite }
]
