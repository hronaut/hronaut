export const SUPPORTED_LOCALES = ['en-US', 'uk-UA', 'ru-RU', 'de-DE', 'fr-FR', 'es-ES', 'pl-PL'] as const
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]

export const LOCALE_NATIVE_NAMES: Record<SupportedLocale, string> = {
  'en-US': 'English',
  'uk-UA': 'Українська',
  'ru-RU': 'Русский',
  'de-DE': 'Deutsch',
  'fr-FR': 'Français',
  'es-ES': 'Español',
  'pl-PL': 'Polski'
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
  return 'en-US'
}

export function resolveLocalePreference(
  preference: LanguagePreference,
  systemLocale: string
): SupportedLocale {
  return preference === 'system' ? resolveSupportedLocale(systemLocale) : preference
}
