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
import { QUALITY_AUDIT_CATEGORY_LABELS, QUALITY_AUDIT_CAVEATS, QUALITY_AUDIT_FIXED_TEXT, qualityAuditText as text } from './quality-audit-text.js'

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
  summary: string,
  evidence: string[],
  findings: BrowserQualityAuditFinding[],
  status = categoryStatus(findings)
): BrowserQualityAuditCategory {
  return { id, label: QUALITY_AUDIT_CATEGORY_LABELS[id], status, summary, findingCount: findings.length, evidence }
}

function metricEvidence(metric: BrowserPerformanceMetric | null): string | null {
  if (!metric) return null
  return text.metricEvidence(metric.name, text.metricValue(metric.value, metric.unit), metric.rating)
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
    message: boundedMessage(text.accessibilityFinding(violation.help, violation.nodeCount))
  }))
  if (sources.accessibility.needsReviewCount > 0) {
    accessibilityFindings.push({
      category: 'accessibility',
      severity: 'warning',
      code: 'needs-review',
      message: text.needsHumanReview(sources.accessibility.needsReviewCount)
    })
  }

  const observedMetrics = Object.values(sources.performance.metrics).filter((metric): metric is BrowserPerformanceMetric => metric !== null)
  const performanceFindings = observedMetrics
    .filter((metric) => metric.rating !== 'good')
    .map<BrowserQualityAuditFinding>((metric) => ({
      category: 'performance',
      severity: 'warning',
      code: `web-vital-${metric.name.toLocaleLowerCase()}`,
      message: text.metricFinding(metric.name, metric.rating, text.metricValue(metric.value, metric.unit))
    }))
  if (!observedMetrics.length) {
    performanceFindings.push({
      category: 'performance',
      severity: 'info',
      code: 'web-vitals-not-observed',
      message: QUALITY_AUDIT_FIXED_TEXT.webVitalsNotObserved
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
      message: QUALITY_AUDIT_FIXED_TEXT.insecureTransport
    })
  } else if (sources.security.state !== 'secure') {
    securityFindings.push({
      category: 'security',
      severity: 'warning',
      code: 'security-state-unconfirmed',
      message: text.securityStateFinding(sources.security.state)
    })
  }
  if (sources.security.certificate && !sources.security.certificate.valid) {
    securityFindings.push({
      category: 'security',
      severity: 'error',
      code: 'certificate-invalid',
      message: sources.security.certificate.expired
        ? QUALITY_AUDIT_FIXED_TEXT.certificateExpired
        : sources.security.certificate.notYetValid
          ? QUALITY_AUDIT_FIXED_TEXT.certificateNotYetValid
          : QUALITY_AUDIT_FIXED_TEXT.certificateInvalid
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
      message: text.installabilityFinding(boundedMessage(error.errorId) || 'unknown issue')
    })
  }
  if (!sources.pwa.manifestInspectionAvailable || !sources.pwa.cacheInspectionAvailable) {
    pwaFindings.push({
      category: 'pwa',
      severity: 'info',
      code: 'pwa-inspection-partial',
      message: QUALITY_AUDIT_FIXED_TEXT.pwaInspectionPartial
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
      sources.accessibility.violationCount
        ? text.accessibilityViolations(sources.accessibility.violationCount, sources.accessibility.affectedNodeCount)
        : QUALITY_AUDIT_FIXED_TEXT.accessibilityClear,
      [
        text.rulesPassed(sources.accessibility.passedRuleCount),
        text.checksNeedReview(sources.accessibility.needsReviewCount),
        `axe-core ${sources.accessibility.engine.version}`
      ],
      accessibilityFindings
    ),
    category(
      'performance',
      observedMetrics.length
        ? text.performanceGood(observedMetrics.filter((metric) => metric.rating === 'good').length, observedMetrics.length)
        : QUALITY_AUDIT_FIXED_TEXT.performanceNone,
      [
        ...Object.values(sources.performance.metrics).map(metricEvidence).filter((value): value is string => value !== null),
        text.resourcesAndLongTasks(sources.performance.resources.count, sources.performance.longTasks.count)
      ],
      performanceFindings
    ),
    category(
      'metadata',
      sources.metadata.issues.length ? text.metadataIssues(sources.metadata.issues.length) : QUALITY_AUDIT_FIXED_TEXT.metadataClear,
      [
        text.language(sources.metadata.document.language),
        text.canonicalUrls(sources.metadata.document.canonicalUrls.length),
        text.structuredData(sources.metadata.structuredData.validBlockCount, sources.metadata.structuredData.invalidBlockCount)
      ],
      metadataFindings
    ),
    category(
      'security',
      sources.security.state === 'secure' ? QUALITY_AUDIT_FIXED_TEXT.securitySecure : text.securityState(sources.security.state),
      [
        text.transport(sources.security.secureTransport),
        text.protocol(sources.security.connection?.protocol ?? null),
        text.certificate(sources.security.certificate ? sources.security.certificate.valid : null)
      ],
      securityFindings
    ),
    category(
      'pwa',
      pwaApplicable ? text.pwaSurface(sources.pwa.registrations.length, sources.pwa.caches.length) : QUALITY_AUDIT_FIXED_TEXT.pwaNone,
      [
        text.manifest(Boolean(sources.pwa.manifest)),
        text.controlled(sources.pwa.controlled),
        text.installabilityIssues(sources.pwa.manifest?.installabilityErrors.length ?? 0)
      ],
      pwaFindings,
      !pwaApplicable && !pwaFindings.length ? 'not-applicable' : categoryStatus(pwaFindings)
    ),
    category(
      'browser-issues',
      sources.browserIssues.issueCount ? text.browserIssues(sources.browserIssues.issueCount) : QUALITY_AUDIT_FIXED_TEXT.browserIssuesClear,
      [
        text.errors(sources.browserIssues.errorCount),
        text.warnings(sources.browserIssues.warningCount),
        text.informational(sources.browserIssues.infoCount)
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
    caveats: Object.values(QUALITY_AUDIT_CAVEATS)
  }
}
