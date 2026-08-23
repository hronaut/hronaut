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
