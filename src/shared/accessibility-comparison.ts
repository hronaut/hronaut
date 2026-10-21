import type {
  BrowserAccessibilityAudit,
  BrowserAccessibilityBaselineSummary,
  BrowserAccessibilityComparison,
  BrowserAccessibilityFinding
} from './types.js'

/** Why a comparison with the baseline is limited. The panel names these in the interface language. */
export const ACCESSIBILITY_COMPARISON_CAVEATS = {
  urlChanged: 'The page URL changed after the accessibility baseline.',
  scopeChanged: 'The accessibility standard, selector, or collection limits changed; set a new baseline for this scope.',
  engineChanged: 'The accessibility engine changed; set a new baseline before comparing findings.',
  baselineTruncated: 'The baseline was truncated, so new findings cannot be determined safely.',
  currentTruncated: 'The current audit was truncated, so resolved findings cannot be determined safely.'
} as const

interface IndexedFinding {
  key: string
  finding: BrowserAccessibilityFinding
}

function findings(audit: BrowserAccessibilityAudit): IndexedFinding[] {
  const unique = new Map<string, BrowserAccessibilityFinding>()
  for (const violation of audit.violations) {
    for (const node of violation.nodes) {
      const key = JSON.stringify([violation.id, node.targets])
      if (!unique.has(key)) {
        unique.set(key, {
          ruleId: violation.id,
          impact: violation.impact,
          help: violation.help,
          targets: [...node.targets]
        })
      }
    }
  }
  return [...unique.entries()]
    .map(([key, finding]) => ({ key, finding }))
    .sort((left, right) => left.key.localeCompare(right.key))
}

export function accessibilityBaselineSummary(audit: BrowserAccessibilityAudit): BrowserAccessibilityBaselineSummary {
  return {
    auditedAt: audit.auditedAt,
    url: audit.url,
    standard: audit.standard,
    scope: audit.scope,
    engine: audit.engine,
    violationCount: audit.violationCount,
    visibleFindingCount: findings(audit).length,
    truncated: audit.truncated
  }
}

export function buildAccessibilityComparison(
  baseline: BrowserAccessibilityAudit,
  current: BrowserAccessibilityAudit
): BrowserAccessibilityComparison {
  const sameUrl = baseline.url === current.url
  const sameScope = baseline.standard === current.standard
    && baseline.scope.selector === current.scope.selector
    && baseline.scope.maxViolations === current.scope.maxViolations
    && baseline.scope.maxNodesPerViolation === current.scope.maxNodesPerViolation
  const sameEngine = baseline.engine.name === current.engine.name
    && baseline.engine.version === current.engine.version
  const comparable = sameScope && sameEngine
  const caveats: string[] = []
  if (!sameUrl) caveats.push(ACCESSIBILITY_COMPARISON_CAVEATS.urlChanged)
  if (!sameScope) caveats.push(ACCESSIBILITY_COMPARISON_CAVEATS.scopeChanged)
  if (!sameEngine) caveats.push(ACCESSIBILITY_COMPARISON_CAVEATS.engineChanged)
  if (baseline.truncated) caveats.push(ACCESSIBILITY_COMPARISON_CAVEATS.baselineTruncated)
  if (current.truncated) caveats.push(ACCESSIBILITY_COMPARISON_CAVEATS.currentTruncated)
  if (!comparable) {
    return {
      comparable,
      sameUrl,
      sameScope,
      sameEngine,
      newFindings: null,
      remainingFindings: null,
      resolvedFindings: null,
      caveats
    }
  }
  const before = findings(baseline)
  const after = findings(current)
  const beforeKeys = new Set(before.map(item => item.key))
  const afterKeys = new Set(after.map(item => item.key))
  return {
    comparable,
    sameUrl,
    sameScope,
    sameEngine,
    newFindings: baseline.truncated
      ? null
      : after.filter(item => !beforeKeys.has(item.key)).map(item => item.finding),
    remainingFindings: after.filter(item => beforeKeys.has(item.key)).map(item => item.finding),
    resolvedFindings: current.truncated
      ? null
      : before.filter(item => !afterKeys.has(item.key)).map(item => item.finding),
    caveats
  }
}
