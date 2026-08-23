import { describe, expect, it } from 'vitest'
import { buildBrowserDebugReport, redactDiagnosticText } from '../src/shared/debug-report.js'

describe('debug report', () => {
  it('redacts common secrets and security-related URL fields from copied console evidence', () => {
    const value = redactDiagnosticText(
      'authorization: Bearer top-secret token=private https://example.test/api?token=url-secret&view=kept#fragment'
    )

    expect(value).toContain('authorization: [REDACTED]')
    expect(value).toContain('token=[REDACTED]')
    expect(value).toContain('view=kept')
    expect(value).not.toContain('top-secret')
    expect(value).not.toContain('url-secret')
    expect(value).not.toContain('fragment')
    expect(redactDiagnosticText(value)).toBe(value)
  })

  it('summarizes full bounded histories while returning recent console and failed network evidence', () => {
    const report = buildBrowserDebugReport({
      generatedAt: '2026-08-14T12:00:00.000Z',
      tabId: 'tab-1',
      title: 'Fixture',
      url: 'https://example.test/page?session=private&view=kept#fragment',
      consoleMessages: [
        { timestamp: '2026-08-14T12:00:01.000Z', level: 'info', message: 'ready', lineNumber: 1, sourceId: 'https://example.test/app.js' },
        {
          timestamp: '2026-08-14T12:00:02.000Z',
          firstTimestamp: '2026-08-14T12:00:01.500Z',
          repeatCount: 3,
          level: 'warning',
          message: 'slow',
          lineNumber: 2,
          sourceId: 'https://example.test/app.js'
        },
        {
          timestamp: '2026-08-14T12:00:03.000Z',
          level: 'error',
          message: 'failed password=private',
          lineNumber: 3,
          sourceId: 'https://example.test/app.js',
          stack: [{
            functionName: 'load token=function-secret',
            url: 'https://example.test/app.js?token=stack-secret&view=kept#fragment',
            lineNumber: 3,
            columnNumber: 2
          }]
        }
      ],
      networkRequests: [
        {
          id: 'ok',
          url: 'https://example.test/ok',
          method: 'GET',
          resourceType: 'fetch',
          startedAt: '2026-08-14T12:00:01.000Z',
          completedAt: '2026-08-14T12:00:01.250Z',
          status: 200,
          fromCache: true,
          detailsAvailable: true,
          responseSizeBytes: 120
        },
        {
          id: 'failed',
          url: 'https://example.test/fail?api_key=private',
          method: 'POST',
          resourceType: 'xhr',
          startedAt: '2026-08-14T12:00:02.000Z',
          completedAt: '2026-08-14T12:00:02.750Z',
          status: 503,
          detailsAvailable: true,
          responseSizeBytes: 80
        }
      ],
      options: { maxConsoleMessages: 2, maxNetworkRequests: 5 }
    })

    expect(report).toMatchObject({
      tabId: 'tab-1',
      url: 'https://example.test/page?view=kept&session=%5BREDACTED%5D',
      summary: {
        consoleMessages: 5,
        consoleWarnings: 3,
        consoleErrors: 1,
        networkRequests: 2,
        failedRequests: 1,
        pendingRequests: 0,
        cachedRequests: 1,
        responseBytes: 200
      },
      truncated: { console: true, network: false }
    })
    expect(report.console.map((message) => message.level)).toEqual(['error', 'warning'])
    expect(report.console[1]).toMatchObject({ repeatCount: 3, firstTimestamp: '2026-08-14T12:00:01.500Z' })
    expect(report.console[0]?.message).toBe('failed password=[REDACTED]')
    expect(report.console[0]?.stack?.[0]).toMatchObject({
      functionName: 'load token=[REDACTED]',
      url: 'https://example.test/app.js?view=kept&token=%5BREDACTED%5D'
    })
    expect(JSON.stringify(report.console)).not.toContain('stack-secret')
    expect(report.network).toEqual([
      expect.objectContaining({
        id: 'failed',
        url: 'https://example.test/fail?api_key=%5BREDACTED%5D',
        issue: true,
        durationMs: 750
      })
    ])
  })

  it('can include successful requests explicitly and caps entry limits', () => {
    const report = buildBrowserDebugReport({
      tabId: 'tab-1',
      title: 'Fixture',
      url: 'https://example.test/',
      consoleMessages: [],
      networkRequests: [{
        id: 'ok',
        url: 'https://example.test/ok',
        method: 'GET',
        resourceType: 'document',
        startedAt: '2026-08-14T12:00:00.000Z',
        completedAt: '2026-08-14T12:00:00.010Z',
        status: 200,
        detailsAvailable: true
      }],
      options: { includeSuccessfulRequests: true, maxNetworkRequests: 1_000 }
    })

    expect(report.network).toHaveLength(1)
    expect(report.network[0]).toMatchObject({ id: 'ok', issue: false, durationMs: 10 })
    expect(report.caveats.at(-1)).toContain('successful and failed')
  })

  it('treats explicit zero limits as empty evidence lists', () => {
    const report = buildBrowserDebugReport({
      tabId: 'tab-1',
      title: 'Fixture',
      url: 'https://example.test/',
      consoleMessages: [{
        timestamp: '2026-08-14T12:00:00.000Z',
        level: 'error',
        message: 'failure',
        lineNumber: 1,
        sourceId: 'https://example.test/app.js'
      }],
      networkRequests: [{
        id: 'failed',
        url: 'https://example.test/fail',
        method: 'GET',
        resourceType: 'fetch',
        startedAt: '2026-08-14T12:00:00.000Z',
        completedAt: '2026-08-14T12:00:00.010Z',
        status: 500,
        detailsAvailable: true
      }],
      options: { maxConsoleMessages: 0, maxNetworkRequests: 0 }
    })

    expect(report.console).toEqual([])
    expect(report.network).toEqual([])
    expect(report.summary).toMatchObject({ consoleMessages: 1, failedRequests: 1 })
    expect(report.truncated).toEqual({ console: true, network: true })
  })
})
