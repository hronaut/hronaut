import { INSPECTOR_ISSUE_METADATA } from '../../../../../shared/browser-issues.js'
import {
  QUALITY_AUDIT_CATEGORY_LABELS,
  QUALITY_AUDIT_CAVEATS,
  QUALITY_AUDIT_FIXED_TEXT,
  qualityAuditText as english
} from '../../../../../shared/quality-audit-text.js'
import type { BrowserQualityAuditCategory, BrowserQualityAuditFinding } from '../../../../../shared/types.js'

type Translate = (key: string, named?: Record<string, unknown>, plural?: number) => string
type FormatNumber = (value: number, options?: Intl.NumberFormatOptions) => string

const STATUSES = new Set(['pass', 'info', 'warning', 'error', 'not-applicable'])
const SEVERITIES = new Set(['error', 'warning', 'info'])
const RATINGS = new Set(['good', 'needs-improvement', 'poor'])
const SECURITY_STATES = new Set(['secure', 'insecure', 'insecure-broken', 'neutral', 'info', 'unknown'])
const FIXED_TEXT = new Map(Object.entries(QUALITY_AUDIT_FIXED_TEXT).map(([key, value]) => [value as string, key]))
const CAVEATS = new Map(Object.entries(QUALITY_AUDIT_CAVEATS).map(([key, value]) => [value as string, key]))
// Page metadata findings carry the messages the Page metadata panel names by code.
const METADATA_ISSUES: Readonly<Record<string, string>> = {
  'missing-title': 'missingTitle', 'multiple-titles': 'multipleTitles',
  'missing-description': 'missingDescription', 'multiple-descriptions': 'multipleDescriptions',
  'missing-canonical': 'missingCanonical', 'multiple-canonicals': 'multipleCanonicals',
  'missing-language': 'missingLanguage', 'missing-viewport': 'missingViewport',
  'robots-noindex': 'robotsNoindex', 'missing-h1': 'missingH1', 'multiple-h1': 'multipleH1',
  'missing-og-image-alt': 'missingOgImageAlt', 'missing-twitter-card': 'missingTwitterCard'
}

/**
 * Names the quality audit in the interface language. The audit records English (src/shared/quality-audit-text.ts),
 * and MCP results and copied audits keep it. Each sentence is translated only when the English helper rebuilds it
 * exactly from the values read back out of it, so text Hronaut did not write, such as a truncated message, shows as
 * recorded.
 */
export function createQualityAuditLabels(translate: Translate, formatNumber: FormatNumber) {
  const count = (value: string) => formatNumber(Number(value))
  const plural = (key: string, value: string) => translate(`qualityAuditText.text.${key}`, { count: count(value) }, Number(value))
  const text = (key: string, named: Record<string, unknown> = {}, choice?: number) => translate(`qualityAuditText.text.${key}`, named, choice)
  const rating = (value: string) => RATINGS.has(value) ? translate(`performance.ratings.${value}`) : value
  const securityState = (value: string) => SECURITY_STATES.has(value) ? translate(`securityReport.states.${value}`) : value
  function metricValue(value: string): string {
    return value.endsWith(' ms')
      ? `${formatNumber(Number(value.slice(0, -3)))} ms`
      : formatNumber(Number(value), { minimumFractionDigits: 3, maximumFractionDigits: 3 })
  }

  // Each reads its values back out of an English sentence; the sentence is translated only if the helper that wrote
  // it rebuilds it exactly from them.
  const sentences: Array<[RegExp, (match: string[]) => string, (match: string[]) => string]> = [
    [/^(\d+) violations? across (\d+) affected nodes$/, ([, a = '', b = '']) => english.accessibilityViolations(Number(a), Number(b)),
      ([, a = '', b = '']) => text('accessibilityViolations', { violations: plural('violations', a), nodes: plural('violationNodes', b) })],
    [/^(\d+) rules passed$/, ([, a = '']) => english.rulesPassed(Number(a)), ([, a = '']) => plural('rulesPassed', a)],
    [/^(\d+) checks need review$/, ([, a = '']) => english.checksNeedReview(Number(a)), ([, a = '']) => plural('checksNeedReview', a)],
    [/^(.+) \((\d+) affected nodes?\)$/, ([, help = '', a = '']) => english.accessibilityFinding(help, Number(a)),
      ([, help = '', a = '']) => text('accessibilityFinding', { help, nodes: plural('affectedNodes', a) })],
    [/^(\d+) accessibility checks need human review\.$/, ([, a = '']) => english.needsHumanReview(Number(a)), ([, a = '']) => plural('needsHumanReview', a)],
    [/^(\d+) of (\d+) observed Web Vitals are good$/, ([, a = '', b = '']) => english.performanceGood(Number(a), Number(b)),
      ([, a = '', b = '']) => text('performanceGood', { good: count(a), total: count(b) }, Number(b))],
    [/^([A-Z]+): (\d+ ms|\d+\.\d{3}) \(([a-z-]+)\)$/, ([, name = '', value = '', code = '']) => english.metricEvidence(name, value, code),
      ([, name = '', value = '', code = '']) => text('metricEvidence', { name, value: metricValue(value), rating: rating(code) })],
    [/^([A-Z]+) is rated (good|needs improvement|poor) at (\d+ ms|\d+\.\d{3})\.$/, ([, name = '', words = '', value = '']) => english.metricFinding(name, words.replace(' ', '-'), value),
      ([, name = '', words = '', value = '']) => text('metricFinding', { name, rating: rating(words.replace(' ', '-')), value: metricValue(value) })],
    [/^(\d+) resources · (\d+) long tasks$/, ([, a = '', b = '']) => english.resourcesAndLongTasks(Number(a), Number(b)),
      ([, a = '', b = '']) => `${plural('resources', a)} · ${plural('longTasks', b)}`],
    [/^(\d+) metadata issues?$/, ([, a = '']) => english.metadataIssues(Number(a)), ([, a = '']) => plural('metadataIssues', a)],
    [/^Language: (.+)$/, ([, language = '']) => english.language(language),
      ([, language = '']) => language === 'missing' ? text('languageMissing') : text('language', { language })],
    [/^Canonical URLs: (\d+)$/, ([, a = '']) => english.canonicalUrls(Number(a)), ([, a = '']) => text('canonicalUrls', { count: count(a) }, Number(a))],
    [/^Structured data: (\d+) valid · (\d+) invalid$/, ([, a = '', b = '']) => english.structuredData(Number(a), Number(b)),
      ([, a = '', b = '']) => text('structuredData', { valid: count(a), invalid: count(b) })],
    [/^Security state: (.+)$/, ([, state = '']) => english.securityState(state), ([, state = '']) => text('securityState', { state: securityState(state) })],
    [/^Chromium reported the main document security state as (.+)\.$/, ([, state = '']) => english.securityStateFinding(state),
      ([, state = '']) => text('securityStateFinding', { state: securityState(state) })],
    [/^Transport: (secure|not secure)$/, ([, value = '']) => english.transport(value === 'secure'),
      ([, value = '']) => text(value === 'secure' ? 'transportSecure' : 'transportInsecure')],
    [/^Protocol: (.+)$/, ([, protocol = '']) => english.protocol(protocol),
      ([, protocol = '']) => protocol === 'unavailable' ? text('protocolUnavailable') : text('protocol', { protocol })],
    [/^Certificate: (valid|invalid|unavailable)$/, ([, value = '']) => english.certificate(value === 'unavailable' ? null : value === 'valid'),
      ([, value = '']) => text(value === 'valid' ? 'certificateValid' : value === 'invalid' ? 'certificateInvalid' : 'certificateUnavailable')],
    [/^(\d+) service-worker registrations · (\d+) caches$/, ([, a = '', b = '']) => english.pwaSurface(Number(a), Number(b)),
      ([, a = '', b = '']) => `${plural('registrations', a)} · ${plural('caches', b)}`],
    [/^Manifest: (present|not detected)$/, ([, value = '']) => english.manifest(value === 'present'),
      ([, value = '']) => text(value === 'present' ? 'manifestPresent' : 'manifestMissing')],
    [/^Controlled by service worker: (yes|no)$/, ([, value = '']) => english.controlled(value === 'yes'),
      ([, value = '']) => text(value === 'yes' ? 'controlledYes' : 'controlledNo')],
    [/^Installability issues: (\d+)$/, ([, a = '']) => english.installabilityIssues(Number(a)), ([, a = '']) => text('installabilityIssues', { count: count(a) }, Number(a))],
    [/^Chromium reported a PWA installability issue: (.+)\.$/, ([, issue = '']) => english.installabilityFinding(issue),
      ([, issue = '']) => issue === 'unknown issue' ? text('installabilityUnknown') : text('installabilityFinding', { issue })],
    [/^(\d+) browser-generated issues?$/, ([, a = '']) => english.browserIssues(Number(a)), ([, a = '']) => plural('browserIssues', a)],
    [/^(\d+) errors$/, ([, a = '']) => english.errors(Number(a)), ([, a = '']) => `${count(a)} ${translate('qualityAudit.errors', {}, Number(a))}`],
    [/^(\d+) warnings$/, ([, a = '']) => english.warnings(Number(a)), ([, a = '']) => `${count(a)} ${translate('qualityAudit.warnings', {}, Number(a))}`],
    [/^(\d+) informational$/, ([, a = '']) => english.informational(Number(a)), ([, a = '']) => `${count(a)} ${translate('qualityAudit.information', {}, Number(a))}`]
  ]

  /** A category summary, an evidence line or a finding message. */
  function sentence(value: string): string {
    const fixed = FIXED_TEXT.get(value)
    if (fixed) return translate(`qualityAuditText.fixed.${fixed}`)
    for (const [pattern, rebuild, localize] of sentences) {
      const match = pattern.exec(value)
      if (match && rebuild(match) === value) return localize(match)
    }
    return value
  }

  function categoryLabel(category: Pick<BrowserQualityAuditCategory, 'id' | 'label'>): string {
    const known = Object.hasOwn(QUALITY_AUDIT_CATEGORY_LABELS, category.id)
    return known && QUALITY_AUDIT_CATEGORY_LABELS[category.id] === category.label ? translate(`qualityAuditText.categories.${category.id}`) : category.label
  }

  function findingCategory(id: string): string {
    return Object.hasOwn(QUALITY_AUDIT_CATEGORY_LABELS, id) ? translate(`qualityAuditText.categories.${id}`) : id
  }

  function finding(value: BrowserQualityAuditFinding): string {
    if (value.category === 'browser-issues' && Object.hasOwn(INSPECTOR_ISSUE_METADATA, value.code) && INSPECTOR_ISSUE_METADATA[value.code]?.title === value.message) {
      return translate(`browserIssueTitles.${value.code}`)
    }
    if (value.category === 'metadata') {
      if (Object.hasOwn(METADATA_ISSUES, value.code)) return translate(`pageMetadata.issues.${METADATA_ISSUES[value.code]}.message`)
      const field = value.code === 'incomplete-open-graph' ? /^Open Graph metadata is missing (og:[a-z:_]+)\.$/.exec(value.message)?.[1] : undefined
      if (field) return translate('pageMetadata.issues.incompleteOpenGraph.message', { field })
      const blocks = value.code === 'invalid-json-ld' ? /^(\d+) JSON-LD block\(s\) could not be parsed\.$/.exec(value.message)?.[1] : undefined
      if (blocks) return translate('pageMetadata.issues.invalidJsonLd.message', { count: count(blocks) }, Number(blocks))
      return value.message
    }
    return sentence(value.message)
  }

  return {
    categoryLabel,
    findingCategory,
    status: (value: string) => STATUSES.has(value) ? translate(`qualityAuditText.statuses.${value}`) : value.replace('-', ' '),
    severity: (value: string) => SEVERITIES.has(value) ? translate(`qualityAuditText.severities.${value}`) : value,
    sentence,
    finding,
    caveat: (value: string) => {
      const key = CAVEATS.get(value)
      return key ? translate(`qualityAuditText.caveats.${key}`) : value
    }
  }
}
