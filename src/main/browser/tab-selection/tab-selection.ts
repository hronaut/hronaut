import type { BrowserState } from '../../../shared/types.js'
import { LocalizedError } from '../../localized-error.js'
import type { BrowserTabSelectionOptions, TabSelectionAccess, TabSelectionTab } from './tab-selection-access.js'

/**
 * Selects a tab after waking it. A selection made while it wakes, or the tab
 * closing, wins: this one then returns the state without selecting.
 */
export async function selectTabAndWait<Tab extends TabSelectionTab>(access: TabSelectionAccess<Tab>, tabId: string, options: BrowserTabSelectionOptions = {}): Promise<BrowserState> {
  const next = access.getTab(tabId)
  if (next.webContents.isDestroyed()) {
    throw new LocalizedError('appErrors.tabs.rendererUnavailable')
  }
  access.writeTabSelectionGeneration(access.tabSelectionGeneration() + 1)
  const selectionGeneration = access.tabSelectionGeneration()
  if (next.sleeping || next.wakePromise) {
    try {
      await access.wakeTab(next.id)
    } catch (error) {
      if (
        selectionGeneration !== access.tabSelectionGeneration()
        || access.findTab(next.id) !== next
      ) return access.getState()
      throw error
    }
  }
  if (
    selectionGeneration !== access.tabSelectionGeneration()
    || access.findTab(next.id) !== next
  ) return access.getState()
  return selectTab(access, next.id, options)
}

/**
 * Wakes an agent's tab and makes it its workspace's active tab without
 * showing it. Follow agents shows it through the agent's call on it, so it
 * waits as for any call, such as while a page fills the window. Another
 * active tab in its workspace while it wakes, such as the person's pick, or
 * the tab closing, wins: this one then returns the state without marking it.
 * A selection in another workspace does not stop it.
 */
export async function selectAgentTabAndWait<Tab extends TabSelectionTab>(access: TabSelectionAccess<Tab>, tabId: string): Promise<BrowserState> {
  const tab = access.getTab(tabId)
  if (tab.webContents.isDestroyed()) {
    throw new Error('This tab renderer is no longer available. Close the tab and reopen it from Recently closed.')
  }
  const workspaceActiveTabId = access.workspaceActiveTabId(tab)
  await access.wakeTab(tabId)
  if (access.findTab(tabId) !== tab || workspaceActiveTabId !== access.workspaceActiveTabId(tab)) return access.getState()
  if (tab.webContents.isDestroyed()) {
    throw new Error('This tab renderer is no longer available. Close the tab and reopen it from Recently closed.')
  }
  access.markTabActiveInGroup(tab)
  access.changed()
  return access.getState()
}

/**
 * Shows a tab in the window, waking it if it sleeps. A pane of the open split
 * view becomes the active pane, and the other pane in full screen, which hides
 * it, is asked to leave full screen; any other tab replaces the split view or
 * the current tab.
 */
export function selectTab<Tab extends TabSelectionTab>(access: TabSelectionAccess<Tab>, tabId: string, options: BrowserTabSelectionOptions = {}): BrowserState {
  const next = access.getTab(tabId)
  if (next.webContents.isDestroyed()) {
    throw new LocalizedError('appErrors.tabs.rendererUnavailable')
  }
  access.writeTabSelectionGeneration(access.tabSelectionGeneration() + 1)
  next.lastActiveAt = Date.now()
  if (next.sleeping) void access.wakeTab(next.id).catch((error) => console.error('[browser] Could not wake selected tab:', error))
  if (access.splitView() && access.splitViewContains(tabId)) {
    access.exitPageFullscreenCovering(next.id)
    access.writeActiveTabId(next.id)
    access.markTabActiveInGroup(next)
    access.layout()
    if (options.focus !== false) access.focusTabOrTrustedChrome(next)
    access.changed()
    return access.getState()
  }
  const current = access.activeTabId() ? access.findTab(access.activeTabId()!) : undefined
  if (access.splitView()) {
    for (const visibleTabId of [access.splitView()!.firstTabId, access.splitView()!.secondTabId]) {
      const visibleTab = access.findTab(visibleTabId)
      if (visibleTab && visibleTab.id !== next.id) access.window().contentView.removeChildView(visibleTab.view)
    }
    access.writeSplitView(null)
  } else if (current && current.id !== next.id) {
    access.window().contentView.removeChildView(current.view)
  }
  if (current?.id !== next.id) access.window().contentView.addChildView(next.view)
  access.writeActiveTabId(next.id)
  access.markTabActiveInGroup(next)
  access.layout()
  if (options.focus !== false) access.focusTabOrTrustedChrome(next)
  access.changed()
  return access.getState()
}
