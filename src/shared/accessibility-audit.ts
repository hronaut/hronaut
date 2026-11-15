import { accessibilityAuditInPage } from './accessibility-audit.page.js'
import { pageScript } from './page-script.js'
import type {
  BrowserAccessibilityAuditOptions,
  BrowserAccessibilityStandard
} from './types.js'

export const ACCESSIBILITY_AUDIT_LIMITS = {
  maxSelectorChars: 1_024,
  maxViolations: 50,
  maxNodesPerViolation: 10
} as const

export interface NormalizedAccessibilityAuditOptions {
  action: 'measure' | 'set-baseline' | 'clear-baseline'
  selector?: string
  standard: BrowserAccessibilityStandard
  maxViolations: number
  maxNodesPerViolation: number
}

const STANDARD_TAGS: Record<Exclude<BrowserAccessibilityStandard, 'all'>, string[]> = {
  'wcag-aa': ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
  'wcag-aaa': ['wcag2a', 'wcag2aa', 'wcag2aaa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
  'best-practice': ['best-practice']
}

export function normalizeAccessibilityAuditOptions(
  options: BrowserAccessibilityAuditOptions = {}
): NormalizedAccessibilityAuditOptions {
  const action = options.action ?? 'measure'
  if (!['measure', 'set-baseline', 'clear-baseline'].includes(action)) {
    throw new Error('Accessibility audit action must be measure, set-baseline, or clear-baseline')
  }
  const selector = options.selector?.trim()
  if (selector && (selector.length > ACCESSIBILITY_AUDIT_LIMITS.maxSelectorChars || /[\u0000-\u001f\u007f]/.test(selector))) {
    throw new Error(`Accessibility audit selector must be at most ${ACCESSIBILITY_AUDIT_LIMITS.maxSelectorChars} characters without control characters`)
  }
  const standard = options.standard ?? 'wcag-aa'
  if (!['wcag-aa', 'wcag-aaa', 'best-practice', 'all'].includes(standard)) {
    throw new Error('Unknown accessibility audit standard')
  }
  const maxViolations = options.maxViolations ?? 20
  if (!Number.isInteger(maxViolations) || maxViolations < 1 || maxViolations > ACCESSIBILITY_AUDIT_LIMITS.maxViolations) {
    throw new Error(`maxViolations must be an integer from 1 to ${ACCESSIBILITY_AUDIT_LIMITS.maxViolations}`)
  }
  const maxNodesPerViolation = options.maxNodesPerViolation ?? 3
  if (
    !Number.isInteger(maxNodesPerViolation)
    || maxNodesPerViolation < 1
    || maxNodesPerViolation > ACCESSIBILITY_AUDIT_LIMITS.maxNodesPerViolation
  ) {
    throw new Error(`maxNodesPerViolation must be an integer from 1 to ${ACCESSIBILITY_AUDIT_LIMITS.maxNodesPerViolation}`)
  }
  return {
    action,
    ...(selector ? { selector } : {}),
    standard,
    maxViolations,
    maxNodesPerViolation
  }
}

/**
 * The isolated-world script that audits the page: axe-core's own source, run in a function of its own as a library
 * rather than a page function, and then the audit with these options.
 */
export function accessibilityAuditPageScript(
  axeSource: string,
  options: NormalizedAccessibilityAuditOptions
): string {
  const runOnly = options.standard === 'all'
    ? undefined
    : { type: 'tag' as const, values: STANDARD_TAGS[options.standard] }
  return `(() => {\n${axeSource}\n})();\n` + pageScript(accessibilityAuditInPage, { ...options, runOnly })
}
