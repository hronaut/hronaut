import { buildBrowserSecurityReport } from '../../../shared/security-report.js'
import { redactNetworkUrl } from '../../../shared/network-details.js'
import type { BrowserSecurityReport } from '../../../shared/types.js'
import { isHronautHomeUrl } from '../url.js'
import type { PageAuditsAccess, PageAuditsTab } from './page-audits-access.js'

/** The connection security of the tab's page, from its latest security snapshot. */
export function securityReport<Tab extends PageAuditsTab>(access: PageAuditsAccess<Tab>, tabId?: string): BrowserSecurityReport {
  const tab = access.getTab(tabId)
  if (isHronautHomeUrl(tab.url)) throw new Error('Open a website tab before inspecting connection security')
  const snapshot = tab.securitySnapshot
  return buildBrowserSecurityReport({
    tabId: tab.id,
    url: redactNetworkUrl(tab.url),
    title: tab.title,
    checkedAt: snapshot?.checkedAt,
    securityState: snapshot?.state,
    protocol: snapshot?.protocol,
    details: snapshot?.details
  })
}
