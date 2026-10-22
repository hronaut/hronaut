import type { BrowserState } from '../../../shared/types.js'
import { isBrowserSplitOrientation, normalizeSplitViewRatio, type BrowserSplitOrientation } from '../../../shared/split-view.js'
import { isHronautHomeUrl } from '../url.js'
import type { SplitViewAccess, SplitViewTab } from './split-view-access.js'
import { LocalizedError } from '../../localized-error.js'

/**
 * Wakes the active tab and the chosen one, then opens them side by side,
 * unless the person selected another tab, changed the split view or closed
 * either tab meanwhile. Such a newer action wins: this one then returns the
 * state without opening, even when a wake failed. Asking for the split view
 * is itself a selection, so a tab still waking for an earlier one stays out.
 */
export async function openSplitViewAndWait<Tab extends SplitViewTab>(access: SplitViewAccess<Tab>, tabId: string): Promise<BrowserState> {
  const current = access.getActiveTab()
  const target = access.getTab(tabId)
  if (current.id === target.id) throw new LocalizedError('appErrors.splitView.sameTab')
  if (isHronautHomeUrl(current.url) || isHronautHomeUrl(target.url)) throw new LocalizedError('appErrors.splitView.home')
  if (current.webContents.isDestroyed()) {
    throw new LocalizedError('appErrors.splitView.currentUnavailable')
  }
  if (target.webContents.isDestroyed()) {
    throw new LocalizedError('appErrors.splitView.selectedUnavailable')
  }
  access.writeSplitViewGeneration(access.splitViewGeneration() + 1)
  access.writeTabSelectionGeneration(access.tabSelectionGeneration() + 1)
  const splitGeneration = access.splitViewGeneration()
  const selectionGeneration = access.tabSelectionGeneration()
  const superseded = () => splitGeneration !== access.splitViewGeneration()
    || selectionGeneration !== access.tabSelectionGeneration()
    || access.activeTabId() !== current.id
    || access.findTab(current.id) !== current
    || access.findTab(target.id) !== target
  try {
    await Promise.all([
      access.wakeTab(current.id),
      access.wakeTab(target.id)
    ])
  } catch (error) {
    if (superseded()) return access.getState()
    // The request was still a selection, which the published state shows, such as no longer marking a followed agent.
    access.changed(false)
    throw error
  }
  if (superseded()) return access.getState()
  return openSplitView(access, target.id)
}

/**
 * Shows the chosen tab beside the active one, replacing any other split, and
 * wakes either tab that sleeps without waiting for it.
 */
export function openSplitView<Tab extends SplitViewTab>(access: SplitViewAccess<Tab>, tabId: string): BrowserState {
  const current = access.getActiveTab()
  const target = access.getTab(tabId)
  if (current.id === target.id) throw new LocalizedError('appErrors.splitView.sameTab')
  if (isHronautHomeUrl(current.url) || isHronautHomeUrl(target.url)) throw new LocalizedError('appErrors.splitView.home')
  // A WebContentsView can outlive its WebContents when Electron or DevTools
  // tears the renderer down independently. Validate both panes before
  // mutating split state; addChildView/setBounds throw native exceptions for
  // a destroyed child and would otherwise leave splitView half-applied.
  if (current.webContents.isDestroyed()) {
    throw new LocalizedError('appErrors.splitView.currentUnavailable')
  }
  if (target.webContents.isDestroyed()) {
    throw new LocalizedError('appErrors.splitView.selectedUnavailable')
  }
  access.writeSplitViewGeneration(access.splitViewGeneration() + 1)
  current.lastActiveAt = Date.now()
  target.lastActiveAt = Date.now()
  if (current.sleeping) void access.wakeTab(current.id).catch((error) => console.error('[browser] Could not wake split tab:', error))
  if (target.sleeping) void access.wakeTab(target.id).catch((error) => console.error('[browser] Could not wake split tab:', error))

  if (access.splitView()) {
    for (const visibleTabId of [access.splitView()!.firstTabId, access.splitView()!.secondTabId]) {
      const visibleTab = access.findTab(visibleTabId)
      if (visibleTab && visibleTab.id !== current.id && visibleTab.id !== target.id) {
        // It was in view until now, so Memory Saver counts its inactivity from here.
        visibleTab.lastActiveAt = Date.now()
        access.removeChildView(visibleTab.view)
      }
    }
  }
  access.writeSplitView({
    firstTabId: current.id,
    secondTabId: target.id,
    orientation: 'vertical',
    ratio: 0.5
  })
  access.addChildView(target.view)
  access.layout()
  access.focusTabOrTrustedChrome(current)
  access.changed()
  return access.getState()
}

/** Changes the open split view's orientation or ratio, or swaps its tabs. */
export function updateSplitView<Tab extends SplitViewTab>(access: SplitViewAccess<Tab>, updates: { orientation?: BrowserSplitOrientation; ratio?: number; swap?: boolean }): BrowserState {
  if (!access.splitView()) throw new LocalizedError('appErrors.splitView.notOpen')
  if (updates.orientation !== undefined && !isBrowserSplitOrientation(updates.orientation)) {
    throw new TypeError('Split orientation must be vertical or horizontal.')
  }
  if (updates.ratio !== undefined && !Number.isFinite(updates.ratio)) throw new TypeError('Split ratio must be a finite number.')
  access.cancelSplitDivider()
  access.writeSplitViewGeneration(access.splitViewGeneration() + 1)
  if (updates.orientation !== undefined) access.splitView()!.orientation = updates.orientation
  if (updates.ratio !== undefined) access.splitView()!.ratio = normalizeSplitViewRatio(updates.ratio)
  if (updates.swap) {
    const firstTabId = access.splitView()!.firstTabId
    access.splitView()!.firstTabId = access.splitView()!.secondTabId
    access.splitView()!.secondTabId = firstTabId
  }
  access.layout()
  access.changed()
  return access.getState()
}

/** Leaves only the active tab of the split view in view. */
export function closeSplitView<Tab extends SplitViewTab>(access: SplitViewAccess<Tab>): BrowserState {
  access.writeSplitViewGeneration(access.splitViewGeneration() + 1)
  if (!access.splitView()) return access.getState()
  const activeTab = access.getActiveTab()
  const otherTabId = access.splitView()!.firstTabId === activeTab.id
    ? access.splitView()!.secondTabId
    : access.splitView()!.firstTabId
  const otherTab = access.findTab(otherTabId)
  if (otherTab) {
    // It was in view until now, so Memory Saver counts its inactivity from here.
    otherTab.lastActiveAt = Date.now()
    access.removeChildView(otherTab.view)
  }
  access.writeSplitView(null)
  access.layout()
  access.focusTabOrTrustedChrome(activeTab)
  access.changed()
  return access.getState()
}
