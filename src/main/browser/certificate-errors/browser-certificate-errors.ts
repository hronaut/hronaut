import { net, type Session } from 'electron'
import type { BrowserState } from '../../../shared/types.js'
import type { Browser } from '../browser.js'
import { getTab } from '../browser-core.js'
import type { BrowserTab } from '../browser-tab.js'
import { browserState, publishChange } from '../browser-state/browser-state.js'
import { certificateProblem } from '../page-load-problem.js'
import { navigate } from '../page-navigation/page-navigation.js'
import { answerCertificateError, certificateRefusal, proceedPastCertificateError, type StrictTransportProbe } from './certificate-errors.js'

/** Accepts a certificate Chromium does not trust only when the person chose to trust it, as certificate-errors.ts decides. */
export function answerTabCertificateError(browser: Browser, tab: BrowserTab, event: Electron.Event, url: string, error: string, certificate: Electron.Certificate,
  callback: (trusted: boolean) => void, isMainFrame: boolean): void {
  answerCertificateError({
    probe: (session, probeUrl) => net.request({ url: probeUrl, session: session as Session, redirect: 'manual' }) as StrictTransportProbe,
    changed: () => certificatesChanged(browser, tab)
  }, tab, event, url, error, certificate, callback, isMainFrame)
}

/**
 * Shows what the person can do about the certificate the tab refused, once Hronaut knows whether they can open it, and
 * whether its page is not private.
 */
export function certificatesChanged(browser: Browser, tab: BrowserTab): void {
  if (browser.tabs.get(tab.id) !== tab) return
  const problem = tab.pageProblem
  const refusal = problem?.certificate ? certificateRefusal(tab.webContents, problem.url) : undefined
  if (problem && refusal) {
    tab.pageProblem = certificateProblem(browser.options.getLocale(), problem.url, problem.errorCode ?? 0, problem.errorDescription ?? refusal.error, refusal)
  }
  publishChange(browser, false)
}

/**
 * Asks the person whether to open the page the tab could not open because its website's certificate is not trusted,
 * and opens it if they choose to, as Chrome's "Proceed (unsafe)". Only the shell asks for this, never an agent.
 */
export async function proceedPastTabCertificateError(browser: Browser, tabId: string): Promise<BrowserState> {
  const tab = getTab(browser, tabId)
  const url = tab.pageProblem?.certificate?.canProceed ? tab.pageProblem.url : undefined
  if (url) {
    await proceedPastCertificateError({
      confirm: (question) => browser.options.confirmCertificateException?.(question) ?? Promise.resolve(false),
      open: (pageUrl) => navigate(browser, pageUrl, tab.id, { byPerson: true })
    }, tab, url)
  }
  return browserState(browser)
}
