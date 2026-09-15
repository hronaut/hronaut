import type {
  BrowserAccessibilityAudit,
  BrowserAccessibilityBaselineSummary,
  BrowserAccessibilityComparison,
  BrowserAccessibilityFinding
} from './types.js'

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
  if (!sameUrl) caveats.push('The page URL changed after the accessibility baseline.')
  if (!sameScope) caveats.push('The accessibility standard, selector, or collection limits changed; set a new baseline for this scope.')
  if (!sameEngine) caveats.push('The accessibility engine changed; set a new baseline before comparing findings.')
  if (baseline.truncated) caveats.push('The baseline was truncated, so new findings cannot be determined safely.')
  if (current.truncated) caveats.push('The current audit was truncated, so resolved findings cannot be determined safely.')
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
