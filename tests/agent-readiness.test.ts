import { describe, expect, it } from 'vitest'
import { agentReadinessFindings, ardManifestValid, llmsTxtProblems, type AgentReadinessSources } from '../src/shared/agent-readiness.js'
import type { BrowserAccessibilityAudit } from '../src/shared/types.js'

const GOOD_LLMS = '# Example\n\n> A shop for things.\n\n- [Docs](https://example.test/docs): how to use the shop'

function accessibility(ids: string[] = []): BrowserAccessibilityAudit {
  return {
    tabId: 'tab-1',
    url: 'https://example.test/',
    title: 'Example',
    auditedAt: '2026-08-17T00:00:00.000Z',
    action: 'measure',
    standard: 'wcag-aa',
    scope: { selector: null, maxViolations: 50, maxNodesPerViolation: 1 },
    engine: { name: 'axe-core', version: '4.10.0' },
    violationCount: ids.length,
    affectedNodeCount: ids.length,
    needsReviewCount: 0,
    passedRuleCount: 20,
    truncated: false,
    violations: ids.map(id => ({ id, impact: 'serious', help: id, description: id, helpUrl: '', tags: [], nodeCount: 1, nodes: [] })) as never
  }
}

function sources(overrides: Partial<AgentReadinessSources> = {}): AgentReadinessSources {
  return { webMcpTools: null, forms: 0, unannotatedForms: 0, llmsTxt: { status: 'found', text: GOOD_LLMS }, ardManifest: { status: 'missing' }, ...overrides }
}

const codes = (value: AgentReadinessSources, ids?: string[]) => agentReadinessFindings(value, accessibility(ids)).findings.map(finding => finding.code)

describe('agent readiness', () => {
  it('passes a page with a well-formed llms.txt and no ARD manifest, which is optional', () => {
    const result = agentReadinessFindings(sources(), accessibility())
    expect(result.findings).toEqual([])
    expect(result.evidence).toEqual(['WebMCP: unavailable', 'llms.txt: valid', 'ARD manifest: not found', 'Failing accessibility rules agents rely on: 0'])
  })

  it('checks llms.txt for a heading, a link and enough text', () => {
    expect(llmsTxtProblems(GOOD_LLMS)).toEqual([])
    expect(llmsTxtProblems('short')).toEqual(['no-heading', 'no-link', 'too-short'])
    expect(llmsTxtProblems('#nospace\n' + 'x'.repeat(60))).toEqual(['no-heading', 'no-link'])
    expect(codes(sources({ llmsTxt: { status: 'found', text: 'plain text that is long enough to pass the fifty character bar' } })))
      .toEqual(['llms-txt-no-heading', 'llms-txt-no-link'])
  })

  it('tells a missing llms.txt from one the server failed to give', () => {
    expect(agentReadinessFindings(sources({ llmsTxt: { status: 'missing' } }), accessibility()).findings)
      .toEqual([expect.objectContaining({ code: 'llms-txt-missing', severity: 'info', category: 'agent-readiness' })])
    expect(agentReadinessFindings(sources({ llmsTxt: { status: 'failed' } }), accessibility()).findings)
      .toEqual([expect.objectContaining({ code: 'llms-txt-failed', severity: 'warning' })])
    // Not checked (a page with no web origin) is neither a finding nor reported as missing.
    const unchecked = agentReadinessFindings(sources({ llmsTxt: { status: 'unchecked' }, ardManifest: { status: 'unchecked' } }), accessibility())
    expect(unchecked.findings).toEqual([])
    expect(unchecked.evidence).toContain('llms.txt: not checked')
    expect(unchecked.evidence).toContain('ARD manifest: not checked')
  })

  it('needs an ARD manifest, when there is one, to be a JSON object', () => {
    expect(ardManifestValid('{"name":"x"}')).toBe(true)
    expect(ardManifestValid('[1]')).toBe(false)
    expect(ardManifestValid('null')).toBe(false)
    expect(ardManifestValid('<html>')).toBe(false)
    expect(codes(sources({ ardManifest: { status: 'found', text: '<html>' } }))).toEqual(['ard-manifest-invalid'])
    expect(codes(sources({ ardManifest: { status: 'failed' } }))).toEqual(['ard-manifest-failed'])
    expect(agentReadinessFindings(sources({ ardManifest: { status: 'found', text: '{}' } }), accessibility()).evidence).toContain('ARD manifest: valid')
  })

  it('reports only the accessibility rules agents rely on, sorted', () => {
    const result = agentReadinessFindings(sources(), accessibility(['color-contrast', 'link-name', 'button-name']))
    expect(result.findings).toEqual([expect.objectContaining({ code: 'accessibility-for-agents', severity: 'error' })])
    expect(result.findings[0]?.message).toContain('button-name, link-name')
    expect(result.findings[0]?.message).not.toContain('color-contrast')
    expect(result.evidence).toContain('Failing accessibility rules agents rely on: 2')
  })

  it('judges WebMCP tool count and form coverage only on pages with WebMCP', () => {
    expect(codes(sources({ forms: 3, unannotatedForms: 3 }))).toEqual([])
    // Chromium offers WebMCP to every page; one that registers no tools does not use it.
    expect(codes(sources({ webMcpTools: 0, forms: 3, unannotatedForms: 3 }))).toEqual([])
    expect(agentReadinessFindings(sources({ webMcpTools: 0, forms: 3, unannotatedForms: 3 }), accessibility()).evidence[1]).toBe('llms.txt: valid')
    expect(codes(sources({ webMcpTools: 41, forms: 3, unannotatedForms: 2 }))).toEqual(['webmcp-too-many-tools', 'webmcp-form-coverage'])
    expect(codes(sources({ webMcpTools: 40, forms: 1, unannotatedForms: 0 }))).toEqual([])
    const evidence = agentReadinessFindings(sources({ webMcpTools: 2, forms: 3, unannotatedForms: 1 }), accessibility()).evidence
    expect(evidence.slice(0, 2)).toEqual(['WebMCP tools: 2', 'Forms without WebMCP annotations: 1 of 3'])
  })
})
