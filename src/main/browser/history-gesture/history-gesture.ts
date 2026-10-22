import type { HistoryGestureAccess, HistoryGestureTab } from './history-gesture-access.js'

/**
 * Goes back or forward in the shown tab for the person's Back or Forward key or mouse button, as the toolbar's arrows
 * do. Like Control with the wheel, it leaves alone a page behind trusted chrome, which would change unseen behind a
 * dialog such as a wallet approval, a locked tab, a page an agent is sending input to and a page with an area capture
 * or element pick in progress, and does nothing without a shown tab: the press may be a stray one.
 */
export async function historyGesture<Tab extends HistoryGestureTab>(access: HistoryGestureAccess<Tab>, direction: 'back' | 'forward'): Promise<void> {
  const tab = access.shownTab()
  if (!tab || tab.webContents.isDestroyed()) return
  if (access.browserContentOccluded() || access.isHumanInteractionLocked(tab) || access.agentInputWebContents().has(tab.webContents.id)
    || access.nativeSelectionUnderWay(tab.webContents.id)) return
  await access.go(tab.id, direction)
}
