export const BROWSER_TAB_GROUP_COLORS = [
  'gray',
  'blue',
  'cyan',
  'green',
  'yellow',
  'orange',
  'red',
  'pink',
  'purple'
] as const

export type BrowserTabGroupColor = (typeof BROWSER_TAB_GROUP_COLORS)[number]

export const BROWSER_TAB_GROUP_COLOR_HEX: Record<BrowserTabGroupColor, string> = {
  gray: '#7b8190',
  blue: '#4f8bd6',
  cyan: '#2aa198',
  green: '#65a843',
  yellow: '#c59a22',
  orange: '#e08b3e',
  red: '#d85b55',
  pink: '#d45d79',
  purple: '#8b7cf6'
}

export function isBrowserTabGroupColor(value: unknown): value is BrowserTabGroupColor {
  return typeof value === 'string' && (BROWSER_TAB_GROUP_COLORS as readonly string[]).includes(value)
}

export function defaultTabGroupColor(groupId: string): BrowserTabGroupColor {
  let hash = 0
  for (const character of groupId) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0
  return BROWSER_TAB_GROUP_COLORS[Math.abs(hash) % BROWSER_TAB_GROUP_COLORS.length]!
}

export function tabGroupColorLabel(color: BrowserTabGroupColor): string {
  return color[0]!.toLocaleUpperCase() + color.slice(1)
}
