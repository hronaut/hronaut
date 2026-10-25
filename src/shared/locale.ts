export const SUPPORTED_LOCALES = ['en-US', 'uk-UA', 'ru-RU', 'de-DE', 'fr-FR', 'es-ES', 'pl-PL', 'it-IT', 'pt-BR', 'tr-TR', 'hi-IN', 'ja-JP', 'ko-KR', 'zh-CN', 'zh-TW', 'id-ID', 'vi-VN'] as const
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]

export const LOCALE_NATIVE_NAMES: Record<SupportedLocale, string> = {
  'en-US': 'English',
  'uk-UA': 'Українська',
  'ru-RU': 'Русский',
  'de-DE': 'Deutsch',
  'fr-FR': 'Français',
  'es-ES': 'Español',
  'pl-PL': 'Polski',
  'it-IT': 'Italiano',
  'pt-BR': 'Português (Brasil)',
  'tr-TR': 'Türkçe',
  'hi-IN': 'हिन्दी',
  'ja-JP': '日本語',
  'ko-KR': '한국어',
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
  'id-ID': 'Bahasa Indonesia',
  'vi-VN': 'Tiếng Việt'
}

export const LANGUAGE_PREFERENCES = ['system', ...SUPPORTED_LOCALES] as const
export type LanguagePreference = (typeof LANGUAGE_PREFERENCES)[number]

export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return typeof value === 'string' && SUPPORTED_LOCALES.includes(value as SupportedLocale)
}

export function isLanguagePreference(value: unknown): value is LanguagePreference {
  return typeof value === 'string' && LANGUAGE_PREFERENCES.includes(value as LanguagePreference)
}

export function resolveSupportedLocale(systemLocale: string): SupportedLocale {
  const normalized = systemLocale.trim().replace('_', '-').toLowerCase()
  if (normalized === 'uk' || normalized.startsWith('uk-')) return 'uk-UA'
  if (normalized === 'en' || normalized.startsWith('en-')) return 'en-US'
  if (normalized === 'ru' || normalized.startsWith('ru-')) return 'ru-RU'
  if (normalized === 'de' || normalized.startsWith('de-')) return 'de-DE'
  if (normalized === 'fr' || normalized.startsWith('fr-')) return 'fr-FR'
  if (normalized === 'es' || normalized.startsWith('es-')) return 'es-ES'
  if (normalized === 'pl' || normalized.startsWith('pl-')) return 'pl-PL'
  if (normalized === 'it' || normalized.startsWith('it-')) return 'it-IT'
  // Portuguese is Brazilian Portuguese, the only variant Hronaut has.
  if (normalized === 'pt' || normalized.startsWith('pt-')) return 'pt-BR'
  if (normalized === 'tr' || normalized.startsWith('tr-')) return 'tr-TR'
  if (normalized === 'hi' || normalized.startsWith('hi-')) return 'hi-IN'
  if (normalized === 'ja' || normalized.startsWith('ja-')) return 'ja-JP'
  if (normalized === 'ko' || normalized.startsWith('ko-')) return 'ko-KR'
  // Traditional Chinese for Taiwan, Hong Kong, Macau and any locale written in Hant; Simplified for the rest.
  if (normalized === 'zh-tw' || normalized === 'zh-hk' || normalized === 'zh-mo' || normalized.startsWith('zh-hant')
    || /^zh-[a-z]+-(tw|hk|mo)$/.test(normalized)) return 'zh-TW'
  if (normalized === 'zh' || normalized.startsWith('zh-')) return 'zh-CN'
  if (normalized === 'id' || normalized.startsWith('id-')) return 'id-ID'
  if (normalized === 'vi' || normalized.startsWith('vi-')) return 'vi-VN'
  return 'en-US'
}

export function resolveLocalePreference(
  preference: LanguagePreference,
  systemLocale: string
): SupportedLocale {
  return preference === 'system' ? resolveSupportedLocale(systemLocale) : preference
}
