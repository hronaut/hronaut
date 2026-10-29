import { app } from 'electron'
import type { SettingsState } from './settings-runtime.js'
import type { MainWindowRefs } from '../windows/main-window.js'
import type { PanelWindowRefs } from '../windows/panel-window.js'
import { resolveLocalePreference, resolveSupportedLocale } from '../../shared/locale.js'
import type { DetachablePanelId, LanguagePreference } from '../../shared/types.js'

interface InterfaceLanguageHost {
  /** The interface language and the system's; index.ts creates the settings record, and most of the main process reads it. */
  state: Pick<SettingsState, 'systemLocale' | 'resolvedLocale'>
  /** Tells both shell windows the settings and the renderer settings state, which carries the interface language. */
  publishSettings(): void
  installApplicationMenu(): void
  setTrayContextMenu(): void
  /** The main window, retitled while it is open. */
  mainWindowRefs: Pick<MainWindowRefs, 'window'>
  /** The detached panel window and the panel it shows, whose title is translated. */
  panelWindowRefs: Pick<PanelWindowRefs, 'window' | 'panel'>
  detachedPanelTitle(panel: DetachablePanelId): string
  /** Reloads a visible Home tab after a committed change, so it shows the new language. */
  refreshHomeAfterCommittedChange(scope: 'mcp' | 'settings'): void
}

/**
 * Changing the interface language while the app runs: resolving the preference, or the operating system's language
 * while it follows the system, and translating the native UI again, from the shell windows and their titles to the
 * application menu, the tray menu and Home.
 */
export function createInterfaceLanguage(host: InterfaceLanguageHost): {
  applyLanguagePreferenceRuntime(preference: LanguagePreference): void
} {
  function applyLanguagePreferenceRuntime(preference: LanguagePreference): void {
    if (preference === 'system') host.state.systemLocale = resolveSupportedLocale(app.getLocale())
    host.state.resolvedLocale = resolveLocalePreference(preference, host.state.systemLocale)
    host.publishSettings()
    host.installApplicationMenu()
    host.setTrayContextMenu()
    host.mainWindowRefs.window?.setTitle('Hronaut')
    if (host.panelWindowRefs.window && !host.panelWindowRefs.window.isDestroyed() && host.panelWindowRefs.panel) {
      host.panelWindowRefs.window.setTitle(host.detachedPanelTitle(host.panelWindowRefs.panel))
    }
    host.refreshHomeAfterCommittedChange('settings')
  }

  return { applyLanguagePreferenceRuntime }
}
