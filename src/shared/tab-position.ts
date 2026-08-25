export const TAB_POSITIONS = ['top', 'left'] as const

export type TabPosition = (typeof TAB_POSITIONS)[number]

export const DEFAULT_TAB_POSITION: TabPosition = 'top'
export const VERTICAL_TAB_RAIL_WIDTH = 280
export const VERTICAL_TAB_RAIL_COLLAPSED_WIDTH = 56

export function isTabPosition(value: unknown): value is TabPosition {
  return typeof value === 'string' && TAB_POSITIONS.includes(value as TabPosition)
}
