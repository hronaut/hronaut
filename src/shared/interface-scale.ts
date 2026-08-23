export const INTERFACE_SCALE_OPTIONS = [
  { value: 1, label: 'Compact', description: '100%' },
  { value: 1.1, label: 'Comfortable', description: '110%' },
  { value: 1.25, label: 'Large', description: '125%' }
] as const

export type InterfaceScale = (typeof INTERFACE_SCALE_OPTIONS)[number]['value']

export const DEFAULT_INTERFACE_SCALE: InterfaceScale = 1.1

export function isInterfaceScale(value: unknown): value is InterfaceScale {
  return INTERFACE_SCALE_OPTIONS.some((option) => option.value === value)
}

export function scaleShellMetric(value: number, scale: number): number {
  if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(scale) || scale <= 0) return 0
  return Math.ceil(value * scale)
}
