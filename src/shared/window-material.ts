import type { DesktopWindowPlatform, WindowChromeMode } from './title-bar.js'
import type { TabPosition } from './tab-position.js'
import type { ResolvedThemeName } from './theme.js'

/** What the system draws behind the tab rail: macOS vibrancy or Windows 11 Mica. */
export type WindowMaterial = 'vibrancy' | 'mica'

/** Windows draws Mica behind a window's content from Windows 11 22H2 (build 22621). */
export const MICA_MINIMUM_WINDOWS_BUILD = 22621

/** The window's background while a material shows through it. */
export const WINDOW_MATERIAL_BACKGROUND = '#00000000'

export interface WindowMaterialInput {
  platform: DesktopWindowPlatform
  /** `os.release()`: the Darwin version on macOS, `10.0.<build>` on Windows. */
  osRelease: string
  theme: ResolvedThemeName
  tabPosition: TabPosition
  /**
   * The main window's title bar, fixed when the window is created. Windows draws Mica under the page only when the
   * window draws its own title bar; with the system title bar the content stays opaque and a cleared background is black.
   */
  chrome: WindowChromeMode
  /** The system asks for less transparency (macOS Reduce transparency, Windows transparency effects off). */
  reducedTransparency: boolean
  /** A high-contrast, increased-contrast or forced-colors mode is on. */
  forcedColors: boolean
}

function windowsBuild(osRelease: string): number {
  const build = /^10\.0\.(\d+)/u.exec(osRelease)?.[1]
  return build === undefined ? 0 : Number(build)
}

/**
 * The material behind the tab rail of the main window, or null for the theme's solid surface. Only the plain light and
 * dark themes are drawn over a material; the others keep their own colors, and Linux always keeps the solid surface, as
 * does Windows with the system title bar.
 */
export function windowMaterialFor(input: WindowMaterialInput): WindowMaterial | null {
  if (input.tabPosition !== 'left' || input.reducedTransparency || input.forcedColors) return null
  if (input.theme !== 'light' && input.theme !== 'dark') return null
  if (input.platform === 'darwin') return 'vibrancy'
  if (input.platform === 'win32' && input.chrome === 'overlay' && windowsBuild(input.osRelease) >= MICA_MINIMUM_WINDOWS_BUILD) return 'mica'
  return null
}

export interface WindowMaterialOptions {
  vibrancy?: 'sidebar'
  backgroundMaterial?: 'mica'
  backgroundColor?: string
}

/** BrowserWindow options that show a material from the first frame. */
export function windowMaterialOptions(material: WindowMaterial | null): WindowMaterialOptions {
  if (material === 'vibrancy') return { vibrancy: 'sidebar', backgroundColor: WINDOW_MATERIAL_BACKGROUND }
  if (material === 'mica') return { backgroundMaterial: 'mica', backgroundColor: WINDOW_MATERIAL_BACKGROUND }
  return {}
}
