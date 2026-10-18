import type { BrowserState } from '../../../shared/types.js'
import type { PersonTabCloseAccess, PersonTabCloseTab } from './close-tabs-for-person-access.js'

/**
 * Closes the tab once tab label saves have settled. Without
 * respectBeforeUnload the page cannot keep itself open. With it, the page's
 * beforeunload handlers may ask the person to stay, and a second such close
 * of the same tab joins the one in flight instead of asking again.
 */
export function closeTabAfterLabelSave<Tab extends PersonTabCloseTab>(access: PersonTabCloseAccess<Tab>, tabId: string, ensureReplacement: boolean, respectBeforeUnload: boolean): Promise<BrowserState> {
  if (!respectBeforeUnload) {
    return access.performCloseTab(tabId, ensureReplacement, false, true)
  }
  const tab = access.getTab(tabId)
  const existing = access.pendingHumanTabCloses().get(tabId)
  if (existing?.tab === tab) return existing.operation
  const operation = access.performCloseTab(tabId, ensureReplacement, true, false)
  access.pendingHumanTabCloses().set(tabId, { tab, operation })
  void operation.finally(() => {
    if (access.pendingHumanTabCloses().get(tabId)?.operation === operation) access.pendingHumanTabCloses().delete(tabId)
  }).catch(() => undefined)
  return operation
}
