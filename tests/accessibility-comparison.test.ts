import { describe, expect, it } from 'vitest'
import { buildAccessibilityComparison } from '../src/shared/accessibility-comparison.js'
import type { BrowserAccessibilityAudit } from '../src/shared/types.js'

function audit(
  violations: Array<{ id: string; targets: string[][] }>,
  overrides: Partial<BrowserAccessibilityAudit> = {}
): BrowserAccessibilityAudit {
  return {
    tabId: 'tab-1',
    url: 'https://example.test/page',
    title: 'Example',
    auditedAt: '2026-09-15T10:00:00.000Z',
    standard: 'wcag-aa',
    scope: { selector: null, maxViolations: 20, maxNodesPerViolation: 3 },
    engine: { name: 'axe-core', version: '4.10.3' },
    violationCount: violations.length,
    affectedNodeCount: violations.reduce((total, violation) => total + violation.targets.length, 0),
    needsReviewCount: 0,
    passedRuleCount: 10,
    truncated: false,
    violations: violations.map(violation => ({
      id: violation.id,
      impact: 'serious',
      help: `Fix ${violation.id}`,
      helpUrl: `https://deque.test/${violation.id}`,
      description: `Description ${violation.id}`,
      nodeCount: violation.targets.length,
      nodes: violation.targets.map(targets => ({ targets, failureSummary: `Failure ${targets.join(' ')}` }))
    })),
    ...overrides,
    action: overrides.action ?? 'measure'
  }
}

describe('accessibility comparison', () => {
  it('classifies stable rule and target fingerprints independent of result order and duplicates', () => {
    const baseline = audit([
      { id: 'button-name', targets: [['button#save'], ['button#cancel']] },
      { id: 'image-alt', targets: [['main', 'img.hero']] }
    ])
    const current = audit([
      { id: 'link-name', targets: [['footer a']] },
      { id: 'button-name', targets: [['button#cancel'], ['button#cancel']] }
    ], { auditedAt: '2026-09-15T10:05:00.000Z' })

    expect(buildAccessibilityComparison(baseline, current)).toMatchObject({
      comparable: true,
      sameUrl: true,
      sameScope: true,
      sameEngine: true,
      newFindings: [{ ruleId: 'link-name', targets: ['footer a'] }],
      remainingFindings: [{ ruleId: 'button-name', targets: ['button#cancel'] }],
      resolvedFindings: [
        { ruleId: 'button-name', targets: ['button#save'] },
        { ruleId: 'image-alt', targets: ['main', 'img.hero'] }
      ]
    })
  })

  it('does not infer new or resolved findings from a truncated side', () => {
    const baseline = audit([{ id: 'button-name', targets: [['button']] }], { truncated: true, violationCount: 4 })
    const current = audit([{ id: 'image-alt', targets: [['img']] }], { truncated: true, violationCount: 3 })

    expect(buildAccessibilityComparison(baseline, current)).toMatchObject({
      comparable: true,
      newFindings: null,
      remainingFindings: [],
      resolvedFindings: null
    })
  })

  it('flags URL drift while retaining a same-scope comparison', () => {
    const baseline = audit([{ id: 'button-name', targets: [['button']] }])
    const current = audit([], { url: 'https://example.test/after' })

    expect(buildAccessibilityComparison(baseline, current)).toMatchObject({
      comparable: true,
      sameUrl: false,
      resolvedFindings: [{ ruleId: 'button-name', targets: ['button'] }]
    })
  })

  it.each([
    ['scope', { standard: 'wcag-aaa' }],
    ['selector', { scope: { selector: '#dialog', maxViolations: 20, maxNodesPerViolation: 3 } }],
    ['collection limit', { scope: { selector: null, maxViolations: 50, maxNodesPerViolation: 3 } }],
    ['engine', { engine: { name: 'axe-core', version: '5.0.0' } }]
  ] as const)('withholds classifications when the audit %s changes', (_label, overrides) => {
    const baseline = audit([{ id: 'button-name', targets: [['button']] }])
    const current = audit([], overrides)

    expect(buildAccessibilityComparison(baseline, current)).toMatchObject({
      comparable: false,
      newFindings: null,
      remainingFindings: null,
      resolvedFindings: null
    })
  })
})
