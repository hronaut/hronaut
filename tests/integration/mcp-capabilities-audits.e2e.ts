import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, test, text } from './capability-fixtures.js'

test('reports accessibility, quality and performance with human panels', async ({ capabilities, appWindow }) => {
  const { client, tabId, openPageTool } = capabilities
  const accessibilityResult = await client.callTool({
    name: 'browser_accessibility_audit',
    arguments: {
      tabId,
      selector: '#audit-scope',
      standard: 'wcag-aa',
      maxViolations: 5,
      maxNodesPerViolation: 2
    }
  }) as CallToolResult
  expect(accessibilityResult.isError, text(accessibilityResult)).not.toBe(true)
  const accessibilityAudit = JSON.parse(text(accessibilityResult))
  expect(accessibilityAudit).toMatchObject({
    tabId,
    action: 'measure',
    standard: 'wcag-aa',
    scope: { selector: '#audit-scope', maxViolations: 5, maxNodesPerViolation: 2 },
    engine: { name: 'axe-core', version: '4.13.0' }
  })
  expect(accessibilityAudit.violationCount).toBeGreaterThan(0)
  expect(accessibilityAudit.violations).toEqual(expect.arrayContaining([
    expect.objectContaining({
      id: 'button-name',
      impact: 'critical',
      nodes: [expect.objectContaining({ targets: expect.arrayContaining(['#unnamed-button']) })]
    })
  ]))
  expect(JSON.stringify(accessibilityAudit)).not.toContain('<button')
  const pageAuditGlobal = await client.callTool({
    name: 'browser_evaluate',
    arguments: { tabId, script: 'typeof window.axe' }
  }) as CallToolResult
  expect(text(pageAuditGlobal)).toBe('undefined')

  await openPageTool('Run accessibility audit')
  const accessibilityPanel = appWindow.getByRole('dialog', { name: 'Accessibility' })
  await expect(accessibilityPanel).toBeVisible()
  await expect(accessibilityPanel).toContainText('button-name')
  await expect(accessibilityPanel).toContainText('critical')
  await accessibilityPanel.getByRole('button', { name: 'Close accessibility audit' }).click()
  await expect(accessibilityPanel).toBeHidden()
  await appWindow.getByRole('button', { name: 'Page tools' }).click()
  const pageToolsAfterAudit = appWindow.getByRole('dialog', { name: 'Page tools' })
  const storageAction = pageToolsAfterAudit.getByRole('button', { name: 'Site storage for 127.0.0.1' })
  const accessibilityAction = pageToolsAfterAudit.getByRole('button', { name: /Accessibility audit:/ })
  await expect(accessibilityAction).toHaveClass(/warning/)
  await expect(storageAction).not.toHaveClass(/warning|complete|error|running/)
  await pageToolsAfterAudit.getByRole('button', { name: 'Close page tools' }).click()

  const qualityResult = await client.callTool({
    name: 'browser_quality_audit',
    arguments: { tabId }
  }) as CallToolResult
  expect(qualityResult.isError, text(qualityResult)).not.toBe(true)
  const qualityAudit = JSON.parse(text(qualityResult))
  expect(qualityAudit).toMatchObject({
    tabId,
    status: 'error',
    categories: expect.arrayContaining([
      expect.objectContaining({ id: 'accessibility' }),
      expect.objectContaining({ id: 'performance' }),
      expect.objectContaining({ id: 'metadata' }),
      expect.objectContaining({ id: 'security', status: 'error' }),
      expect.objectContaining({ id: 'pwa' }),
      expect.objectContaining({ id: 'browser-issues' })
    ]),
    caveats: expect.arrayContaining([expect.stringContaining('not a Lighthouse score')])
  })
  expect(qualityAudit.categories).toHaveLength(6)
  expect(JSON.stringify(qualityAudit)).not.toContain('element-inspection-secret')

  await openPageTool(/Quality audit:/)
  const qualityPanel = appWindow.getByRole('dialog', { name: 'Quality audit' })
  await expect(qualityPanel).toBeVisible()
  await expect(qualityPanel).toContainText('Accessibility')
  await expect(qualityPanel).toContainText('Metadata & SEO')
  await expect(qualityPanel.getByRole('button', { name: 'Copy report' })).toBeVisible()
  await qualityPanel.getByRole('button', { name: 'Close quality audit' }).click()

  const performanceWarmup = await client.callTool({
    name: 'browser_performance',
    arguments: { tabId, settleMs: 0, action: 'set-baseline' }
  }) as CallToolResult
  expect(performanceWarmup.isError, text(performanceWarmup)).not.toBe(true)
  const performanceBaseline = JSON.parse(text(performanceWarmup))
  expect(performanceBaseline).toMatchObject({
    tabId,
    action: 'set-baseline',
    baseline: {
      measuredAt: expect.any(String),
      url: expect.stringContaining('127.0.0.1'),
      environment: {
        network: 'none',
        cacheDisabled: false,
        viewport: { width: expect.any(Number), height: expect.any(Number) },
        zoomPercent: 100
      }
    }
  })
  expect(performanceBaseline.comparison).toBeUndefined()
  const longAnimationFrameProbe = await client.callTool({
    name: 'browser_evaluate',
    arguments: { tabId, script: 'window.runLongAnimationFrameProbe()' }
  }) as CallToolResult
  expect(longAnimationFrameProbe.isError, text(longAnimationFrameProbe)).not.toBe(true)
  const layoutShiftProbe = await client.callTool({
    name: 'browser_evaluate',
    arguments: { tabId, script: 'window.runLayoutShiftProbe()' }
  }) as CallToolResult
  expect(layoutShiftProbe.isError, text(layoutShiftProbe)).not.toBe(true)

  const performanceResult = await client.callTool({
    name: 'browser_performance',
    arguments: { tabId, settleMs: 100 }
  }) as CallToolResult
  expect(performanceResult.isError, text(performanceResult)).not.toBe(true)
  const performanceReport = JSON.parse(text(performanceResult))
  expect(performanceReport).toMatchObject({
    tabId,
    action: 'measure',
    scope: 'current-visit',
    engine: { name: 'web-vitals', version: '6.2.2' },
    resources: { count: expect.any(Number) },
    longTasks: { count: expect.any(Number) },
    longAnimationFrames: {
      supported: true,
      count: expect.any(Number),
      frames: expect.any(Array),
      contributors: expect.any(Array)
    },
    userTimings: {
      count: expect.any(Number),
      entries: expect.any(Array),
      truncated: false
    },
    layoutShifts: {
      supported: true,
      count: expect.any(Number),
      scoreSum: expect.any(Number),
      recentInputCount: expect.any(Number),
      entries: expect.any(Array)
    },
    baseline: { measuredAt: performanceBaseline.measuredAt },
    comparison: {
      sameUrl: true,
      sameEnvironment: true,
      metrics: expect.any(Array)
    }
  })
  expect(performanceReport.longAnimationFrames.count).toBeGreaterThan(0)
  expect(performanceReport.longAnimationFrames.longestDurationMs).toBeGreaterThanOrEqual(50)
  expect(performanceReport.longAnimationFrames.contributors.length).toBeGreaterThan(0)
  expect(performanceReport.userTimings.count).toBeGreaterThanOrEqual(3)
  expect(performanceReport.userTimings.entries).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: 'measure', name: 'Long frame probe kept', durationMs: expect.any(Number) })
  ]))
  expect(JSON.stringify(performanceReport.userTimings)).not.toContain('user-timing-secret')
  expect(performanceReport.layoutShifts.count).toBeGreaterThan(0)
  expect(performanceReport.layoutShifts.scoreSum).toBeGreaterThan(0)
  expect(performanceReport.layoutShifts.entries.length).toBeGreaterThan(0)
  expect(performanceReport.comparison.metrics.find((metric: { name: string }) => metric.name === 'LOAF_BLOCKING')).toMatchObject({
    unit: 'ms',
    direction: 'regressed',
    baselineValue: expect.any(Number),
    currentValue: expect.any(Number),
    delta: expect.any(Number)
  })
  expect(performanceReport.comparison.metrics[0]).not.toHaveProperty('value')
  expect(performanceReport.comparison.metrics[0]).not.toHaveProperty('tolerance')
  expect(performanceReport.caveats).toEqual(expect.arrayContaining([
    expect.stringContaining('local current-visit sample')
  ]))
  expect(JSON.stringify(performanceReport)).not.toContain('/api-details')
  const pagePerformanceGlobal = await client.callTool({
    name: 'browser_evaluate',
    arguments: { tabId, script: 'typeof window.__hronautPerformanceCollector + ":" + typeof window.webVitals' }
  }) as CallToolResult
  expect(text(pagePerformanceGlobal)).toBe('undefined:undefined')

  await openPageTool('Measure page performance')
  const performancePanel = appWindow.getByRole('dialog', { name: 'Page performance' })
  await expect(performancePanel).toBeVisible()
  await expect(performancePanel).toContainText('Current visit')
  await expect(performancePanel).toContainText('Resources')
  await expect(performancePanel).toContainText('Long animation frames')
  await expect(performancePanel).toContainText('Top script contributors')
  await expect(performancePanel).toContainText('Layout shifts')
  await expect(performancePanel).toContainText('Largest unexpected shifts')
  await expect(performancePanel).toContainText('User timing')
  await expect(performancePanel).toContainText('Long frame probe kept')
  await expect(performancePanel).toContainText('local sample')
  await expect(performancePanel).toContainText('Compared with baseline')
  await expect(performancePanel.getByRole('button', { name: 'Clear baseline' })).toBeVisible()
  await expect(performancePanel.getByRole('button', { name: 'Replace baseline' })).toBeVisible()
  await performancePanel.getByRole('button', { name: 'Clear baseline' }).click()
  await expect(performancePanel.getByRole('button', { name: 'Save baseline' })).toBeVisible()
  await expect(performancePanel.getByRole('button', { name: 'Clear baseline' })).toBeHidden()
  await performancePanel.getByRole('button', { name: 'Close performance report' }).click()
  await expect(performancePanel).toBeHidden()
})
