import type { AxeResults, RunOptions } from 'axe-core'
import type { NormalizedAccessibilityAuditOptions } from './accessibility-audit.js'
import type { BrowserAccessibilityAudit, BrowserAccessibilityImpact } from './types.js'

/** The audit's options as the page gets them: the normalized options with the axe rule tags of the chosen standard. */
export type AccessibilityAuditPageConfig = NormalizedAccessibilityAuditOptions & { runOnly?: { type: 'tag'; values: string[] } }

/** The audit as the page reports it; main adds the tab, the options it ran with, and the baseline. */
export type AccessibilityAuditPageResult = Omit<
  BrowserAccessibilityAudit,
  'tabId' | 'action' | 'standard' | 'scope' | 'baseline' | 'comparison' | 'baselineCleared'
>

type AxePage = typeof globalThis & {
  axe: { run(context: Document | Element, options: RunOptions): Promise<AxeResults>; version: string }
}

/**
 * Runs in the accessibility audit's isolated world after axe-core's own source: audits the document or the selected
 * element and reports a bounded summary of the violations, ordered by impact, with no page markup.
 */
export function accessibilityAuditInPage(config: AccessibilityAuditPageConfig): Promise<AccessibilityAuditPageResult> {
  const page = globalThis as AxePage
  const boundedText = (value: unknown, max: number): string => String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, max)
  const flattenTargets = (target: unknown): string[] => Array.isArray(target)
    ? target.flat(Infinity).filter((value): value is string => typeof value === 'string').slice(0, 8).map((value) => boundedText(value, 500))
    : []
  const context = config.selector ? document.querySelector(config.selector) : document
  if (!context) throw new Error('No element matches the accessibility audit selector')
  const runOptions: RunOptions = {
    resultTypes: ['violations', 'incomplete'],
    selectors: true,
    ancestry: false,
    xpath: false,
    ...(config.runOnly ? { runOnly: config.runOnly } : {})
  }
  return page.axe.run(context, runOptions).then((results) => {
    const impactRank: Record<BrowserAccessibilityImpact, number> = { critical: 0, serious: 1, moderate: 2, minor: 3, unknown: 4 }
    const violations = [...results.violations].sort((left, right) => {
      const leftImpact = left.impact && left.impact in impactRank ? left.impact : 'unknown'
      const rightImpact = right.impact && right.impact in impactRank ? right.impact : 'unknown'
      return impactRank[leftImpact] - impactRank[rightImpact] || left.id.localeCompare(right.id)
    })
    const selected = violations.slice(0, config.maxViolations)
    return {
      url: boundedText(results.url || location.href, 4096),
      title: boundedText(document.title, 500),
      auditedAt: new Date(results.timestamp || Date.now()).toISOString(),
      engine: {
        name: boundedText(results.testEngine?.name || 'axe-core', 100),
        version: boundedText(results.testEngine?.version || page.axe.version, 100)
      },
      violationCount: violations.length,
      affectedNodeCount: violations.reduce((total, violation) => total + violation.nodes.length, 0),
      needsReviewCount: results.incomplete.reduce((total, item) => total + item.nodes.length, 0),
      passedRuleCount: results.passes.length,
      truncated: selected.length < violations.length || selected.some((violation) => violation.nodes.length > config.maxNodesPerViolation),
      violations: selected.map((violation) => ({
        id: boundedText(violation.id, 200),
        impact: violation.impact && violation.impact in impactRank ? violation.impact : 'unknown',
        help: boundedText(violation.help, 500),
        helpUrl: /^https:\/\//.test(violation.helpUrl || '') ? boundedText(violation.helpUrl, 2048) : '',
        description: boundedText(violation.description, 800),
        nodeCount: violation.nodes.length,
        nodes: violation.nodes.slice(0, config.maxNodesPerViolation).map((node) => ({
          targets: flattenTargets(node.target),
          failureSummary: boundedText(node.failureSummary, 1200)
        }))
      }))
    }
  })
}
