const rules = new Map<string, Intl.PluralRules>()

/**
 * Which of a message's ` | `-separated forms fits a count. Two forms are one and other, as in English. With three,
 * as in Polish, Russian and Ukrainian, they follow the locale's plural categories in the order one, few, many.
 */
export function pluralFormIndex(locale: string, value: number, forms: number): number {
  if (forms <= 1) return 0
  if (forms === 2) return Math.abs(value) === 1 ? 0 : 1
  let rule = rules.get(locale)
  if (!rule) rules.set(locale, rule = new Intl.PluralRules(locale))
  const category = rule.select(value)
  return category === 'one' ? 0 : category === 'few' ? 1 : forms - 1
}
