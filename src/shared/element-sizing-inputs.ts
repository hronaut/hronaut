export const SIZING_INPUT_PROPERTIES = ['flex-basis', 'flex-grow', 'flex-shrink', 'min-width', 'max-width', 'min-height', 'max-height', 'align-self'] as const
export type SizingInputProperty = typeof SIZING_INPUT_PROPERTIES[number]
export type BrowserSizingInputs = Record<SizingInputProperty, string | number | null>

// Also serialized into the isolated world: keep this parser self-contained.
export function sizingInputValue(property: string, value: unknown): string | number | null {
  if (typeof value !== 'string' || value.length > 64) return null
  if (property === 'flex-grow' || property === 'flex-shrink') {
    if (!/^(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)(?:e[+-]?[0-9]+)?$/.test(value)) return null
    const number = Number(value)
    return Number.isFinite(number) && number >= 0 && number <= 1_000_000_000 ? number : null
  }
  if (property === 'align-self') return ['auto', 'normal', 'stretch', 'center', 'start', 'end', 'self-start', 'self-end', 'flex-start', 'flex-end', 'baseline', 'first baseline', 'last baseline', 'safe center', 'unsafe center'].includes(value) ? value : null
  const keywords = property === 'flex-basis' ? ['auto', 'content', 'min-content', 'max-content', 'fit-content']
    : property.startsWith('min-') ? ['auto', 'min-content', 'max-content', 'fit-content', 'stretch'] : ['none', 'min-content', 'max-content', 'fit-content', 'stretch']
  if (keywords.includes(value)) return value
  const match = /^(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)(px|%)$/.exec(value)
  return match && Number(value.slice(0, -match[1]!.length)) <= 1_000_000_000 ? value : null
}

export function normalizeSizingInputs(raw: unknown): BrowserSizingInputs {
  const object = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
  return Object.fromEntries(SIZING_INPUT_PROPERTIES.map(property => {
    const value = object[property]
    return [property, sizingInputValue(property, typeof value === 'number' && (property === 'flex-grow' || property === 'flex-shrink') ? String(value) : value)]
  })) as BrowserSizingInputs
}
