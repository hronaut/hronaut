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
  background: '#12121e',
  shellTop: '#1a1a2e',
  toolbar: '#141424',
  text: '#f2f3f8',
  muted: '#b6c9dc',
  accent: '#ff4de3',
  secondary: '#00ffff',
  highlight: '#ffe45e'
} as const
