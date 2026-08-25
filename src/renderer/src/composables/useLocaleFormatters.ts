import type { Ref } from 'vue'
import {
  formatBytes as formatLocalizedBytes,
  formatDateTime as formatLocalizedDateTime,
  formatNumber as formatLocalizedNumber,
  formatPercent as formatLocalizedPercent,
  formatTime as formatLocalizedTime
} from '../../../shared/format.js'
import type { SupportedLocale } from '../../../shared/locale.js'

export function useLocaleFormatters(locale: Readonly<Ref<SupportedLocale>>) {
  function formatBytes(bytes: number): string {
    return formatLocalizedBytes(locale.value, bytes)
  }

  function formatNumber(value: number): string {
    return formatLocalizedNumber(locale.value, value)
  }

  function formatDateTime(value: Date | number | string): string {
    return formatLocalizedDateTime(locale.value, value)
  }

  function formatTime(value: Date | number | string): string {
    return formatLocalizedTime(locale.value, value)
  }

  function formatPercent(percent: number, maximumFractionDigits = 0): string {
    return formatLocalizedPercent(locale.value, percent / 100, { maximumFractionDigits })
  }

  return { formatBytes, formatNumber, formatDateTime, formatTime, formatPercent }
}

export type LocaleFormatters = ReturnType<typeof useLocaleFormatters>
