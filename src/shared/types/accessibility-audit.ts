export type BrowserAccessibilityStandard = 'wcag-aa' | 'wcag-aaa' | 'best-practice' | 'all'
export type BrowserAccessibilityImpact = 'minor' | 'moderate' | 'serious' | 'critical' | 'unknown'
export type BrowserAccessibilityAuditAction = 'measure' | 'set-baseline' | 'clear-baseline'

export interface BrowserAccessibilityNode {
  targets: string[]
  failureSummary: string
}

export interface BrowserAccessibilityViolation {
  id: string
  impact: BrowserAccessibilityImpact
  help: string
  helpUrl: string
  description: string
  nodeCount: number
  nodes: BrowserAccessibilityNode[]
}

export interface BrowserAccessibilityAuditScope {
  selector: string | null
  maxViolations: number
  maxNodesPerViolation: number
}

export interface BrowserAccessibilityFinding {
  ruleId: string
  impact: BrowserAccessibilityImpact
  help: string
  targets: string[]
}

export interface BrowserAccessibilityBaselineSummary {
  auditedAt: string
  url: string
  standard: BrowserAccessibilityStandard
  scope: BrowserAccessibilityAuditScope
  engine: { name: string; version: string }
  violationCount: number
  visibleFindingCount: number
  truncated: boolean
}

export interface BrowserAccessibilityComparison {
  comparable: boolean
  sameUrl: boolean
  sameScope: boolean
  sameEngine: boolean
  newFindings: BrowserAccessibilityFinding[] | null
  remainingFindings: BrowserAccessibilityFinding[] | null
  resolvedFindings: BrowserAccessibilityFinding[] | null
  caveats: string[]
}

export interface BrowserAccessibilityAudit {
  tabId: string
  url: string
  title: string
  auditedAt: string
  action: BrowserAccessibilityAuditAction
  standard: BrowserAccessibilityStandard
  scope: BrowserAccessibilityAuditScope
  engine: { name: string; version: string }
  violationCount: number
  affectedNodeCount: number
  needsReviewCount: number
  passedRuleCount: number
  truncated: boolean
  violations: BrowserAccessibilityViolation[]
  baseline?: BrowserAccessibilityBaselineSummary
  comparison?: BrowserAccessibilityComparison
  baselineCleared?: boolean
}

export interface BrowserAccessibilityAuditOptions {
  tabId?: string
  action?: BrowserAccessibilityAuditAction
  selector?: string
  standard?: BrowserAccessibilityStandard
  maxViolations?: number
  maxNodesPerViolation?: number
}
