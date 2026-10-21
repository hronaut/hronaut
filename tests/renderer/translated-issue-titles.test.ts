import { render, screen } from '@testing-library/vue'
import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import DiagnosticsPanels from '../../src/renderer/src/features/diagnostics/DiagnosticsPanels.vue'
import { useDiagnosticsController } from '../../src/renderer/src/features/diagnostics/useDiagnosticsController.js'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import { INSPECTOR_ISSUE_METADATA, normalizeInspectorIssue } from '../../src/shared/browser-issues.js'
import { SUPPORTED_LOCALES } from '../../src/shared/locale.js'
import { browserIssueTitleMessages } from '../../src/shared/locales/browser-issue-titles.js'
import type { BrowserInspectorIssue, BrowserInspectorIssuesReport, BrowserTabState } from '../../src/shared/types.js'

type DiagnosticsBrowser = Parameters<typeof useDiagnosticsController>[0]['browser']

const tab = {
  id: 'tab-1', title: 'Example', url: 'https://example.test/app', loading: false, navigationGeneration: 0,
  canGoBack: false, canGoForward: false, active: true, pinned: false, sleeping: false, humanInteractionLocked: false,
  preserveDiagnosticLogs: false, zoomPercent: 100, audible: false, muted: false, devToolsOpen: false
} satisfies BrowserTabState

function issue(code: string): BrowserInspectorIssue {
  return normalizeInspectorIssue({ code, issueId: code, details: {} }, '2026-09-15T10:00:00.000Z')!
}

function report(issues: BrowserInspectorIssue[]): BrowserInspectorIssuesReport {
  return {
    tabId: 'tab-1', url: 'https://example.test/app', title: 'Example', capturedAt: '2026-09-15T10:00:01.000Z',
    issueCount: issues.length, errorCount: 1, warningCount: 1, infoCount: issues.length - 2, issues, truncated: false,
    authChallenges: [], authChallengesTruncated: false, devToolsOpen: false, caveats: []
  }
}

describe('browser issue titles in the interface language', () => {
  it('names every known issue code in every language, with English matching the MCP title', () => {
    const codes = Object.keys(INSPECTOR_ISSUE_METADATA).sort()
    for (const locale of SUPPORTED_LOCALES) expect(Object.keys(browserIssueTitleMessages[locale]).sort()).toEqual(codes)
    for (const code of codes) {
      expect(browserIssueTitleMessages['en-US'][code as keyof (typeof browserIssueTitleMessages)['en-US']]).toBe(INSPECTOR_ISSUE_METADATA[code].title)
    }
  })

  it('derives a title for an unknown code, even one named like an object property, and keeps English for MCP', () => {
    expect(issue('CookieIssue')).toMatchObject({ title: 'Cookie compatibility problem', severity: 'warning' })
    expect(issue('FutureSignalIssue')).toMatchObject({ title: 'Future Signal', severity: 'info' })
    expect(issue('toString')).toMatchObject({ title: 'to String', severity: 'info' })
    expect(issue('constructor')).toMatchObject({ title: 'constructor', severity: 'info' })
  })

  it('shows known issue headlines in German and keeps the derived title for an unknown code', async () => {
    const issues = [issue('MixedContentIssue'), issue('CookieIssue'), issue('FutureSignalIssue'), issue('constructor')]
    const browser: DiagnosticsBrowser = {
      measurePerformance: vi.fn(), inspectDesign: vi.fn(), inspectPageMetadata: vi.fn(), inspectSecurity: vi.fn(),
      manageCodeCoverage: vi.fn(), manageCpuProfile: vi.fn(), measureMemory: vi.fn(), createDebugReport: vi.fn(),
      manageRepro: vi.fn(), manageDomChanges: vi.fn(), visualCompare: vi.fn(), copyVisualDiff: vi.fn(),
      listInspectorIssues: vi.fn(async () => report(issues)), runAccessibilityAudit: vi.fn(), runQualityAudit: vi.fn()
    }
    const controller = useDiagnosticsController({
      activeTab: ref<BrowserTabState | undefined>(tab), browser, translate: key => key,
      copyText: async () => true, closeTransientPanels: vi.fn(), keepsSeparatePanelOpen: () => false
    })
    const view = render(DiagnosticsPanels, {
      global: { plugins: [createHronautI18n('de-DE')] },
      props: {
        dock: 'right', activeTab: tab, locale: 'de-DE', controller,
        openSupport: vi.fn(async () => undefined), preservationBusy: false, updatePreservation: vi.fn(), keepsSeparatePanelOpen: () => false
      }
    })
    try {
      controller.toggleInspectorIssues()
      await vi.waitFor(() => expect(document.querySelectorAll('.inspector-issue')).toHaveLength(4))
      const headlines = [...document.querySelectorAll('.inspector-issue header strong')].map((headline) => headline.textContent)
      expect(headlines).toEqual(['Unsicherer gemischter Inhalt', 'Cookie-Kompatibilitätsproblem', 'Future Signal', 'constructor'])
      expect(screen.getByText('CookieIssue')).toBeInTheDocument()
    } finally {
      view.unmount()
      controller.dispose()
    }
  })
})
