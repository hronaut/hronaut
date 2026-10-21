import type { InterfaceScale } from './interface-scale.js'
import type { TabPosition } from './tab-position.js'
import { CYBERPUNK_TURBO_COLORS, type ResolvedThemeName } from './theme.js'

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

/** AltGr shares the right Alt key on many layouts, where it types characters; it never counts as Alt here. */
function isAltKey(input: MenuToggleInput): boolean {
  return input.key !== 'AltGraph' && (input.key === 'Alt' || input.code === 'AltLeft' || input.code === 'AltRight')
}

export function isAutoHideMenuToggleInput(
  platform: DesktopWindowPlatform,
  input: MenuToggleInput
): boolean {
  return platform !== 'darwin'
    && (input.type === 'keyDown' || input.type === 'rawKeyDown')
    && isAltKey(input)
    && !input.control
    && !input.meta
    && !input.shift
}

export type AutoHideMenuGesture = ((input: MenuToggleInput & { isAutoRepeat?: boolean }) => 'suppress' | 'toggle' | undefined) & {
  /** Forgets a pending Alt press, for a click or a window that lost focus or moved while Alt was down. */
  reset: () => void
}

/**
 * Alt alone shows the auto-hidden menu when it is released, as native auto-hide menus do, so Alt held with another key
 * stays a shortcut. The press goes on to the window: Chromium drops the release of a key press held back in
 * `before-input-event`, so holding it back would leave nothing to show the menu on. Every Alt release is held back
 * instead, so the native auto-hide menu and the system menu never act on it as well. Anything else done with Alt
 * down, such as a click, an Alt-drag of the window or switching away from it, should call `reset`.
 */
export function createAutoHideMenuGesture(platform: DesktopWindowPlatform): AutoHideMenuGesture {
  let armed = false
  const gesture = (input: MenuToggleInput & { isAutoRepeat?: boolean }): 'suppress' | 'toggle' | undefined => {
    if (platform === 'darwin') return undefined
    if (input.type === 'keyDown' || input.type === 'rawKeyDown') {
      if (isAutoHideMenuToggleInput(platform, input)) {
        if (!input.isAutoRepeat) armed = true
      } else {
        armed = false
      }
      return undefined
    }
    if (input.type !== 'keyUp' || !isAltKey(input)) return undefined
    const toggle = armed
    armed = false
    return toggle ? 'toggle' : 'suppress'
  }
  return Object.assign(gesture, { reset: () => { armed = false } })
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

/**
 * The window controls sit on the tab strip's surface (`--shell-top`) with tabs
 * above the page, and on the rail's surface (`--shell-bottom`), which the
 * toolbar shares, beside the tab rail.
 */
const TITLE_BAR_THEME_COLORS: Record<ResolvedThemeName, TitleBarThemeColors> = {
  light: { horizontal: '#ededef', vertical: '#f7f7f8', symbols: '#25262b' },
  dark: { horizontal: '#202023', vertical: '#1c1c1f', symbols: '#ededf0' },
  midnight: { horizontal: '#111f32', vertical: '#0b1422', symbols: '#edf4ff' },
  sepia: { horizontal: '#e8dcc8', vertical: '#f4ecdf', symbols: '#3c3025' },
  'cyberpunk-turbo': { horizontal: CYBERPUNK_TURBO_COLORS.shellTop, vertical: CYBERPUNK_TURBO_COLORS.background, symbols: CYBERPUNK_TURBO_COLORS.text },
  cyberpunk: { horizontal: '#1d0a32', vertical: '#0a0414', symbols: '#f5f0ff' },
  matrix: { horizontal: '#07160b', vertical: '#020b05', symbols: '#d9ffe0' },
  machine: { horizontal: '#251012', vertical: '#13080a', symbols: '#fff0ee' },
  galactic: { horizontal: '#111b3a', vertical: '#070d20', symbols: '#f3f5ff' }
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

/** A translucent dialog backdrop, as the renderer computes it. */
export interface ScrimColor {
  red: number
  green: number
  blue: number
  alpha: number
}

/** Accepts only a translucent `rgb()` or `rgba()` color, as `getComputedStyle` reports a dialog backdrop. */
export function parseScrimColor(value: unknown): ScrimColor | null {
  if (typeof value !== 'string' || value.length > 64) return null
  const match = /^rgba?\(\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*(?:[,/]\s*(\d*\.?\d+)\s*)?\)$/u.exec(value.trim())
  if (!match) return null
  const [red, green, blue] = [match[1], match[2], match[3]].map(Number) as [number, number, number]
  const alpha = match[4] === undefined ? 1 : Number(match[4])
  if (red > 255 || green > 255 || blue > 255 || !(alpha > 0 && alpha < 1)) return null
  return { red, green, blue, alpha }
}

function blendHex(color: string, scrim: ScrimColor): string {
  const channels = [1, 3, 5].map((index) => Number.parseInt(color.slice(index, index + 2), 16))
  const blended = channels.map((channel, index) => {
    const over = [scrim.red, scrim.green, scrim.blue][index]!
    return Math.round(channel * (1 - scrim.alpha) + over * scrim.alpha)
  })
  return `#${blended.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
}

/**
 * The native window controls sit above the page and the shell, so a dialog's
 * backdrop cannot cover them; lay the same backdrop over their colors instead.
 */
export function dimTitleBarOverlay(style: TitleBarOverlayStyle, scrim: ScrimColor | null): TitleBarOverlayStyle {
  if (!scrim || !/^#[0-9a-f]{6}$/iu.test(style.color) || !/^#[0-9a-f]{6}$/iu.test(style.symbolColor)) return style
  return { ...style, color: blendHex(style.color, scrim), symbolColor: blendHex(style.symbolColor, scrim) }
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
