import type { BrowserAccessibilityAudit, BrowserQualityAuditFinding } from './types.js'
import {
  AGENT_READINESS_MAX_WEBMCP_TOOLS, QUALITY_AUDIT_FIXED_TEXT as fixed, qualityAuditText as text, type AgentReadinessFileState
} from './quality-audit-text.js'

export { AGENT_READINESS_MAX_WEBMCP_TOOLS }

/** The bytes of /llms.txt and /.well-known/ard.json the audit reads at most. */
export const AGENT_READINESS_MAX_FILE_BYTES = 256 * 1024

/**
 * axe rules whose failures break the accessibility tree agents read pages through: names, roles, labels and
 * structure. Close to the rules Lighthouse's agentic-browsing category checks.
 */
export const AGENT_ACCESSIBILITY_RULES = new Set([
  'aria-allowed-attr', 'aria-command-name', 'aria-dialog-name', 'aria-hidden-focus', 'aria-input-field-name', 'aria-meter-name',
  'aria-progressbar-name', 'aria-required-attr', 'aria-required-children', 'aria-required-parent', 'aria-roles', 'aria-toggle-field-name',
  'aria-tooltip-name', 'aria-valid-attr', 'aria-valid-attr-value', 'button-name', 'document-title', 'duplicate-id-aria',
  'form-field-multiple-labels', 'frame-title', 'html-has-lang', 'image-alt', 'input-button-name', 'input-image-alt', 'label', 'link-name',
  'list', 'listitem', 'nested-interactive', 'role-img-alt', 'select-name', 'svg-img-alt', 'tabindex'
])

/**
 * What fetching a well-known file of the page's origin gave: its text, nothing there (a 4xx), a failure, or not
 * checked, as for a file or data page, which has no web origin.
 */
export type AgentReadinessFile = { status: 'found'; text: string } | { status: 'missing' } | { status: 'failed' } | { status: 'unchecked' }

/** What the audit learned about the page for agents; collected in main, judged here. */
export interface AgentReadinessSources {
  /** Registered WebMCP tools, or null when the page has no WebMCP. */
  webMcpTools: number | null
  /** Forms in the top-level document with neither a toolname nor a tooldescription attribute. */
  unannotatedForms: number
  forms: number
  llmsTxt: AgentReadinessFile
  ardManifest: AgentReadinessFile
}

export type LlmsTxtProblem = 'no-heading' | 'no-link' | 'too-short'

/** What /llms.txt lacks of the format's recommendations: a Markdown H1, a Markdown link and at least 50 characters. */
export function llmsTxtProblems(body: string): LlmsTxtProblem[] {
  const problems: LlmsTxtProblem[] = []
  if (!/^\s*#\s+.+/m.test(body)) problems.push('no-heading')
  if (!/\[.+\]\(.+\)/.test(body)) problems.push('no-link')
  if (body.trim().length < 50) problems.push('too-short')
  return problems
}

/** Whether an ARD manifest is at least a JSON object; full ARD conformance is not checked. */
export function ardManifestValid(text: string): boolean {
  try {
    const value = JSON.parse(text) as unknown
    return value !== null && typeof value === 'object' && !Array.isArray(value)
  } catch {
    return false
  }
}


function fileState(file: AgentReadinessFile, valid: (text: string) => boolean): AgentReadinessFileState {
  if (file.status === 'unchecked') return 'not checked'
  if (file.status === 'missing') return 'not found'
  if (file.status === 'failed') return 'unreachable'
  return valid(file.text) ? 'valid' : 'invalid'
}

/** The agent readiness findings and evidence lines, from what main collected and the accessibility audit. */
export function agentReadinessFindings(sources: AgentReadinessSources, accessibility: BrowserAccessibilityAudit): {
  findings: BrowserQualityAuditFinding[]
  evidence: string[]
} {
  const findings: BrowserQualityAuditFinding[] = []
  const add = (severity: BrowserQualityAuditFinding['severity'], code: string, message: string) => {
    findings.push({ category: 'agent-readiness', severity, code, message })
  }
  const failingRules = accessibility.violations.map(violation => violation.id).filter(id => AGENT_ACCESSIBILITY_RULES.has(id)).sort()
  if (failingRules.length) add('error', 'accessibility-for-agents', text.accessibilityForAgents(failingRules))
  if (sources.webMcpTools !== null && sources.webMcpTools > AGENT_READINESS_MAX_WEBMCP_TOOLS) {
    add('warning', 'webmcp-too-many-tools', text.tooManyTools(sources.webMcpTools))
  }
  // A page with WebMCP but no tools of its own does not use it, so its forms are not judged.
  if (sources.webMcpTools && sources.unannotatedForms > 0) add('info', 'webmcp-form-coverage', text.formsUnannotated(sources.unannotatedForms))
  if (sources.llmsTxt.status === 'missing') add('info', 'llms-txt-missing', fixed.llmsTxtMissing)
  else if (sources.llmsTxt.status === 'failed') add('warning', 'llms-txt-failed', fixed.llmsTxtFailed)
  else if (sources.llmsTxt.status === 'found') {
    const messages = { 'no-heading': fixed.llmsTxtNoHeading, 'no-link': fixed.llmsTxtNoLink, 'too-short': fixed.llmsTxtTooShort }
    for (const problem of llmsTxtProblems(sources.llmsTxt.text)) add('warning', `llms-txt-${problem}`, messages[problem])
  }
  if (sources.ardManifest.status === 'failed') add('warning', 'ard-manifest-failed', fixed.ardFailed)
  else if (sources.ardManifest.status === 'found' && !ardManifestValid(sources.ardManifest.text)) add('warning', 'ard-manifest-invalid', fixed.ardInvalid)
  return {
    findings,
    evidence: [
      sources.webMcpTools === null ? fixed.webMcpUnavailable : text.webMcpTools(sources.webMcpTools),
      ...(sources.webMcpTools && sources.forms > 0 ? [text.unannotatedForms(sources.unannotatedForms, sources.forms)] : []),
      text.llmsTxt(fileState(sources.llmsTxt, body => llmsTxtProblems(body).length === 0)),
      text.ardManifest(fileState(sources.ardManifest, ardManifestValid)),
      text.agentAccessibility(failingRules.length)
    ]
  }
}
