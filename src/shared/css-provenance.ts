import { redactDiagnosticText } from './debug-report.js'
import type { BrowserCssProvenance } from './types.js'

export const CSS_INSPECTION_PROPERTIES = [
  'display', 'visibility', 'opacity', 'position', 'z-index', 'width', 'height',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'font-size', 'font-weight', 'line-height', 'color', 'background-color'
] as const
export type CssInspectionProperty = typeof CSS_INSPECTION_PROPERTIES[number]
export const CSS_PROVENANCE_LIMITS = { properties: 8, candidates: 80, scannedRules: 1_000, ancestors: 10, headers: 200, outputBytes: 32_768 } as const

export function normalizeCssProperties(value: unknown): CssInspectionProperty[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length < 1 || value.length > CSS_PROVENANCE_LIMITS.properties
    || value.some(property => !CSS_INSPECTION_PROPERTIES.includes(property as CssInspectionProperty))) {
    throw new TypeError('cssProperties must contain 1 to 8 supported layout or typography property names')
  }
  return [...new Set(value)] as CssInspectionProperty[]
}

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : []
const text = (value: unknown, limit = 300): string => typeof value === 'string' ? redactDiagnosticText(value.slice(0, limit * 2)).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, limit) : ''
const coordinate = (value: unknown): number | undefined => Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 10_000_000 ? Number(value) : undefined

function cssSourceUrl(value: unknown): { url?: string; truncated?: boolean } {
  try {
    if (typeof value !== 'string') return {}
    if (value.length > 8_192) return { truncated: true }
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol)) return {}
    url.username = ''; url.password = ''; url.search = ''; url.hash = ''
    if (url.href.length > 2_048) return { truncated: true }
    return { url: text(url.href, 2_048) }
  } catch { return {} }
}

function cssValue(value: unknown, condition = false): string | null {
  if (typeof value !== 'string' || value.length > 300) return null
  const clean = value.replace(/\/\*[\s\S]*?\*\//g, '').trim()
  if (!clean || (condition ? /[^\w\s#(),.%+*/!:\-]/ : /[^\w\s#(),.%+*/!\-]/).test(clean)
    || /(?:url|attr|var|env|image|paint|element)\s*\(|(?:https?|data|javascript):/i.test(clean)) return null
  return text(clean)
}

export interface CssSourceHeader { url?: string; startLine?: number; startColumn?: number; truncated?: boolean }
export function cssSourceHeader(value: unknown): CssSourceHeader {
  const header = record(value)
  const { url, truncated } = cssSourceUrl(header.sourceURL)
  return { url, ...(truncated ? { truncated: true } : {}), startLine: coordinate(header.startLine), startColumn: coordinate(header.startColumn) }
}

const caveats = [
  'Candidate declarations only: order does not establish a winner or an overridden rule. Inheritance, layers, importance, media, animations and the complete cascade are not resolved.',
  'Top-level document only; selectors do not pierce frames or shadow roots. Ancestor declarations may not inherit for the requested property.',
  'Locations refer to generated stylesheet text, use one-based lines/columns, and are omitted when the stylesheet origin is unknown, unsupported, or too long. No source maps or stylesheet bodies are retrieved.',
  'Only requested properties are included. URL-bearing, quoted, custom-property-dependent, attribute-dependent, invalid and overly long values are omitted. Selectors and permitted CSS are page-authored data and may still contain private information.'
]

export function unavailableCssProvenance(properties: CssInspectionProperty[], reason: string): BrowserCssProvenance {
  return { status: 'unavailable', reason, properties, computed: [], candidates: [], truncated: false, caveats }
}

export function normalizeCssProvenance(input: {
  properties: CssInspectionProperty[]
  matched: unknown
  computed: unknown
  headers: Map<string, CssSourceHeader>
  headersTruncated?: boolean
}): BrowserCssProvenance {
  const requested = new Set(input.properties)
  const result: BrowserCssProvenance = {
    status: 'candidates', properties: input.properties,
    computed: input.properties.map(property => {
      const match = array(record(input.computed).computedStyle).find(item => record(item).name === property)
      return { property, value: cssValue(record(match).value) }
    }),
    candidates: [], truncated: input.headersTruncated === true || [...input.headers.values()].some(header => header.truncated === true), caveats
  }
  let scanned = 0
  const addStyle = (styleValue: unknown, ruleValue: unknown, kind: 'rule' | 'inline' | 'attributes', inheritanceDepth: number, matchingSelectors?: unknown): void => {
    if (++scanned > CSS_PROVENANCE_LIMITS.scannedRules) { result.truncated = true; return }
    const style = record(styleValue), rule = record(ruleValue)
    const header = input.headers.get(String(style.styleSheetId ?? rule.styleSheetId ?? ''))
    const selectors = array(record(rule.selectorList).selectors)
    const indices = array(matchingSelectors)
    const selected = indices.slice(0, 20).filter(index => Number.isInteger(index) && Number(index) >= 0 && Number(index) < selectors.length)
      .map(index => text(record(selectors[Number(index)]).text, 501)).filter(Boolean).join(', ')
    if (indices.length > 20 || selected.length > 500) result.truncated = true
    const selector = kind === 'rule' ? selected.slice(0, 500) : undefined
    const conditions: BrowserCssProvenance['candidates'][number]['conditions'] = []
    for (const type of ['media', 'supports', 'layers', 'containerQueries', 'scopes'] as const) {
      const contexts = array(rule[type])
      if (contexts.length > 4) result.truncated = true
      for (const context of contexts.slice(0, 4)) conditions.push({ type, text: cssValue(record(context).text, true) })
    }
    const seen = new Set<string>()
    const declarations = array(style.cssProperties)
    const signature = (property: Record<string, unknown>): string => JSON.stringify([
      property.name, typeof property.value === 'string' ? property.value.slice(0, 301) : '',
      property.important === true, property.disabled === true
    ])
    const authored = new Set(declarations.slice(0, 1_000).map(record)
      .filter(property => requested.has(property.name as CssInspectionProperty) && property.range).map(signature))
    if (declarations.length > 1_000) result.truncated = true
    for (const item of declarations.slice(0, 1_000)) {
      const property = record(item)
      if (!requested.has(property.name as CssInspectionProperty)) continue
      const key = signature(property)
      // CDP repeats parsed declarations as generated longhands. Keep authored
      // positions, but do not duplicate their locationless mirrors.
      if (!property.range && (authored.has(key) || seen.has(key))) continue
      seen.add(key)
      const range = record(property.range ?? style.range)
      const line = coordinate(range.startLine), column = coordinate(range.startColumn)
      const value = property.parsedOk === false ? null : cssValue(property.value)
      const candidate: BrowserCssProvenance['candidates'][number] = {
        property: property.name as CssInspectionProperty, value,
        ...(value === null ? { valueOmitted: true } : {}),
        kind, inheritanceDepth, important: property.important === true,
        disabled: property.disabled === true,
        ...(selector ? { selector } : {}),
        origin: text(rule.origin, 40) || (kind === 'rule' ? 'unknown' : kind),
        conditions,
        ...(header?.url ? { source: {
          url: header.url,
          ...(line !== undefined && column !== undefined && header.startLine !== undefined && header.startColumn !== undefined ? {
            line: header.startLine + line + 1,
            column: (line === 0 ? header.startColumn : 0) + column + 1,
            precision: property.range ? 'declaration' as const : 'rule' as const
          } : {})
        } } : {})
      }
      if (result.candidates.length >= CSS_PROVENANCE_LIMITS.candidates) { result.truncated = true; return }
      result.candidates.push(candidate)
      if (new TextEncoder().encode(JSON.stringify(result)).byteLength > CSS_PROVENANCE_LIMITS.outputBytes - 100) {
        result.candidates.pop(); result.truncated = true; return
      }
    }
  }
  const matched = record(input.matched)
  const visit = (entry: Record<string, unknown>, depth: number): void => {
    if (entry.inlineStyle) addStyle(entry.inlineStyle, {}, 'inline', depth)
    if (entry.attributesStyle) addStyle(entry.attributesStyle, {}, 'attributes', depth)
    const rules = array(entry.matchedCSSRules)
    if (rules.length > CSS_PROVENANCE_LIMITS.scannedRules) result.truncated = true
    for (const match of rules.slice(0, CSS_PROVENANCE_LIMITS.scannedRules)) {
      if (result.candidates.length >= CSS_PROVENANCE_LIMITS.candidates) { result.truncated = true; break }
      const rule = record(record(match).rule)
      addStyle(rule.style, rule, 'rule', depth, record(match).matchingSelectors)
    }
  }
  visit(matched, 0)
  const inherited = array(matched.inherited)
  if (inherited.length > CSS_PROVENANCE_LIMITS.ancestors) result.truncated = true
  inherited.slice(0, CSS_PROVENANCE_LIMITS.ancestors).forEach((entry, index) => visit(record(entry), index + 1))
  return result
}
