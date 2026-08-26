import type { InterfaceScale } from './interface-scale.js'
import type { TabPosition } from './tab-position.js'
import type { ResolvedThemeName } from './theme.js'

export const TITLE_BAR_BASE_HEIGHT = 44

export type WindowChromeMode = 'overlay' | 'system'
export type DesktopWindowPlatform = 'linux' | 'win32' | 'darwin'

interface MenuToggleInput {
  type: string
  key: string
  code?: string
  control?: boolean
  meta?: boolean
  shift?: boolean
}

export function isAutoHideMenuToggleInput(
  platform: DesktopWindowPlatform,
  input: MenuToggleInput
): boolean {
  return platform !== 'darwin'
    && (input.type === 'keyDown' || input.type === 'rawKeyDown')
    && (input.key === 'Alt' || input.code === 'AltLeft' || input.code === 'AltRight')
    && !input.control
    && !input.meta
    && !input.shift
}

export interface TitleBarOverlayStyle {
  color: string
  symbolColor: string
  height: number
}

interface TitleBarThemeColors {
  horizontal: string
  vertical: string
  symbols: string
}

const TITLE_BAR_THEME_COLORS: Record<ResolvedThemeName, TitleBarThemeColors> = {
  light: { horizontal: '#eeedf7', vertical: '#ffffff', symbols: '#252432' },
  dark: { horizontal: '#20212c', vertical: '#171821', symbols: '#eeeef5' },
  midnight: { horizontal: '#111f32', vertical: '#0a1320', symbols: '#edf4ff' },
  sepia: { horizontal: '#e8dcc8', vertical: '#faf4e9', symbols: '#3c3025' },
  cyberpunk: { horizontal: '#1d0a32', vertical: '#130922', symbols: '#f5f0ff' },
  matrix: { horizontal: '#07160b', vertical: '#030d06', symbols: '#d9ffe0' },
  machine: { horizontal: '#251012', vertical: '#16090b', symbols: '#fff0ee' },
  galactic: { horizontal: '#111b3a', vertical: '#080e23', symbols: '#f3f5ff' }
}

export function titleBarOverlayStyle(
  theme: ResolvedThemeName,
  tabPosition: TabPosition,
  interfaceScale: InterfaceScale
): TitleBarOverlayStyle {
  const colors = TITLE_BAR_THEME_COLORS[theme]
  return {
    color: tabPosition === 'left' ? colors.vertical : colors.horizontal,
    symbolColor: colors.symbols,
    height: Math.round(TITLE_BAR_BASE_HEIGHT * interfaceScale)
  }
}

export interface MainWindowChromeOptions {
  titleBarStyle?: 'hidden'
  titleBarOverlay?: Pick<TitleBarOverlayStyle, 'height'> | TitleBarOverlayStyle
  autoHideMenuBar?: boolean
}

interface MainWindowChromeOptionsInput {
  platform: DesktopWindowPlatform
  useSystemTitleBar: boolean
  theme: ResolvedThemeName
  tabPosition: TabPosition
  interfaceScale: InterfaceScale
}

export function mainWindowChromeOptions(input: MainWindowChromeOptionsInput): MainWindowChromeOptions {
  const autoHideMenuBar = input.platform === 'darwin' ? undefined : true
  if (input.useSystemTitleBar) return { autoHideMenuBar }
  const overlay = titleBarOverlayStyle(input.theme, input.tabPosition, input.interfaceScale)
  return {
    titleBarStyle: 'hidden',
    titleBarOverlay: input.platform === 'darwin' ? { height: overlay.height } : overlay,
    autoHideMenuBar
  }
}

export interface WindowControlsOverlayRect {
  x: number
  y: number
  width: number
  height: number
}

export interface NormalizedTitleBarArea {
  x: number
  width: number
  height: number
  leftInset: number
  rightInset: number
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback
}

export function normalizeTitleBarArea(
  rect: WindowControlsOverlayRect,
  viewportWidth: number
): NormalizedTitleBarArea {
  const boundedViewportWidth = Math.max(0, finiteOr(viewportWidth, 0))
  const x = Math.min(boundedViewportWidth, Math.max(0, finiteOr(rect.x, 0)))
  const width = Math.min(
    boundedViewportWidth - x,
    Math.max(0, finiteOr(rect.width, boundedViewportWidth - x))
  )
  const height = Math.max(TITLE_BAR_BASE_HEIGHT, finiteOr(rect.height, TITLE_BAR_BASE_HEIGHT))
  return {
    x,
    width,
    height,
    leftInset: x,
    rightInset: Math.max(0, boundedViewportWidth - x - width)
  }
}
