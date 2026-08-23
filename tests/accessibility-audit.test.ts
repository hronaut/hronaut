import { describe, expect, it } from 'vitest'
import {
  ACCESSIBILITY_AUDIT_LIMITS,
  accessibilityAuditPageScript,
  normalizeAccessibilityAuditOptions
} from '../src/shared/accessibility-audit.js'

describe('accessibility audit', () => {
  it('defaults to a bounded WCAG A and AA audit', () => {
    expect(normalizeAccessibilityAuditOptions()).toEqual({
      standard: 'wcag-aa',
      maxViolations: 20,
      maxNodesPerViolation: 3
    })
    const script = accessibilityAuditPageScript('globalThis.axe = { run() {} };', normalizeAccessibilityAuditOptions())
    expect(script).toContain('wcag2a')
    expect(script).toContain('wcag22aa')
    expect(script).toContain("resultTypes: ['violations', 'incomplete']")
    expect(script).not.toContain('outerHTML')
  })

  it('bounds selectors and response detail controls', () => {
    expect(normalizeAccessibilityAuditOptions({
      selector: '  #checkout  ',
      standard: 'best-practice',
      maxViolations: 50,
      maxNodesPerViolation: 10
    })).toEqual({
      selector: '#checkout',
      standard: 'best-practice',
      maxViolations: 50,
      maxNodesPerViolation: 10
    })
    expect(() => normalizeAccessibilityAuditOptions({
      selector: 'x'.repeat(ACCESSIBILITY_AUDIT_LIMITS.maxSelectorChars + 1)
    })).toThrow('selector')
    expect(() => normalizeAccessibilityAuditOptions({ maxViolations: 51 })).toThrow('maxViolations')
    expect(() => normalizeAccessibilityAuditOptions({ maxNodesPerViolation: 11 })).toThrow('maxNodesPerViolation')
  })
})
