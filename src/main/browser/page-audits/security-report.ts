import { buildBrowserSecurityReport } from '../../../shared/security-report.js'
import { redactNetworkUrl } from '../../../shared/network-details.js'
import type { BrowserSecurityReport } from '../../../shared/types.js'
import { isHronautHomeUrl } from '../url.js'
import type { Browser } from '../browser.js'
import { getTab } from '../browser-core.js'

/** The connection security of the tab's page, from its latest security snapshot. */
export function securityReport(browser: Browser, tabId?: string): BrowserSecurityReport {
  const tab = getTab(browser, tabId)
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
