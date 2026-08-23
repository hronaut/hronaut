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
    ...(selector ? { selector } : {}),
    standard,
    maxViolations,
    maxNodesPerViolation
  }
}

export function accessibilityAuditPageScript(
  axeSource: string,
  options: NormalizedAccessibilityAuditOptions
): string {
  const runOnly = options.standard === 'all'
    ? undefined
    : { type: 'tag', values: STANDARD_TAGS[options.standard] }
  const config = JSON.stringify({ ...options, runOnly })
  return `(() => {
    ${axeSource}
    const config = ${config};
    const boundedText = (value, max) => String(value ?? '').replace(/[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f]/g, '').slice(0, max);
    const flattenTargets = (target) => Array.isArray(target)
      ? target.flat(Infinity).filter((value) => typeof value === 'string').slice(0, 8).map((value) => boundedText(value, 500))
      : [];
    const context = config.selector ? document.querySelector(config.selector) : document;
    if (!context) throw new Error('No element matches the accessibility audit selector');
    const runOptions = {
      resultTypes: ['violations', 'incomplete'],
      selectors: true,
      ancestry: false,
      xpath: false,
      ...(config.runOnly ? { runOnly: config.runOnly } : {})
    };
    return globalThis.axe.run(context, runOptions).then((results) => {
      const impactRank = { critical: 0, serious: 1, moderate: 2, minor: 3, unknown: 4 };
      const violations = [...results.violations].sort((left, right) => {
        const leftImpact = left.impact && left.impact in impactRank ? left.impact : 'unknown';
        const rightImpact = right.impact && right.impact in impactRank ? right.impact : 'unknown';
        return impactRank[leftImpact] - impactRank[rightImpact] || left.id.localeCompare(right.id);
      });
      const selected = violations.slice(0, config.maxViolations);
      return {
        url: boundedText(results.url || location.href, 4096),
        title: boundedText(document.title, 500),
        auditedAt: new Date(results.timestamp || Date.now()).toISOString(),
        engine: {
          name: boundedText(results.testEngine?.name || 'axe-core', 100),
          version: boundedText(results.testEngine?.version || globalThis.axe.version, 100)
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
          helpUrl: /^https:\\/\\//.test(violation.helpUrl || '') ? boundedText(violation.helpUrl, 2048) : '',
          description: boundedText(violation.description, 800),
          nodeCount: violation.nodes.length,
          nodes: violation.nodes.slice(0, config.maxNodesPerViolation).map((node) => ({
            targets: flattenTargets(node.target),
            failureSummary: boundedText(node.failureSummary, 1200)
          }))
        }))
      };
    });
  })()`
}
