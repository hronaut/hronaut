import {
  credentialFillContext,
  isCurrentCredentialFillContext,
  type CredentialFillContext
} from '../credential-fill-context.js'
import { credentialFillPageScript, isCredentialFillPageResult } from '../credential-fill-page.js'
import type { CredentialFillAccess, CredentialFillTab } from './credential-fill-access.js'

/** What a credential fill must still match: the active tab's address, navigation and selection; null when the tab is not active. */
export function credentialContext<Tab extends CredentialFillTab>(access: CredentialFillAccess<Tab>, tabId?: string): CredentialFillContext | null {
  const tab = access.getTab(tabId)
  if (tab.id !== access.activeTabId()) return null
  return credentialFillContext(tab.url, tab.navigationGeneration, access.tabSelectionGeneration())
}

/**
 * Fills a saved username and password into the tab's page as agent input,
 * only while the tab still matches the context the fill was offered for. It
 * reports whether the page filled them, recording a fill as the person's
 * interaction with the tab.
 */
export async function fillCredential<Tab extends CredentialFillTab>(
  access: CredentialFillAccess<Tab>,
  tabId: string,
  expectedContext: CredentialFillContext,
  username: string,
  password: string
): Promise<boolean> {
  const tab = access.getTab(tabId)
  if (!isCurrentCredentialFillContext(expectedContext, credentialContext(access, tabId))) return false
  const script = credentialFillPageScript(expectedContext, username, password)
  const outcome: unknown = await access.withAgentInput(
    tab.webContents,
    () => tab.webContents.executeJavaScript(script, true)
  )
  if (!isCredentialFillPageResult(outcome)) return false
  return access.recordTrustedCredentialFill(outcome, tab, Date.now(), access.options().onUserInteraction)
}
