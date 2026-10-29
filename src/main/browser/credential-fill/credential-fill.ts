import {
  credentialFillContext,
  isCurrentCredentialFillContext,
  type CredentialFillContext
} from '../credential-fill-context.js'
import { credentialFillPageScript, isCredentialFillPageResult } from '../credential-fill-page.js'
import type { Browser } from '../browser.js'
import { getTab } from '../browser-core.js'
import { withAgentInput } from '../agent-input-scope/agent-input-scope.js'
import { recordTrustedCredentialFill } from '../trusted-credential-fill.js'

/** What a credential fill must still match: the active tab's address, navigation and selection; null when the tab is not active. */
export function credentialContext(browser: Browser, tabId?: string): CredentialFillContext | null {
  const tab = getTab(browser, tabId)
  if (tab.id !== browser.activeTabId) return null
  return credentialFillContext(tab.url, tab.navigationGeneration, browser.tabSelectionGeneration)
}

/**
 * Fills a saved username and password into the tab's page as agent input,
 * only while the tab still matches the context the fill was offered for. It
 * reports whether the page filled them, recording a fill as the person's
 * interaction with the tab.
 */
export async function fillCredential(
  browser: Browser,
  tabId: string,
  expectedContext: CredentialFillContext,
  username: string,
  password: string
): Promise<boolean> {
  const tab = getTab(browser, tabId)
  if (!isCurrentCredentialFillContext(expectedContext, credentialContext(browser, tabId))) return false
  const script = credentialFillPageScript(expectedContext, username, password)
  const outcome: unknown = await withAgentInput(
    browser,
    tab.webContents,
    () => tab.webContents.executeJavaScript(script, true)
  )
  if (!isCredentialFillPageResult(outcome)) return false
  return recordTrustedCredentialFill(outcome, tab, Date.now(), browser.options.onUserInteraction)
}
