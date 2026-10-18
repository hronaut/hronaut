import { buildBrowserQualityAudit } from '../../../shared/quality-audit.js'
import type { BrowserQualityAudit } from '../../../shared/types.js'
import { isHronautHomeUrl } from '../url.js'
import { accessibilityAudit } from './accessibility-audit.js'
import type { PageAuditsAccess, PageAuditsTab } from './page-audits-access.js'
import { performanceReport } from './performance-report.js'
import { securityReport } from './security-report.js'

/**
 * Combines the accessibility, performance, metadata, connection security, PWA
 * and browser issue findings for the tab's page. It throws when the page's
 * address changed before every part finished.
 */
export async function qualityAudit<Tab extends PageAuditsTab>(access: PageAuditsAccess<Tab>, tabId?: string): Promise<BrowserQualityAudit> {
  const tab = access.getTab(tabId)
  if (isHronautHomeUrl(tab.url)) throw new Error('Open a website tab before running a quality audit')
  const auditedUrl = tab.url
  const [accessibility, performance, metadata] = await Promise.all([
    accessibilityAudit(access, { tabId: tab.id, standard: 'wcag-aa', maxViolations: 50, maxNodesPerViolation: 1 }),
    performanceReport(access, { tabId: tab.id, settleMs: 800, action: 'measure' }),
    access.pageMetadata(tab.id)
  ])
  const security = securityReport(access, tab.id)
  const pwa = await access.inspectPwa({ tabId: tab.id, limit: 1 })
  const browserIssues = await access.inspectorIssues(tab.id)
  if (tab.url !== auditedUrl) {
    throw new Error('The page navigated before the quality audit finished; run it again on the current document.')
  }
  return buildBrowserQualityAudit({ accessibility, performance, metadata, security, pwa, browserIssues })
}
