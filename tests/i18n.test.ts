import { baseCompile, type CompileError } from '@intlify/message-compiler'
import { describe, expect, it } from 'vitest'
import {
  formatBytes,
  formatDateTime,
  formatDuration,
  formatNumber,
  formatPercent,
  formatTime
} from '../src/shared/format.js'
import { localeMessages, translate, type MessageKey } from '../src/shared/i18n.js'
import {
  isLanguagePreference,
  isSupportedLocale,
  resolveLocalePreference,
  resolveSupportedLocale
} from '../src/shared/locale.js'

function flattenMessages(value: unknown, prefix = ''): Map<string, string> {
  const entries = new Map<string, string>()
  if (!value || typeof value !== 'object' || Array.isArray(value)) return entries
  for (const [name, child] of Object.entries(value)) {
    const key = prefix ? `${prefix}.${name}` : name
    if (typeof child === 'string') entries.set(key, child)
    else for (const [childKey, message] of flattenMessages(child, key)) entries.set(childKey, message)
  }
  return entries
}

function placeholderNames(message: string): string[] {
  return [...new Set([...message.matchAll(/\{([\w]+)\}/g)].map((match) => match[1]!))].sort()
}

describe('locale resolution', () => {
  it.each([
    ['uk', 'uk-UA'], ['uk-UA', 'uk-UA'], ['uk_UA', 'uk-UA'], ['uk-CA', 'uk-UA'],
    ['en', 'en-US'], ['en-GB', 'en-US'], ['ru', 'ru-RU'], ['de-AT', 'de-DE'],
    ['fr-CA', 'fr-FR'], ['es-MX', 'es-ES'], ['pl', 'pl-PL'], ['ja-JP', 'en-US'], ['', 'en-US']
  ] as const)('normalizes %s to %s', (input, expected) => {
    expect(resolveSupportedLocale(input)).toBe(expected)
  })

  it('keeps explicit preferences authoritative and resolves system on demand', () => {
    expect(resolveLocalePreference('en-US', 'uk-UA')).toBe('en-US')
    expect(resolveLocalePreference('uk-UA', 'en-US')).toBe('uk-UA')
    expect(resolveLocalePreference('system', 'uk-UA')).toBe('uk-UA')
    expect(resolveLocalePreference('system', 'ja-JP')).toBe('en-US')
  })

  it('rejects malformed preferences and resolved locales', () => {
    expect(isLanguagePreference('system')).toBe(true)
    expect(isLanguagePreference('uk-UA')).toBe(true)
    expect(isLanguagePreference('uk')).toBe(false)
    expect(isLanguagePreference(null)).toBe(false)
    expect(isSupportedLocale('en-US')).toBe(true)
    expect(isSupportedLocale('system')).toBe(false)
  })
})

describe('locale catalogs', () => {
  const english = flattenMessages(localeMessages['en-US'])

  it('has exact key parity', () => {
    for (const catalog of Object.values(localeMessages)) {
      expect([...flattenMessages(catalog).keys()].sort()).toEqual([...english.keys()].sort())
    }
  })

  it.each(Object.entries(localeMessages))('compiles every %s message', (_locale, catalog) => {
    const failures: Array<{ key: string; errors: CompileError[] }> = []
    for (const [key, message] of flattenMessages(catalog)) {
      const errors: CompileError[] = []
      baseCompile(message, { onError: (error) => errors.push(error) })
      if (errors.length) failures.push({ key, errors })
    }
    expect(failures).toEqual([])
  })

  it('preserves named placeholders in every complete catalog', () => {
    for (const [locale, catalog] of Object.entries(localeMessages)) {
      if (locale === 'en-US') continue
      for (const [key, message] of flattenMessages(catalog)) {
        expect(placeholderNames(message), `${locale}:${key}`).toEqual(placeholderNames(english.get(key) ?? ''))
      }
    }
  })

  it.each(['ru-RU', 'de-DE', 'fr-FR', 'es-ES', 'pl-PL'] as const)(
    'does not fall back to English across deep %s surfaces',
    (locale) => {
      for (const key of [
        'native.dialog.permissionRequest',
        'native.context.closeDuplicates',
        'home.activity.privacy',
        'settings.privacy.exclusions',
        'pageMetadata.caveats.rendered',
        'designOverview.caveats.bounded',
        'securityReport.caveats.trust',
        'memory.allocation.caveats.retained',
        'network.details.safety',
        'siteStorage.trackedChanges.emptyDescription'
      ] as MessageKey[]) {
        expect(translate(locale, key), `${locale}:${key}`).not.toBe(translate('en-US', key))
      }
    }
  )

  it('renders both languages with named interpolation', () => {
    expect(translate('en-US', 'updates.status.available', { version: '2.0.0' })).toBe('Hronaut 2.0.0 is available')
    expect(translate('uk-UA', 'updates.status.available', { version: '2.0.0' })).toBe('Доступний Hronaut 2.0.0')
  })

  it('localizes diagnostic-panel chrome and stable report explanations', () => {
    expect(translate('uk-UA', 'designOverview.heading')).toBe('Огляд дизайну')
    expect(translate('uk-UA', 'pageMetadata.issues.missingTitle.message')).toBe('Додайте стислий описовий елемент title.')
    expect(translate('uk-UA', 'securityReport.noCertificate')).toBe('Відомості сертифіката TLS недоступні')
    expect(translate('uk-UA', 'coverage.emptyHeading')).toBe('Знайдіть невикористані JavaScript і CSS')
    expect(translate('uk-UA', 'cpuProfile.sampledTime')).toBe('Вибраний час')
    expect(translate('uk-UA', 'memory.allocation.heading')).toBe('Знайдіть утримані розподіли за функцією')
    expect(translate('uk-UA', 'console.noMessages')).toBe('Повідомлень консолі ще немає')
    expect(translate('uk-UA', 'network.details.responseSource')).toBe('Джерело відповіді')
    expect(translate('uk-UA', 'issues.empty')).toBe('Проблем браузера не зібрано')
    expect(translate('uk-UA', 'debugReport.heading')).toBe('Звіт налагодження')
    expect(translate('uk-UA', 'repro.heading')).toBe('Запис відтворення')
    expect(translate('uk-UA', 'domChanges.heading')).toBe('Зміни DOM')
    expect(translate('uk-UA', 'visualCompare.heading')).toBe('Візуальне порівняння')
    expect(translate('uk-UA', 'tabSearch.heading')).toBe('Вкладки')
    expect(translate('uk-UA', 'siteStorage.heading', { host: 'example.test' })).toContain('example.test')
    expect(translate('uk-UA', 'commandCatalog.commands.network.label')).toBe('Відкрити монітор мережі')
    expect(translate('uk-UA', 'runtime.shortcuts.address')).toBe('Перейти до адресного рядка')
    expect(translate('uk-UA', 'designOverview.caveats.bounded')).not.toBe(translate('en-US', 'designOverview.caveats.bounded'))
    expect(translate('uk-UA', 'pageMetadata.caveats.rendered')).not.toBe(translate('en-US', 'pageMetadata.caveats.rendered'))
    expect(translate('uk-UA', 'securityReport.caveats.trust')).not.toBe(translate('en-US', 'securityReport.caveats.trust'))
    expect(translate('uk-UA', 'cpuProfile.caveats.sampled')).not.toBe(translate('en-US', 'cpuProfile.caveats.sampled'))
    expect(translate('uk-UA', 'memory.allocation.caveats.retained')).not.toBe(translate('en-US', 'memory.allocation.caveats.retained'))
    expect(translate('uk-UA', 'debugReport.caveats.console')).not.toBe(translate('en-US', 'debugReport.caveats.console'))
    expect(translate('uk-UA', 'domChanges.caveats.structural')).not.toBe(translate('en-US', 'domChanges.caveats.structural'))
    expect(translate('uk-UA', 'visualCompare.caveats.viewport')).not.toBe(translate('en-US', 'visualCompare.caveats.viewport'))
  })

  it.each([
    ['ru-RU', 'Язык интерфейса', 'Поисковая система по умолчанию'],
    ['de-DE', 'Oberflächensprache', 'Standardsuchmaschine'],
    ['fr-FR', 'Langue de l’interface', 'Moteur de recherche par défaut'],
    ['es-ES', 'Idioma de la interfaz', 'Motor de búsqueda predeterminado'],
    ['pl-PL', 'Język interfejsu', 'Domyślna wyszukiwarka']
  ] as const)('renders the %s settings catalog', (locale, label, searchHeading) => {
    expect(translate(locale, 'appearance.language.label')).toBe(label)
    expect(translate(locale, 'settings.search.heading')).toBe(searchHeading)
  })

  it('falls back safely rather than throwing for a missing runtime key', () => {
    expect(translate('uk-UA', 'missing.runtime.key' as MessageKey)).toBe('missing.runtime.key')
  })
})

describe('locale-aware presentation formatting', () => {
  it('formats numbers and percentages by locale', () => {
    expect(formatNumber('en-US', 12_345.6)).toBe('12,345.6')
    expect(formatNumber('uk-UA', 12_345.6)).toMatch(/12[\s\u00a0\u202f]345,6/)
    expect(formatPercent('en-US', 0.125, { maximumFractionDigits: 1 })).toBe('12.5%')
    expect(formatPercent('uk-UA', 0.125, { maximumFractionDigits: 1 })).toMatch(/12,5\s?%/)
  })

  it('formats byte sizes and durations while preserving exact technical units', () => {
    expect(formatBytes('en-US', 1_536)).toBe('1.5 KB')
    expect(formatBytes('uk-UA', 1_536)).toBe('1,5 KB')
    expect(formatDuration('en-US', 1_500)).toBe('1.5 s')
    expect(formatDuration('uk-UA', 1_500)).toBe('1,5 s')
  })

  it('formats dates and times without changing the machine value', () => {
    const value = new Date('2026-08-21T12:34:00.000Z')
    expect(formatDateTime('en-US', value, { timeZone: 'UTC', dateStyle: 'medium' })).toBe('Aug 21, 2026')
    expect(formatDateTime('uk-UA', value, { timeZone: 'UTC', dateStyle: 'medium' })).toContain('2026')
    expect(formatTime('en-US', value)).not.toBe(value.toISOString())
  })
})
