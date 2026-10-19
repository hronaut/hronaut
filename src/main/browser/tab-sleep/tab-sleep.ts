import type { MessageKey } from '../../../shared/i18n.js'
import type { BrowserState } from '../../../shared/types.js'
import { LocalizedError } from '../../localized-error.js'
import { liveRegionRecordingKeepsTabAwake } from '../live-region-recorder.js'
import { localizedLoadFailure } from '../load-failure-error.js'
import { RendererExitedError } from '../renderer-exit-guard.js'
import { isHronautHomeUrl, isWebUrl } from '../url.js'
import type { TabSleepAccess, TabSleepTab } from './tab-sleep-access.js'

// A copy of the tab manager's own check, which its load handling keeps using.
const ABORTED_LOAD_ERROR = -3

function isAbortedLoad(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const details = error as Error & { code?: unknown; errno?: unknown }
  return details.code === ABORTED_LOAD_ERROR
    || details.errno === ABORTED_LOAD_ERROR
    || details.code === 'ERR_ABORTED'
    || /\bERR_ABORTED\b|\(-3\)\s+loading\b/.test(error.message)
}

/** The page a sleeping tab shows in place of its own, which holds no site content. */
const SLEEPING_PAGE_URL = 'data:text/html;charset=utf-8,%3C!doctype%20html%3E%3Cmeta%20charset%3D%22utf-8%22%3E%3Ctitle%3ESleeping%20tab%3C%2Ftitle%3E'

/**
 * Wakes a sleeping tab by restoring the history it slept with, or loading
 * its address, and marks it active now. A wake already running is joined.
 * When restoring fails and no newer navigation took over, the address is
 * loaded again; when that fails too, the tab, if still open, goes back to
 * sleep and the failure is thrown.
 */
export async function wakeTab<Tab extends TabSleepTab>(access: TabSleepAccess<Tab>, tabId: string): Promise<BrowserState> {
  const tab = access.getTab(tabId)
  tab.lastActiveAt = Date.now()
  if (tab.wakePromise) {
    await tab.wakePromise
    return access.getState()
  }
  if (!tab.sleeping) return access.getState()
  const restoreUrl = tab.url
  const navigationHistory = tab.sleepNavigationHistory
  const previousLoading = tab.loading
  const previousSuppressInitialHistory = tab.suppressInitialHistory
  const navigationGeneration = tab.navigationGeneration
  const wake = (async () => {
    tab.sleeping = false
    access.tabOverviewSleepPreviews().delete(tab.id)
    tab.sleepNavigationHistory = undefined
    tab.loading = true
    tab.suppressInitialHistory = true
    access.changed(false)
    try {
      if (navigationHistory?.entries.length) {
        tab.discoveryTitle.restoring(navigationHistory.entries)
        await tab.webContents.navigationHistory.restore(navigationHistory)
      } else {
        await tab.webContents.loadURL(restoreUrl)
      }
    } catch (error) {
      const wakeWasSuperseded = () => access.findTab(tab.id) !== tab
        || tab.webContents.isDestroyed()
        || (tab.navigationGeneration !== navigationGeneration
          && (tab.webContents.isLoading() || tab.webContents.getURL() !== SLEEPING_PAGE_URL))
      // Electron also uses ERR_ABORTED when history restoration fails before
      // starting any replacement navigation. Retry the durable URL in that
      // case; otherwise the tab is marked awake while still showing the
      // internal sleeping page. A real newer navigation remains authoritative.
      if (isAbortedLoad(error) && wakeWasSuperseded()) return
      try {
        await tab.webContents.loadURL(restoreUrl)
      } catch (fallbackError) {
        // A newer navigation can also interrupt the fallback. Preserve its
        // live document instead of restoring the obsolete sleeping state.
        if (isAbortedLoad(fallbackError) && wakeWasSuperseded()) return
        if (access.findTab(tab.id) === tab) {
          tab.sleeping = true
          tab.sleepNavigationHistory = navigationHistory
          tab.loading = previousLoading
          tab.suppressInitialHistory = previousSuppressInitialHistory
          access.changed(false)
        }
        throw localizedLoadFailure(fallbackError)
      }
    }
  })()
  tab.wakePromise = wake
  try {
    await wake
  } finally {
    tab.wakePromise = undefined
  }
  return access.getState()
}

/** Puts the tab to sleep, reporting what keeps it awake, or wakes it. */
export async function setTabSleeping<Tab extends TabSleepTab>(access: TabSleepAccess<Tab>, tabId: string, sleeping: boolean): Promise<BrowserState> {
  const tab = access.getTab(tabId)
  if (sleeping) await putTabToSleep(access, tab, true)
  else await wakeTab(access, tabId)
  return access.getState()
}

/**
 * The tab to show instead when the active tab goes to sleep: the next awake
 * tab after it, then before it, or any other tab when all of them sleep.
 */
export function sleepFallbackTab<Tab extends TabSleepTab>(access: TabSleepAccess<Tab>, tab: Tab): Tab | undefined {
  const ordered = access.orderedTabs()
  const index = ordered.indexOf(tab)
  const candidates = [
    ...ordered.slice(index + 1),
    ...ordered.slice(0, index).reverse()
  ].filter((candidate) => candidate.id !== tab.id && !candidate.webContents.isDestroyed())
  return candidates.find((candidate) => !candidate.sleeping) ?? candidates[0]
}

/**
 * Puts the tab to sleep or wakes it from its context menu. An active tab
 * that may sleep first hands the view to its fallback tab, and gets it back
 * when going to sleep fails.
 */
export async function setTabSleepingFromContextMenu<Tab extends TabSleepTab>(access: TabSleepAccess<Tab>, tabId: string, sleeping: boolean): Promise<void> {
  const tab = access.getTab(tabId)
  if (!sleeping) {
    await wakeTab(access, tab.id)
    return
  }
  if (tab.sleeping) return

  const active = tab.id === access.activeTabId() && !access.splitViewContains(tab.id)
  const fallback = active ? sleepFallbackTab(access, tab) : undefined
  const blockReason = sleepBlockReason(access, tab, active && fallback !== undefined)
  if (blockReason) throw new LocalizedError(blockReason)
  if (!active || !fallback) {
    await putTabToSleep(access, tab, true)
    return
  }

  if (await hasChangedFormState(tab)) {
    throw new LocalizedError('appErrors.sleep.unsavedForm')
  }
  if (access.activeTabId() !== tab.id || access.splitViewContains(tab.id)) {
    await putTabToSleep(access, tab, true)
    return
  }
  const latestFallback = sleepFallbackTab(access, tab)
  const latestBlockReason = sleepBlockReason(access, tab, latestFallback !== undefined)
  if (latestBlockReason) throw new LocalizedError(latestBlockReason)
  if (!latestFallback) throw new LocalizedError('appErrors.sleep.visible')
  access.selectTab(latestFallback.id)
  try {
    await putTabToSleep(access, tab, true)
  } catch (error) {
    if (access.hasTab(tab.id) && !tab.webContents.isDestroyed() && access.activeTabId() === latestFallback.id) {
      access.selectTab(tab.id)
    }
    throw error
  }
}

/** Puts every tab of the workspace that may sleep to sleep, skipping the others. */
export async function sleepWorkspaceTabs<Tab extends TabSleepTab>(access: TabSleepAccess<Tab>, groupId: string): Promise<void> {
  if (!access.mcpTabGroups().has(groupId)) throw new Error(`Unknown workspace: ${groupId}`)
  const workspaceTabs = [...access.tabs()].filter((tab) => tab.mcpGroupId === groupId)
  for (const tab of workspaceTabs) await putTabToSleep(access, tab, false)
}

/**
 * The message key of why the tab must stay awake, in words for the person, or
 * undefined when it may sleep. The active tab may sleep only when
 * allowActiveTab says another tab will take its place.
 */
export function sleepBlockReason<Tab extends TabSleepTab>(access: TabSleepAccess<Tab>, tab: Tab, allowActiveTab = false): MessageKey | undefined {
  if (!access.hasTab(tab.id) || tab.webContents.isDestroyed()) return 'native.errors.tabUnavailable'
  if (isHronautHomeUrl(tab.url) || !isWebUrl(tab.url)) return 'appErrors.sleep.onlyWebsites'
  if ((!allowActiveTab && tab.id === access.activeTabId()) || access.splitViewContains(tab.id)) return 'appErrors.sleep.visible'
  if (tab.pinned) return 'appErrors.sleep.pinned'
  if (tab.pageLifecycleState !== 'active' || tab.pageLifecycleOperation) return 'appErrors.sleep.pageHold'
  if (tab.loading) return 'appErrors.sleep.loading'
  if (tab.audible) return 'appErrors.sleep.audio'
  if (tab.dialog) return 'appErrors.sleep.dialog'
  if (access.options().walletKeepsTabAwake?.(tab.id)) return 'appErrors.sleep.wallet'
  if (tab.webContents.isDevToolsOpened() || access.devToolsOpening().has(tab.webContents.id)) {
    return 'appErrors.sleep.devTools'
  }
  if (
    access.screenshotAreaSessions().has(tab.webContents.id)
    || access.elementPickerSessions().has(tab.webContents.id)
    || access.agentInputWebContents().has(tab.webContents.id)
  ) {
    return 'appErrors.sleep.interaction'
  }
  if (access.videoRecorder().state(tab.id).status === 'recording') return 'appErrors.sleep.video'
  if (tab.reproRecording?.active) return 'appErrors.sleep.repro'
  if (tab.domChangesRecording?.active) return 'appErrors.sleep.domChanges'
  if (liveRegionRecordingKeepsTabAwake(tab)) return 'appErrors.sleep.liveRegion'
  if (access.cssStatePreview().active(tab)) return 'appErrors.sleep.cssState'
  if (access.domMutationSource().active(tab)) return 'appErrors.sleep.domMutationSource'
  if (access.virtualPasskeys().active(tab)) return 'appErrors.sleep.passkey'
  if (access.logpoints().active(tab)) return 'appErrors.sleep.logpoints'
  if (tab.codeCoverage?.recording) return 'appErrors.sleep.coverage'
  if (tab.cpuProfile?.recording) return 'appErrors.sleep.cpuProfile'
  if (tab.memoryAllocation?.recording) return 'appErrors.sleep.memory'
  if ((access.mcpActivitiesByTab().get(tab.id)?.size ?? 0) > 0) return 'appErrors.sleep.mcpCommand'
  if (access.downloadController().hasActiveDownload(tab.id)) {
    return 'appErrors.sleep.download'
  }
  if (access.renderQueues().has(tab.webContents.id)) return 'appErrors.sleep.render'
  return undefined
}

/**
 * Whether the page holds form input the person changed, including edited
 * content, so sleeping would lose it. A page that cannot answer counts as
 * changed, except one whose renderer exited, which holds no input.
 */
async function hasChangedFormState(tab: TabSleepTab): Promise<boolean> {
  try {
    return await tab.webContents.executeJavaScript(`(() => {
        const inputs = [...document.querySelectorAll('input')];
        if (inputs.some((input) => {
          const type = (input.getAttribute('type') || 'text').toLowerCase();
          if (['button', 'submit', 'reset', 'image', 'hidden'].includes(type)) return false;
          if (type === 'checkbox' || type === 'radio') return input.checked !== input.defaultChecked;
          if (type === 'file') return (input.files?.length || 0) > 0;
          return input.value !== input.defaultValue;
        })) return true;
        if ([...document.querySelectorAll('textarea')].some((field) => field.value !== field.defaultValue)) return true;
        if ([...document.querySelectorAll('select')].some((field) => {
          if (field.multiple) return [...field.options].some((option) => option.selected !== option.defaultSelected);
          const explicitDefault = [...field.options].findIndex((option) => option.defaultSelected);
          const defaultIndex = explicitDefault >= 0 ? explicitDefault : field.options.length > 0 ? 0 : -1;
          return field.selectedIndex !== defaultIndex;
        })) return true;
        return window.__hronautContentEditableDirty === true;
      })()`) === true
  } catch (error) {
    return !(error instanceof RendererExitedError)
  }
}

/** Starts recording in the page whether the person edits editable content, which forms do not show. */
export function watchUnsavedFormEdits(tab: TabSleepTab): void {
  void tab.webContents.executeJavaScript(`(() => {
      if (window.__hronautFormEditTrackingInstalled) return;
      window.__hronautFormEditTrackingInstalled = true;
      window.__hronautContentEditableDirty = false;
      document.addEventListener('input', (event) => {
        const target = event.target;
        if (target instanceof HTMLElement && target.isContentEditable) {
          window.__hronautContentEditableDirty = true;
        }
      }, true);
    })()`, true).catch(() => undefined)
}

/**
 * Puts the tab to sleep: it keeps its history and overview frame, and its
 * page is replaced by the sleeping page, freeing its memory. It checks what
 * keeps the tab awake again after reading the page's forms, and stops when
 * isCurrent says the request is no longer wanted. A failure that reportBlocked
 * leaves unthrown is logged. When the sleeping page loaded but its cleanup
 * failed, the previous page is restored; when that fails too, the tab stays
 * asleep. Returns whether the tab went to sleep.
 */
export async function putTabToSleep<Tab extends TabSleepTab>(access: TabSleepAccess<Tab>, tab: Tab, reportBlocked: boolean, isCurrent: () => boolean = () => true): Promise<boolean> {
  if (tab.wakePromise) await tab.wakePromise
  if (!isCurrent() || tab.sleeping) return false
  const blockReason = sleepBlockReason(access, tab)
  if (blockReason) {
    if (reportBlocked) throw new LocalizedError(blockReason)
    return false
  }
  if (await hasChangedFormState(tab)) {
    if (reportBlocked) throw new LocalizedError('appErrors.sleep.unsavedForm')
    return false
  }
  if (!isCurrent()) return false
  const latestBlockReason = sleepBlockReason(access, tab)
  if (latestBlockReason) {
    if (reportBlocked) throw new LocalizedError(latestBlockReason)
    return false
  }
  tab.sleepNavigationHistory = access.navigationHistorySnapshot(tab)
  // The overview keeps showing the page as it was; the frame is dropped when the tab wakes or closes.
  const lastFrame = access.tabOverviewPreviews().get(tab.id)
  if (lastFrame?.navigationGeneration === tab.navigationGeneration) access.tabOverviewSleepPreviews().set(tab.id, lastFrame)
  else access.tabOverviewSleepPreviews().delete(tab.id)
  tab.sleeping = true
  tab.walletPageUnloading = true
  tab.loading = false
  tab.pendingHistoryUrl = null
  access.changed(false)
  let sleepingPageLoaded = false
  try {
    try {
      await tab.webContents.loadURL(SLEEPING_PAGE_URL)
    } finally {
      // The page is gone now, or the navigation failed and it stays in use.
      tab.walletPageUnloading = false
    }
    sleepingPageLoaded = true
    await access.withDebugger(tab.webContents, () =>
      tab.webContents.debugger.sendCommand('HeapProfiler.collectGarbage')
    )
  } catch (error) {
    const navigationHistory = tab.sleepNavigationHistory
    if (!sleepingPageLoaded) {
      tab.sleeping = false
      tab.sleepNavigationHistory = undefined
      access.changed(false)
      if (reportBlocked) throw error
      console.warn(`[browser] Could not put tab ${tab.id} to sleep:`, error)
      return false
    }
    let restoreError: unknown
    try {
      if (navigationHistory?.entries.length) {
        try {
          tab.discoveryTitle.restoring(navigationHistory.entries)
          await tab.webContents.navigationHistory.restore(navigationHistory)
        } catch {
          await tab.webContents.loadURL(tab.url)
        }
      } else {
        await tab.webContents.loadURL(tab.url)
      }
    } catch (rollbackError) {
      restoreError = rollbackError
    }
    if (restoreError) {
      tab.sleeping = true
      tab.sleepNavigationHistory = navigationHistory
      tab.loading = false
      access.changed(false)
      const recoveryError = new AggregateError(
        [error, restoreError],
        'The tab could not finish sleeping and its previous page could not be restored.'
      )
      if (reportBlocked) throw recoveryError
      console.warn(`[browser] Could not put tab ${tab.id} to sleep or restore it:`, recoveryError)
      return false
    }
    tab.sleeping = false
    tab.sleepNavigationHistory = undefined
    tab.loading = false
    access.changed(false)
    if (reportBlocked) throw error
    console.warn(`[browser] Could not put tab ${tab.id} to sleep:`, error)
    return false
  }
  access.changed(false)
  return true
}
