import type { NativeSelectionsAccess, NativeSelectionsTab } from './native-selections-access.js'

/**
 * Ends the screenshot area selection and the element picker in progress on
 * the tab's page, as canceled, as the tab closes, its page navigates or is
 * destroyed, or its renderer goes away. When either was in progress and the
 * person's input is locked, the page's human input guard is applied again
 * without waiting for it.
 */
export function cancelNativeSelectionSessions<Tab extends NativeSelectionsTab>(access: NativeSelectionsAccess<Tab>, tab: Tab): void {
  const webContentsId = tab.webContents.id
  const screenshotSession = access.screenshotAreaSessions().get(webContentsId)
  if (screenshotSession) {
    screenshotSession.canceled = true
    screenshotSession.resolve({ canceled: true })
    access.screenshotAreaSessions().delete(webContentsId)
  }
  const elementPickerSession = access.elementPickerSessions().get(webContentsId)
  if (elementPickerSession) {
    elementPickerSession.canceled = true
    elementPickerSession.resolve({ canceled: true })
    access.elementPickerSessions().delete(webContentsId)
  }
  if ((screenshotSession || elementPickerSession) && access.isHumanInteractionLocked(tab)) {
    void access.syncHumanInteractionInputGuard(tab).catch(() => undefined)
  }
}
