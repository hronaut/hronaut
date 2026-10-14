import { describe, expect, it } from 'vitest'
import { normalizeInspectorIssue } from '../src/shared/browser-issues.js'

describe('Chromium inspector issue normalization', () => {
  it('turns CORS issues into bounded actionable evidence', () => {
    expect(normalizeInspectorIssue({
      code: 'CorsIssue',
      issueId: 'cors-1',
      details: {
        corsIssueDetails: {
          corsErrorStatus: { corsError: 'MissingAllowOriginHeader' },
          request: { url: 'https://example.test/api?token=private&view=compact#secret' },
          location: { url: 'https://example.test/app.js', lineNumber: 4, columnNumber: 2 }
        }
      }
    }, '2026-08-14T12:00:00.000Z')).toEqual({
      id: 'cors-1',
      code: 'CorsIssue',
      title: 'Cross-origin request problem',
      severity: 'error',
      reasons: ['MissingAllowOriginHeader'],
      affectedUrls: [
        'https://example.test/api?view=compact&token=%5BREDACTED%5D',
        'https://example.test/app.js'
      ],
      firstSeenAt: '2026-08-14T12:00:00.000Z'
    })
  })

  it('keeps source locations while excluding raw cookie lines and non-web URLs', () => {
    const issue = normalizeInspectorIssue({
      code: 'CookieIssue',
      details: {
        cookieIssueDetails: {
          rawCookieLine: 'session=private',
          cookieWarningReasons: ['WarnSameSiteUnspecifiedCrossSiteContext'],
          operation: 'SetCookie',
          cookieUrl: 'https://example.test/auth?password=private',
          sourceCodeLocation: { url: 'https://example.test/app.js?api_key=private', lineNumber: 8, columnNumber: 1 },
          ignored: { url: 'data:text/plain,private' }
        }
      }
    }, '2026-08-14T12:00:00.000Z')

    expect(issue).toMatchObject({
      code: 'CookieIssue',
      severity: 'warning',
      reasons: ['WarnSameSiteUnspecifiedCrossSiteContext', 'SetCookie'],
      affectedUrls: [
        'https://example.test/auth?password=%5BREDACTED%5D',
        'https://example.test/app.js?api_key=%5BREDACTED%5D'
      ],
      source: {
        url: 'https://example.test/app.js?api_key=%5BREDACTED%5D',
        lineNumber: 9,
        columnNumber: 2
      }
    })
    expect(JSON.stringify(issue)).not.toContain('session=private')
    expect(JSON.stringify(issue)).not.toContain('data:text/plain')
  })

  it('rejects malformed issues and gives unknown issue codes a safe fallback', () => {
    expect(normalizeInspectorIssue(null)).toBeNull()
    expect(normalizeInspectorIssue({ details: {} })).toBeNull()
    expect(normalizeInspectorIssue({ code: 'FutureBrowserIssue', details: {} })).toMatchObject({
      title: 'Future Browser',
      severity: 'info'
    })
  })
})

describe('CSP disposition', () => {
  const csp = (details: unknown, issueId?: string) => normalizeInspectorIssue({ code: 'ContentSecurityPolicyIssue', details, issueId })!
  it.each([[true, 'report-only'], [false, 'enforce'], [undefined, 'unknown'], [null, 'unknown'], ['true', 'unknown'], [0, 'unknown'], [{}, 'unknown']])('uses only literal native booleans (%s)', (isReportOnly, expected) => {
    expect(csp({ contentSecurityPolicyIssueDetails: { isReportOnly } })).toMatchObject({ cspDisposition: expected, severity: 'error' })
  })
  it.each([undefined, null, [], 'true', { isReportOnly: true }, { contentSecurityPolicyIssueDetails: [] }, { contentSecurityPolicyIssueDetails: null }, { other: { contentSecurityPolicyIssueDetails: { isReportOnly: true } } }])('keeps malformed or misplaced evidence unknown (%j)', (details) => {
    expect(csp(details)).toHaveProperty('cspDisposition', 'unknown')
  })
  it('separates fallback identities by disposition and keeps native IDs authoritative', () => {
    const details = (isReportOnly: unknown) => ({ contentSecurityPolicyIssueDetails: { isReportOnly, violatedDirective: 'script-src-elem' } })
    const issues = [true, false, undefined].map((mode) => csp(details(mode)))
    expect(new Set(issues.map((issue) => issue.id)).size).toBe(3)
    expect(csp(details(true)).id).toBe(issues[0]!.id)
    for (const mode of [true, false, undefined]) expect(csp(details(mode), 'native-id').id).toBe('native-id')
    for (const invalidId of ['', 'x'.repeat(257)]) expect(csp(details(true), invalidId).id).toBe(issues[0]!.id)
  })
  it('leaves non-CSP shape and fallback identity unchanged despite misleading flags', () => {
    const issue = normalizeInspectorIssue({ code: 'CorsIssue', details: { contentSecurityPolicyIssueDetails: { isReportOnly: true } } })!
    expect(issue.id).toBe('CorsIssue|')
    expect(issue).not.toHaveProperty('cspDisposition')
  })
  it('adds only bounded disposition while preserving redaction and payload omissions', () => {
    const issue = csp({ contentSecurityPolicyIssueDetails: { isReportOnly: true, blockedURL: 'https://example.test/a?token=secret#fragment', violatedDirective: 'img-src', originalPolicy: 'private-policy', source: 'private-source' } })
    expect(issue).toHaveProperty('cspDisposition', 'report-only')
    expect(issue.affectedUrls).toEqual(['https://example.test/a?token=%5BREDACTED%5D'])
    expect(JSON.stringify(issue)).not.toMatch(/secret|fragment|private-policy|private-source|originalPolicy|isReportOnly/)
  })
})
