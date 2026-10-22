import { LocalizedError } from '../../localized-error.js'
import { isHronautHomeUrl } from '../url.js'
import type { PagePrintAccess, PagePrintTab } from './page-print-access.js'

/**
 * Opens the system's print dialog for the tab's page, as Chrome's Print does: the person picks a printer there, or
 * saving as PDF. The dialog holds the page still until it closes, so nothing opens for a page an agent is typing or
 * clicking in right now, one whose human input lock holds the person's input back, one behind trusted chrome or with
 * a screenshot area or element pick under way, nor while the page's dialog is already open. Hronaut Home, a sleeping
 * page and a page whose renderer is gone print nothing either. A page an agent is working on is refused with a reason,
 * since the agent would stall until the dialog closed: taking it over or pausing its agents lets it print. Resolves once
 * the dialog closes, also when the person cancels it or the page goes away; a print that fails rejects.
 */
export function printPage<Tab extends PagePrintTab>(access: PagePrintAccess<Tab>, tab: Tab): Promise<void> {
  const webContents = tab.webContents
  if (webContents.isDestroyed() || webContents.isCrashed() || tab.sleeping || isHronautHomeUrl(tab.url)) return Promise.resolve()
  if (
    access.browserContentOccluded()
    || access.isHumanInteractionLocked(tab)
    || access.agentInputWebContents().has(webContents.id)
    || access.nativeSelectionUnderWay(webContents.id)
  ) return Promise.resolve()
  const printing = access.printingWebContents()
  const id = webContents.id
  if (printing.has(id)) return Promise.resolve()
  if (access.agentWorkingOn(tab)) return Promise.reject(new LocalizedError('appErrors.page.printAgentWorking'))
  printing.add(id)
  return new Promise((resolve, reject) => {
    let settled = false
    const settle = (failure?: unknown): void => {
      if (settled) return
      settled = true
      printing.delete(id)
      webContents.removeListener('render-process-gone', pageGone)
      webContents.removeListener('destroyed', pageGone)
      if (failure === undefined) resolve()
      else reject(failure)
    }
    // Electron may not answer for a page that goes away meanwhile, which would otherwise keep it from printing again.
    const pageGone = (): void => settle()
    webContents.once('render-process-gone', pageGone)
    webContents.once('destroyed', pageGone)
    try {
      webContents.print({}, (success, failureReason) => {
        // Electron reports the person's Cancel as a failure too.
        if (success || /cancel/iu.test(failureReason)) {
          settle()
          return
        }
        console.error(`[browser] Could not print the page: ${failureReason}`)
        settle(new LocalizedError('appErrors.page.printFailed'))
      })
    } catch (error) {
      settle(error)
    }
  })
}

/** Prints the page the window shows, for Print in the menu and its key; see printPage. */
export function printShownPage<Tab extends PagePrintTab>(access: PagePrintAccess<Tab>): Promise<void> {
  const tab = access.shownTab()
  return tab ? printPage(access, tab) : Promise.resolve()
}
