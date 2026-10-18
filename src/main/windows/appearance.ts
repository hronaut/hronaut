import { nativeTheme } from 'electron'
import type { ToastOverlay } from '../toast-overlay.js'
import type { AddressSuggestionOverlay } from './address-suggestion-overlay.js'
import type { MainWindowRefs } from './main-window.js'
import type { PanelWindowRefs } from './panel-window.js'
import { CYBERPUNK_TURBO_COLORS, themeColorScheme, type ResolvedThemeName } from '../../shared/theme.js'
import type { AppSettings, RendererSettingsState, ThemeName } from '../../shared/types.js'

/** Each theme's window background, which the main and panel windows show before and behind the shell. */
export const THEME_BACKGROUND: Record<ResolvedThemeName, string> = {
  light: '#f7f7fb',
  dark: '#171821',
  midnight: '#0b1422',
  sepia: '#f2eadc',
  cyberpunk: '#10071c',
  'cyberpunk-turbo': CYBERPUNK_TURBO_COLORS.background,
  matrix: '#020b05',
  machine: '#13080a',
  galactic: '#070d20'
}

/** The theme a setting shows: the system's light or dark appearance while it follows the system. */
export function resolvedTheme(theme: ThemeName): Exclude<ThemeName, 'system'> {
  return theme === 'system' ? (nativeTheme.shouldUseDarkColors ? 'dark' : 'light') : theme
}

interface WindowAppearanceHost {
  /** The main window, read on every use because it opens after startup and goes when it closes. */
  mainWindowRefs: Pick<MainWindowRefs, 'window'>
  /** The detached panel window, read on every use because it opens and closes with the panel. */
  panelWindowRefs: Pick<PanelWindowRefs, 'window'>
  /** The current settings; read on every use because each committed update replaces them. */
  settings(): Pick<AppSettings, 'theme'>
  /** Paints the main window's material or background for the current theme. */
  applyMainWindowBackground(): void
  /** Colors the native window controls laid over the main window's title bar for the current theme and scale. */
  applyMainWindowTitleBarOverlay(): void
  /** The address suggestions view, which follows the interface scale. */
  addressSuggestionOverlay: Pick<AddressSuggestionOverlay, 'setZoomFactor'>
  /** The toast view, which sits at the bottom of the page area and moves when the scale changes it. */
  toastOverlay: Pick<ToastOverlay, 'relayout'>
  sendToShellWindows(channel: string, ...args: unknown[]): void
  currentRendererSettingsState(): RendererSettingsState
}

/**
 * How both shell windows look: the theme's native color scheme and window background, the interface scale of the
 * windows and their overlay views, and following the system's appearance while the theme does.
 */
export function createWindowAppearance(host: WindowAppearanceHost): {
  applyTheme(theme: ThemeName): void
  applyInterfaceScale(scale: AppSettings['interfaceScale']): void
  followSystemTheme(): void
} {
  function applyTheme(theme: ThemeName): void {
    nativeTheme.themeSource = theme === 'system' ? 'system' : themeColorScheme(theme)
    host.applyMainWindowBackground()
    host.panelWindowRefs.window?.setBackgroundColor(THEME_BACKGROUND[resolvedTheme(theme)])
    host.applyMainWindowTitleBarOverlay()
  }

  function applyInterfaceScale(scale: AppSettings['interfaceScale']): void {
    for (const window of [host.mainWindowRefs.window, host.panelWindowRefs.window]) {
      if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) {
        window.webContents.setZoomFactor(scale)
      }
    }
    host.addressSuggestionOverlay.setZoomFactor(scale)
    host.applyMainWindowTitleBarOverlay()
    host.toastOverlay.relayout()
  }

  /** Repaints both windows and tells both shells when the system's appearance changes; startup calls it once. */
  function followSystemTheme(): void {
    nativeTheme.on('updated', () => {
      const systemTheme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
      if (host.settings().theme === 'system') {
        host.panelWindowRefs.window?.setBackgroundColor(THEME_BACKGROUND[systemTheme])
        host.applyMainWindowTitleBarOverlay()
      }
      // The system theme, reduced transparency or a high-contrast mode can each bring the material or take it away.
      host.applyMainWindowBackground()
      host.sendToShellWindows('settings:system-theme-changed', systemTheme)
      host.sendToShellWindows('settings:renderer-state-changed', host.currentRendererSettingsState())
    })
  }

  return { applyTheme, applyInterfaceScale, followSystemTheme }
}
