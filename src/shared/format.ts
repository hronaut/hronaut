import type { SupportedLocale } from './locale.js'

export function formatNumber(
  locale: SupportedLocale,
  value: number,
  options?: Intl.NumberFormatOptions
): string {
  return new Intl.NumberFormat(locale, options).format(value)
}

export function formatPercent(
  locale: SupportedLocale,
  value: number,
  options: Intl.NumberFormatOptions = {}
): string {
  return formatNumber(locale, value, {
    style: 'percent',
    maximumFractionDigits: 0,
    ...options
  })
}

export function formatBytes(locale: SupportedLocale, bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB'] as const
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** unit
  return `${formatNumber(locale, value, { maximumFractionDigits: value >= 10 || unit === 0 ? 0 : 1 })} ${units[unit]}`
}

export function formatDuration(locale: SupportedLocale, milliseconds: number): string {
  if (!Number.isFinite(milliseconds)) return '—'
  const absolute = Math.abs(milliseconds)
  if (absolute < 1_000) return `${formatNumber(locale, milliseconds, { maximumFractionDigits: 0 })} ms`
  if (absolute < 60_000) return `${formatNumber(locale, milliseconds / 1_000, { maximumFractionDigits: 1 })} s`
  return `${formatNumber(locale, milliseconds / 60_000, { maximumFractionDigits: 1 })} min`
}

export function formatDateTime(
  locale: SupportedLocale,
  value: Date | number | string,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' }
): string {
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.valueOf()) ? String(value) : new Intl.DateTimeFormat(locale, options).format(date)
}

export function formatTime(locale: SupportedLocale, value: Date | number | string): string {
  return formatDateTime(locale, value, { hour: '2-digit', minute: '2-digit' })
}
