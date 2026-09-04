import type { ThemeName } from './types.js'

export type ResolvedThemeName = Exclude<ThemeName, 'system'>

export const THEME_NAMES = [
  'system',
  'light',
  'dark',
  'midnight',
  'sepia',
  'cyberpunk',
  'cyberpunk-turbo',
  'matrix',
  'machine',
  'galactic'
] as const satisfies readonly ThemeName[]

export const RESOLVED_THEME_NAMES = THEME_NAMES.filter(
  (theme): theme is ResolvedThemeName => theme !== 'system'
)

export function isThemeName(value: unknown): value is ThemeName {
  return typeof value === 'string' && (THEME_NAMES as readonly string[]).includes(value)
}

export function isResolvedThemeName(value: unknown): value is ResolvedThemeName {
  return typeof value === 'string' && (RESOLVED_THEME_NAMES as readonly string[]).includes(value)
}

export function themeColorScheme(theme: ResolvedThemeName): 'light' | 'dark' {
  return theme === 'light' || theme === 'sepia' ? 'light' : 'dark'
}

export const CYBERPUNK_TURBO_COLORS = {
  background: '#090f23',
  shellTop: '#15142e',
  toolbar: '#0d1429',
  text: '#f6f3ff',
  muted: '#bbc1d9',
  accent: '#ff69b4',
  secondary: '#53f5e6',
  sunset: '#ffb86b'
} as const
