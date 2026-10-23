/**
 * The open rail over the page lives in a view only as large as the rail, but the stylesheet's viewport rules were
 * written for the shell's window, as one that tightens the rail in a short window. Each `@media` rule that tests only
 * the viewport's width or height is switched on or off to match the shell's viewport instead; any other rule, such as
 * reduced motion or forced colors, follows the view as before.
 */
interface ViewportFeature {
  bound: 'min' | 'max'
  axis: 'width' | 'height'
  value: number
}

interface ViewportRule {
  rule: CSSMediaRule
  /** Alternatives, any of which matches, each a list of features that must all match. */
  query: ViewportFeature[][]
}

const FEATURE = /^\(\s*(min|max)-(width|height)\s*:\s*(\d+(?:\.\d+)?)px\s*\)$/i

/** The query of a rule that tests only viewport width and height in pixels; null for any other rule. */
export function viewportQuery(mediaText: string): ViewportFeature[][] | null {
  const alternatives = mediaText.split(',').map((alternative) => alternative.trim())
  if (!alternatives.length || alternatives.some((alternative) => !alternative)) return null
  const query: ViewportFeature[][] = []
  for (const alternative of alternatives) {
    const features: ViewportFeature[] = []
    for (const part of alternative.split(/\s+and\s+/i)) {
      const match = FEATURE.exec(part.trim())
      if (!match) return null
      features.push({ bound: match[1]!.toLowerCase() as 'min' | 'max', axis: match[2]!.toLowerCase() as 'width' | 'height', value: Number(match[3]) })
    }
    query.push(features)
  }
  return query
}

export function viewportQueryMatches(query: ViewportFeature[][], viewport: { width: number; height: number }): boolean {
  return query.some((features) => features.every((feature) => {
    const size = viewport[feature.axis]
    return feature.bound === 'min' ? size >= feature.value : size <= feature.value
  }))
}

function collect(rules: CSSRuleList, into: ViewportRule[]): void {
  for (const rule of Array.from(rules)) {
    if (rule instanceof CSSMediaRule) {
      const query = viewportQuery(rule.media.mediaText)
      if (query) into.push({ rule, query })
      else collect(rule.cssRules, into)
    } else if (rule instanceof CSSImportRule) {
      if (rule.styleSheet) collect(rule.styleSheet.cssRules, into)
    } else if ('cssRules' in rule && rule.cssRules instanceof CSSRuleList) {
      collect(rule.cssRules, into)
    }
  }
}

/** Binds the document's viewport rules to a viewport of the caller's choosing; call it again whenever that changes. */
export function createShellViewportMedia(root: Document = document): (viewport: { width: number; height: number }) => void {
  const seen = new WeakSet<CSSStyleSheet>()
  const rules: ViewportRule[] = []
  return (viewport) => {
    // A stylesheet that loads later, as a component's, joins the next time.
    for (const sheet of Array.from(root.styleSheets)) {
      if (seen.has(sheet)) continue
      seen.add(sheet)
      try {
        collect(sheet.cssRules, rules)
      } catch {
        // A stylesheet whose rules cannot be read keeps its own queries.
      }
    }
    for (const { rule, query } of rules) {
      const text = viewportQueryMatches(query, viewport) ? 'all' : 'not all'
      if (rule.media.mediaText !== text) rule.media.mediaText = text
    }
  }
}
