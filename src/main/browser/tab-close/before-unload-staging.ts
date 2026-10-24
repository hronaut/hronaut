import type { BeforeUnloadStagingAccess, BeforeUnloadStagingTab } from './before-unload-staging-access.js'

/**
 * Takes the closing page out of view while its beforeunload handler runs: the
 * replacement page, if any, is shown in its place. Cleanup removes a
 * replacement the person did not keep selected; rollback also brings the
 * page back when its close was prevented or failed, and gives it the keyboard
 * when focusPage and it is the active tab.
 */
export function stageBeforeUnloadClose<Tab extends BeforeUnloadStagingTab>(access: BeforeUnloadStagingAccess<Tab>, tab: Tab): {
  targetDetached: boolean
  cleanup: () => void
  rollback: (focusPage: boolean) => void
} {
  const wasActive = tab.id === access.activeTabId()
  const splitPartnerId = access.splitViewContains(tab.id)
    ? (access.splitView()!.firstTabId === tab.id ? access.splitView()!.secondTabId : access.splitView()!.firstTabId)
    : null
  if (!wasActive && !splitPartnerId) {
    return { targetDetached: false, cleanup: () => undefined, rollback: () => undefined }
  }

  const bounds = tab.view.getBounds()
  const visible = tab.view.getVisible()
  const nextId = access.closeTabTransition(tab).nextId
  const replacement = wasActive && !splitPartnerId && nextId
    ? access.findTab(nextId)
    : undefined
  let replacementWasAttached = false
  access.window().contentView.removeChildView(tab.view)
  try {
    if (replacement && !replacement.webContents.isDestroyed()) {
      access.window().contentView.addChildView(replacement.view)
      replacementWasAttached = true
      // The closing tab's bounds can be sized for its own emulated viewport, or fill the window in full screen.
      replacement.view.setBounds(access.tabViewBounds(replacement, access.contentAreaBounds()))
      access.roundPageCorners(replacement.view)
      replacement.view.setVisible(visible)
    }
  } catch (error) {
    if (replacementWasAttached && replacement && !replacement.webContents.isDestroyed()) {
      access.window().contentView.removeChildView(replacement.view)
    }
    if (!tab.webContents.isDestroyed()) {
      access.window().contentView.addChildView(tab.view)
      tab.view.setBounds(bounds)
      tab.view.setVisible(visible)
    }
    throw error
  }
  // The closing tab's frame and caption leave with its page.
  access.publishPageGeometry()

  const cleanup = (): void => {
    // A user can select another page while Chromium runs beforeunload.
    // Restore only the views owned by the current selection, not the
    // selection that existed when the close probe started.
    if (
      replacementWasAttached && replacement && !replacement.webContents.isDestroyed()
      && access.activeTabId() !== replacement.id && !access.splitViewContains(replacement.id)
    ) {
      access.window().contentView.removeChildView(replacement.view)
      replacementWasAttached = false
    }
  }
  return {
    targetDetached: true,
    cleanup,
    rollback: (focusPage) => {
      cleanup()
      if (tab.webContents.isDestroyed() || access.findTab(tab.id) !== tab) return
      if (access.activeTabId() === tab.id || access.splitViewContains(tab.id)) {
        access.window().contentView.addChildView(tab.view)
      }
      access.layout()
      if (focusPage && access.activeTabId() === tab.id) access.focusTabOrTrustedChrome(tab)
    }
  }
}
