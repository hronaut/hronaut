const rules = new Map<string, Intl.PluralRules>()

/**
 * Which of a message's ` | `-separated forms fits a count, by the locale's plural category. Two forms are one and
 * other, so French takes the first for 0 and 1 and English only for 1. With three, as in Polish, Russian and
 * Ukrainian, they are one, few and many.
 */
export function pluralFormIndex(locale: string, value: number, forms: number): number {
  if (forms <= 1) return 0
  let rule = rules.get(locale)
  if (!rule) rules.set(locale, rule = new Intl.PluralRules(locale))
  const category = rule.select(Math.abs(value))
  if (forms === 2) return category === 'one' ? 0 : 1
  return category === 'one' ? 0 : category === 'few' ? 1 : forms - 1
}
