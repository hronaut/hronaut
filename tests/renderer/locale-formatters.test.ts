import { ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { useLocaleFormatters } from '../../src/renderer/src/composables/useLocaleFormatters.js'

describe('locale formatters', () => {
  it('uses the current resolved locale for every invocation', () => {
    const locale = ref<'en-US' | 'de-DE'>('en-US')
    const formatters = useLocaleFormatters(locale)

    expect(formatters.formatNumber(1_234.5)).toBe('1,234.5')
    expect(formatters.formatBytes(1_536)).toBe('1.5 KB')
    expect(formatters.formatPercent(12.34, 1)).toBe('12.3%')

    locale.value = 'de-DE'

    expect(formatters.formatNumber(1_234.5)).toBe('1.234,5')
    expect(formatters.formatBytes(1_536)).toBe('1,5 KB')
    expect(formatters.formatPercent(12.34, 1)).toBe(new Intl.NumberFormat('de-DE', {
      style: 'percent',
      maximumFractionDigits: 1
    }).format(0.1234))
  })

  it('keeps invalid date input readable', () => {
    const formatters = useLocaleFormatters(ref('en-US'))

    expect(formatters.formatDateTime('not-a-date')).toBe('not-a-date')
    expect(formatters.formatTime('not-a-date')).toBe('not-a-date')
  })
})
