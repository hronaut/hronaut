import type {
  BrowserAccessibilityAudit,
  BrowserInspectorIssuesReport,
  BrowserPageMetadataReport,
  BrowserPerformanceMetric,
  BrowserPerformanceReport,
  BrowserPwaReport,
  BrowserQualityAudit,
  BrowserQualityAuditCategory,
  BrowserQualityAuditCategoryId,
  BrowserQualityAuditCategoryStatus,
  BrowserQualityAuditFinding,
  BrowserSecurityReport
} from './types.js'

const MAX_FINDINGS = 40
const MAX_MESSAGE_CHARS = 500

export interface BrowserQualityAuditSources {
  accessibility: BrowserAccessibilityAudit
  performance: BrowserPerformanceReport
  metadata: BrowserPageMetadataReport
  security: BrowserSecurityReport
  pwa: BrowserPwaReport
  browserIssues: BrowserInspectorIssuesReport
}

function boundedMessage(value: string): string {
  return value.trim().replace(/\s+/g, ' ').slice(0, MAX_MESSAGE_CHARS)
}

function categoryStatus(findings: BrowserQualityAuditFinding[]): BrowserQualityAuditCategoryStatus {
  if (findings.some((finding) => finding.severity === 'error')) return 'error'
  if (findings.some((finding) => finding.severity === 'warning')) return 'warning'
  if (findings.some((finding) => finding.severity === 'info')) return 'info'
  return 'pass'
}

function category(
  id: BrowserQualityAuditCategoryId,
  label: string,
  summary: string,
  evidence: string[],
  findings: BrowserQualityAuditFinding[],
  status = categoryStatus(findings)
): BrowserQualityAuditCategory {
  return { id, label, status, summary, findingCount: findings.length, evidence }
}

function metricEvidence(metric: BrowserPerformanceMetric | null): string | null {
  if (!metric) return null
  const value = metric.unit === 'score' ? metric.value.toFixed(3) : `${Math.round(metric.value)} ms`
  return `${metric.name}: ${value} (${metric.rating})`
}

function impactSeverity(impact: BrowserAccessibilityAudit['violations'][number]['impact']): BrowserQualityAuditFinding['severity'] {
  if (impact === 'critical' || impact === 'serious') return 'error'
  if (impact === 'moderate' || impact === 'minor') return 'warning'
  return 'info'
}

export function buildBrowserQualityAudit(sources: BrowserQualityAuditSources): BrowserQualityAudit {
  const accessibilityFindings = sources.accessibility.violations.map<BrowserQualityAuditFinding>((violation) => ({
    category: 'accessibility',
    severity: impactSeverity(violation.impact),
    code: violation.id,
    message: boundedMessage(`${violation.help} (${violation.nodeCount} affected ${violation.nodeCount === 1 ? 'node' : 'nodes'})`)
  }))
  if (sources.accessibility.needsReviewCount > 0) {
    accessibilityFindings.push({
      category: 'accessibility',
      severity: 'warning',
      code: 'needs-review',
      message: `${sources.accessibility.needsReviewCount} accessibility checks need human review.`
    })
  }

  const observedMetrics = Object.values(sources.performance.metrics).filter((metric): metric is BrowserPerformanceMetric => metric !== null)
  const performanceFindings = observedMetrics
    .filter((metric) => metric.rating !== 'good')
    .map<BrowserQualityAuditFinding>((metric) => ({
      category: 'performance',
      severity: 'warning',
      code: `web-vital-${metric.name.toLocaleLowerCase()}`,
      message: `${metric.name} is rated ${metric.rating.replace('-', ' ')} at ${metric.unit === 'score' ? metric.value.toFixed(3) : `${Math.round(metric.value)} ms`}.`
    }))
  if (!observedMetrics.length) {
    performanceFindings.push({
      category: 'performance',
      severity: 'info',
      code: 'web-vitals-not-observed',
      message: 'No Web Vitals were observed in the current visit; reload and interact with the page before rerunning the audit.'
    })
  }

  const metadataFindings = sources.metadata.issues.map<BrowserQualityAuditFinding>((issue) => ({
    category: 'metadata',
    severity: issue.severity,
    code: issue.code,
    message: boundedMessage(issue.message)
  }))

  const securityFindings: BrowserQualityAuditFinding[] = []
  if (sources.security.state === 'insecure' || sources.security.state === 'insecure-broken') {
    securityFindings.push({
      category: 'security',
      severity: 'error',
      code: 'insecure-transport',
      message: 'The main document is not using a healthy secure transport.'
    })
  } else if (sources.security.state !== 'secure') {
    securityFindings.push({
      category: 'security',
      severity: 'warning',
      code: 'security-state-unconfirmed',
      message: `Chromium reported the main document security state as ${sources.security.state}.`
    })
  }
  if (sources.security.certificate && !sources.security.certificate.valid) {
    securityFindings.push({
      category: 'security',
      severity: 'error',
      code: 'certificate-invalid',
      message: sources.security.certificate.expired
        ? 'The main document certificate has expired.'
        : sources.security.certificate.notYetValid
          ? 'The main document certificate is not valid yet.'
          : 'The main document certificate is not currently valid.'
    })
  }

  const pwaApplicable = Boolean(sources.pwa.manifest || sources.pwa.registrations.length || sources.pwa.caches.length)
  const pwaFindings: BrowserQualityAuditFinding[] = []
  for (const error of sources.pwa.manifest?.parseErrors ?? []) {
    pwaFindings.push({
      category: 'pwa',
      severity: error.critical ? 'error' : 'warning',
      code: 'manifest-parse-error',
      message: boundedMessage(error.message)
    })
  }
  for (const error of sources.pwa.manifest?.installabilityErrors ?? []) {
    pwaFindings.push({
      category: 'pwa',
      severity: 'warning',
      code: boundedMessage(error.errorId) || 'installability-error',
      message: `Chromium reported a PWA installability issue: ${boundedMessage(error.errorId) || 'unknown issue'}.`
    })
  }
  if (!sources.pwa.manifestInspectionAvailable || !sources.pwa.cacheInspectionAvailable) {
    pwaFindings.push({
      category: 'pwa',
      severity: 'info',
      code: 'pwa-inspection-partial',
      message: 'Some PWA diagnostics were unavailable for this audit.'
    })
  }

  const browserIssueFindings = sources.browserIssues.issues.map<BrowserQualityAuditFinding>((issue) => ({
    category: 'browser-issues',
    severity: issue.severity,
    code: issue.code,
    message: boundedMessage(issue.title)
  }))

  const categories: BrowserQualityAuditCategory[] = [
    category(
      'accessibility',
      'Accessibility',
      sources.accessibility.violationCount
        ? `${sources.accessibility.violationCount} ${sources.accessibility.violationCount === 1 ? 'violation' : 'violations'} across ${sources.accessibility.affectedNodeCount} affected nodes`
        : 'No automated WCAG AA violations found',
      [
        `${sources.accessibility.passedRuleCount} rules passed`,
        `${sources.accessibility.needsReviewCount} checks need review`,
        `axe-core ${sources.accessibility.engine.version}`
      ],
      accessibilityFindings
    ),
    category(
      'performance',
      'Performance',
      observedMetrics.length
        ? `${observedMetrics.filter((metric) => metric.rating === 'good').length} of ${observedMetrics.length} observed Web Vitals are good`
        : 'No Web Vitals observed in this visit',
      [
        ...Object.values(sources.performance.metrics).map(metricEvidence).filter((value): value is string => value !== null),
        `${sources.performance.resources.count} resources · ${sources.performance.longTasks.count} long tasks`
      ],
      performanceFindings
    ),
    category(
      'metadata',
      'Metadata & SEO',
      sources.metadata.issues.length
        ? `${sources.metadata.issues.length} metadata ${sources.metadata.issues.length === 1 ? 'issue' : 'issues'}`
        : 'No metadata issues found',
      [
        `Language: ${sources.metadata.document.language ?? 'missing'}`,
        `Canonical URLs: ${sources.metadata.document.canonicalUrls.length}`,
        `Structured data: ${sources.metadata.structuredData.validBlockCount} valid · ${sources.metadata.structuredData.invalidBlockCount} invalid`
      ],
      metadataFindings
    ),
    category(
      'security',
      'Security',
      sources.security.state === 'secure' ? 'Secure main-document transport' : `Security state: ${sources.security.state}`,
      [
        `Transport: ${sources.security.secureTransport ? 'secure' : 'not secure'}`,
        `Protocol: ${sources.security.connection?.protocol ?? 'unavailable'}`,
        `Certificate: ${sources.security.certificate ? (sources.security.certificate.valid ? 'valid' : 'invalid') : 'unavailable'}`
      ],
      securityFindings
    ),
    category(
      'pwa',
      'PWA & offline',
      pwaApplicable
        ? `${sources.pwa.registrations.length} service-worker registrations · ${sources.pwa.caches.length} caches`
        : 'No PWA or offline-app surface detected',
      [
        `Manifest: ${sources.pwa.manifest ? 'present' : 'not detected'}`,
        `Controlled by service worker: ${sources.pwa.controlled ? 'yes' : 'no'}`,
        `Installability issues: ${sources.pwa.manifest?.installabilityErrors.length ?? 0}`
      ],
      pwaFindings,
      !pwaApplicable && !pwaFindings.length ? 'not-applicable' : categoryStatus(pwaFindings)
    ),
    category(
      'browser-issues',
      'Chromium issues',
      sources.browserIssues.issueCount
        ? `${sources.browserIssues.issueCount} browser-generated ${sources.browserIssues.issueCount === 1 ? 'issue' : 'issues'}`
        : 'No retained Chromium issues found',
      [
        `${sources.browserIssues.errorCount} errors`,
        `${sources.browserIssues.warningCount} warnings`,
        `${sources.browserIssues.infoCount} informational`
      ],
      browserIssueFindings
    )
  ]

  const allFindings = [
    ...accessibilityFindings,
    ...performanceFindings,
    ...metadataFindings,
    ...securityFindings,
    ...pwaFindings,
    ...browserIssueFindings
  ]
  const totals = {
    errors: allFindings.filter((finding) => finding.severity === 'error').length,
    warnings: allFindings.filter((finding) => finding.severity === 'warning').length,
    info: allFindings.filter((finding) => finding.severity === 'info').length
  }
  const status = totals.errors ? 'error' : totals.warnings ? 'warning' : 'pass'

  return {
    tabId: sources.accessibility.tabId,
    url: sources.accessibility.url,
    title: sources.accessibility.title,
    auditedAt: new Date().toISOString(),
    status,
    totals,
    categories,
    findings: allFindings.slice(0, MAX_FINDINGS),
    truncated: allFindings.length > MAX_FINDINGS,
    caveats: [
      'This is a bounded local diagnostic assembled from Hronaut evidence; it is not a Lighthouse score or a certification.',
      'Accessibility automation cannot replace keyboard, screen-reader, zoom, motion, and human usability testing.',
      'Performance reflects the current local visit and environment; repeat important measurements under representative conditions.',
      'PWA is not treated as a requirement for websites that do not present an offline-app surface.',
      'Reload before reproducing startup-only Chromium issues, then rerun this audit.'
    ]
  }
}
