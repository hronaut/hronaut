// Quality audit report text in each language; src/shared/quality-audit-text.ts holds the English the audit records.
export const enUSQualityAuditText = {
  categories: {
    accessibility: 'Accessibility',
    performance: 'Performance',
    metadata: 'Metadata & SEO',
    security: 'Security',
    pwa: 'PWA & offline',
    'browser-issues': 'Chromium issues'
  },
  statuses: {
    pass: 'pass',
    info: 'info',
    warning: 'warning',
    error: 'error',
    'not-applicable': 'not applicable'
  },
  severities: {
    error: 'error',
    warning: 'warning',
    info: 'info'
  },
  fixed: {
    accessibilityClear: 'No automated WCAG AA violations found',
    performanceNone: 'No Web Vitals observed in this visit',
    metadataClear: 'No metadata issues found',
    securitySecure: 'Secure main-document transport',
    pwaNone: 'No PWA or offline-app surface detected',
    browserIssuesClear: 'No retained Chromium issues found',
    webVitalsNotObserved: 'No Web Vitals were observed in the current visit; reload and interact with the page before rerunning the audit.',
    insecureTransport: 'The main document is not using a healthy secure transport.',
    certificateExpired: 'The main document certificate has expired.',
    certificateNotYetValid: 'The main document certificate is not valid yet.',
    certificateInvalid: 'The main document certificate is not currently valid.',
    pwaInspectionPartial: 'Some PWA diagnostics were unavailable for this audit.'
  },
  caveats: {
    localDiagnostic: 'This is a bounded local diagnostic assembled from Hronaut evidence; it is not a Lighthouse score or a certification.',
    accessibilityAutomation: 'Accessibility automation cannot replace keyboard, screen-reader, zoom, motion, and human usability testing.',
    performanceVisit: 'Performance reflects the current local visit and environment; repeat important measurements under representative conditions.',
    pwaOptional: 'PWA is not treated as a requirement for websites that do not present an offline-app surface.',
    reloadIssues: 'Reload before reproducing startup-only Chromium issues, then rerun this audit.'
  },
  text: {
    violations: '{count} violation | {count} violations',
    violationNodes: '{count} affected node | {count} affected nodes',
    accessibilityViolations: '{violations} across {nodes}',
    affectedNodes: '{count} affected node | {count} affected nodes',
    accessibilityFinding: '{help} ({nodes})',
    rulesPassed: '{count} rule passed | {count} rules passed',
    checksNeedReview: '{count} check needs review | {count} checks need review',
    needsHumanReview: '{count} accessibility check needs human review. | {count} accessibility checks need human review.',
    performanceGood: '{good} of {total} observed Web Vital is good | {good} of {total} observed Web Vitals are good',
    metricEvidence: '{name}: {value} ({rating})',
    metricFinding: '{name} is rated {rating} at {value}.',
    resources: '{count} resource | {count} resources',
    longTasks: '{count} long task | {count} long tasks',
    metadataIssues: '{count} metadata issue | {count} metadata issues',
    language: 'Language: {language}',
    languageMissing: 'Language: missing',
    canonicalUrls: 'Canonical URLs: {count}',
    structuredData: 'Structured data: {valid} valid · {invalid} invalid',
    securityState: 'Security state: {state}',
    securityStateFinding: 'Chromium reported the main document security state as {state}.',
    transportSecure: 'Transport: secure',
    transportInsecure: 'Transport: not secure',
    protocol: 'Protocol: {protocol}',
    protocolUnavailable: 'Protocol: unavailable',
    certificateValid: 'Certificate: valid',
    certificateInvalid: 'Certificate: invalid',
    certificateUnavailable: 'Certificate: unavailable',
    registrations: '{count} service-worker registration | {count} service-worker registrations',
    caches: '{count} cache | {count} caches',
    manifestPresent: 'Manifest: present',
    manifestMissing: 'Manifest: not detected',
    controlledYes: 'Controlled by service worker: yes',
    controlledNo: 'Controlled by service worker: no',
    installabilityIssues: 'Installability issues: {count}',
    installabilityFinding: 'Chromium reported a PWA installability issue: {issue}.',
    installabilityUnknown: 'Chromium reported a PWA installability issue: unknown issue.',
    browserIssues: '{count} browser-generated issue | {count} browser-generated issues'
  }
}
