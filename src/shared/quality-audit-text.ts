// The English the quality audit writes (src/shared/quality-audit.ts). MCP results and copied audits keep it; the
// renderer recognizes it to show the audit in the interface language.

export const QUALITY_AUDIT_FIXED_TEXT = {
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
} as const

export const QUALITY_AUDIT_CAVEATS = {
  localDiagnostic: 'This is a bounded local diagnostic assembled from Hronaut evidence; it is not a Lighthouse score or a certification.',
  accessibilityAutomation: 'Accessibility automation cannot replace keyboard, screen-reader, zoom, motion, and human usability testing.',
  performanceVisit: 'Performance reflects the current local visit and environment; repeat important measurements under representative conditions.',
  pwaOptional: 'PWA is not treated as a requirement for websites that do not present an offline-app surface.',
  reloadIssues: 'Reload before reproducing startup-only Chromium issues, then rerun this audit.'
} as const

export const QUALITY_AUDIT_CATEGORY_LABELS = {
  accessibility: 'Accessibility',
  performance: 'Performance',
  metadata: 'Metadata & SEO',
  security: 'Security',
  pwa: 'PWA & offline',
  'browser-issues': 'Chromium issues'
} as const

export const qualityAuditText = {
  accessibilityViolations: (count: number, nodes: number) => `${count} ${count === 1 ? 'violation' : 'violations'} across ${nodes} affected nodes`,
  rulesPassed: (count: number) => `${count} rules passed`,
  checksNeedReview: (count: number) => `${count} checks need review`,
  accessibilityFinding: (help: string, nodes: number) => `${help} (${nodes} affected ${nodes === 1 ? 'node' : 'nodes'})`,
  needsHumanReview: (count: number) => `${count} accessibility checks need human review.`,
  performanceGood: (good: number, total: number) => `${good} of ${total} observed Web Vitals are good`,
  metricValue: (value: number, unit: 'ms' | 'score') => unit === 'score' ? value.toFixed(3) : `${Math.round(value)} ms`,
  metricEvidence: (name: string, value: string, rating: string) => `${name}: ${value} (${rating})`,
  metricFinding: (name: string, rating: string, value: string) => `${name} is rated ${rating.replace('-', ' ')} at ${value}.`,
  resourcesAndLongTasks: (resources: number, longTasks: number) => `${resources} resources · ${longTasks} long tasks`,
  metadataIssues: (count: number) => `${count} metadata ${count === 1 ? 'issue' : 'issues'}`,
  language: (language: string | null) => `Language: ${language ?? 'missing'}`,
  canonicalUrls: (count: number) => `Canonical URLs: ${count}`,
  structuredData: (valid: number, invalid: number) => `Structured data: ${valid} valid · ${invalid} invalid`,
  securityState: (state: string) => `Security state: ${state}`,
  securityStateFinding: (state: string) => `Chromium reported the main document security state as ${state}.`,
  transport: (secure: boolean) => `Transport: ${secure ? 'secure' : 'not secure'}`,
  protocol: (protocol: string | null) => `Protocol: ${protocol ?? 'unavailable'}`,
  certificate: (valid: boolean | null) => `Certificate: ${valid === null ? 'unavailable' : valid ? 'valid' : 'invalid'}`,
  pwaSurface: (registrations: number, caches: number) => `${registrations} service-worker registrations · ${caches} caches`,
  manifest: (present: boolean) => `Manifest: ${present ? 'present' : 'not detected'}`,
  controlled: (controlled: boolean) => `Controlled by service worker: ${controlled ? 'yes' : 'no'}`,
  installabilityIssues: (count: number) => `Installability issues: ${count}`,
  installabilityFinding: (errorId: string) => `Chromium reported a PWA installability issue: ${errorId}.`,
  browserIssues: (count: number) => `${count} browser-generated ${count === 1 ? 'issue' : 'issues'}`,
  errors: (count: number) => `${count} errors`,
  warnings: (count: number) => `${count} warnings`,
  informational: (count: number) => `${count} informational`
}
