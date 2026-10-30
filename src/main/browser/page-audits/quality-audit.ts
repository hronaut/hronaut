import { buildBrowserQualityAudit } from '../../../shared/quality-audit.js'
import type { BrowserQualityAudit } from '../../../shared/types.js'
import { isHronautHomeUrl } from '../url.js'
import { accessibilityAudit } from './accessibility-audit.js'
import type { Browser } from '../browser.js'
import { getTab } from '../browser-core.js'
import { performanceReport } from './performance-report.js'
import { securityReport } from './security-report.js'

/**
 * Combines the accessibility, performance, metadata, connection security, PWA
 * and browser issue findings for the tab's page. It throws when the page's
 * address changed before every part finished.
 */
export async function qualityAudit(browser: Browser, tabId?: string): Promise<BrowserQualityAudit> {
  const tab = getTab(browser, tabId)
  if (isHronautHomeUrl(tab.url)) throw new Error('Open a website tab before running a quality audit')
  const auditedUrl = tab.url
  const [accessibility, performance, metadata] = await Promise.all([
    accessibilityAudit(browser, { tabId: tab.id, standard: 'wcag-aa', maxViolations: 50, maxNodesPerViolation: 1 }),
    performanceReport(browser, { tabId: tab.id, settleMs: 800, action: 'measure' }),
    browser.pageMetadata(tab.id)
  ])
  const security = securityReport(browser, tab.id)
  const pwa = await browser.inspectPwa({ tabId: tab.id, limit: 1 })
  const browserIssues = await browser.inspectorIssues(tab.id)
  if (tab.url !== auditedUrl) {
    throw new Error('The page navigated before the quality audit finished; run it again on the current document.')
  }
  return buildBrowserQualityAudit({ accessibility, performance, metadata, security, pwa, browserIssues })
}
