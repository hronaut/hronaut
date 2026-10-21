import type { Event, WebContents, WebFrameMain } from 'electron'
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
 * Goes back from the sleeping page to the page the tab slept on, so the tab keeps the pages before it in its history:
 * Electron restores saved history only into a page that never loaded one, and the sleeping page is one. When the
 * sleeping page is not the current entry right after the tab's address, the address is loaded instead. It settles as
 * Electron's `loadURL` does: once the page, or the error page of a failed load, finishes loading, with the load's error
 * when it failed; as aborted when another navigation replaces it; and as failed when loading stops without either.
 */
function returnFromSleepingPage(webContents: WebContents, url: string): Promise<void> {
  const history = webContents.navigationHistory
  const sleepingIndex = history.getActiveIndex()
  if (history.getEntryAtIndex(sleepingIndex)?.url !== SLEEPING_PAGE_URL || history.getEntryAtIndex(sleepingIndex - 1)?.url !== url) {
    return webContents.loadURL(url)
  }
  return new Promise<void>((resolve, reject) => {
    let navigationStarted = false
    let failure: Error | undefined
    const loadError = (code: number, description: string) =>
      Object.assign(new Error(`${description} (${code}) loading '${url}'`), { errno: code, code: description, url })
    const finished = () => settle(failure)
    // A failed load goes on to show its error page; settling only once that page loads keeps its load events from
    // settling the next one, such as the wake's fallback.
    const failed = (_event: Event, code: number, description: string, _validatedUrl: string, isMainFrame: boolean) => {
      if (!isMainFrame) return
      failure ??= loadError(code, description)
      if (!navigationStarted) settle(failure)
    }
    const started = (_event: Event, _navigationUrl: string, isSameDocument: boolean, isMainFrame: boolean) => {
      if (!isMainFrame || isSameDocument) return
      if (navigationStarted) settle(loadError(-3, 'ERR_ABORTED'))
      navigationStarted = true
    }
    const stopped = () => settle(failure ?? loadError(-2, 'ERR_FAILED'))
    function settle(error?: Error): void {
      webContents.removeListener('did-finish-load', finished)
      webContents.removeListener('did-fail-load', failed)
      webContents.removeListener('did-start-navigation', started)
      webContents.removeListener('did-stop-loading', stopped)
      webContents.removeListener('destroyed', stopped)
      if (error) reject(error)
      else resolve()
    }
    webContents.on('did-finish-load', finished)
    webContents.on('did-fail-load', failed)
    webContents.on('did-start-navigation', started)
    webContents.on('did-stop-loading', stopped)
    webContents.on('destroyed', stopped)
    try {
      history.goToIndex(sleepingIndex - 1)
    } catch (error) {
      settle(error instanceof Error ? error : new Error(String(error)))
    }
  })
}

/** Removes the sleeping page from the tab's history once the tab shows another page, so Back never opens it. */
function forgetSleepingPage(webContents: WebContents): void {
  const history = webContents.navigationHistory
  for (let index = history.length() - 1; index >= 0; index -= 1) {
    if (index !== history.getActiveIndex() && history.getEntryAtIndex(index)?.url === SLEEPING_PAGE_URL) history.removeEntryAtIndex(index)
  }
}

/**
 * Removes the sleeping page from the history once the navigation that replaced a wake opens its page; until then the
 * sleeping page is still the last page the tab committed and cannot be removed.
 */
function forgetSleepingPageOnNextPage<Tab extends TabSleepTab>(access: TabSleepAccess<Tab>, tab: Tab): void {
  const contents = tab.webContents
  if (access.findTab(tab.id) !== tab || contents.isDestroyed()) return
  contents.once('did-navigate', () => {
    if (access.findTab(tab.id) === tab && tab.webContents === contents && !contents.isDestroyed()) forgetSleepingPage(contents)
  })
}

/**
 * Wakes a sleeping tab by going back to the page it slept on, or loading its
 * address, and marks it active now. A wake already running is joined. When
 * that fails and no newer navigation took over, the address is loaded again;
 * when that fails too, the tab, if still open, goes back to sleep and the
 * failure is thrown. Once awake, the sleeping page leaves its history.
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
      await returnFromSleepingPage(tab.webContents, restoreUrl)
    } catch (error) {
      const wakeWasSuperseded = () => access.findTab(tab.id) !== tab
        || tab.webContents.isDestroyed()
        || (tab.navigationGeneration !== navigationGeneration
          && (tab.webContents.isLoading() || tab.webContents.getURL() !== SLEEPING_PAGE_URL))
      // A wake that ended as aborted without a newer navigation retries the
      // durable URL; otherwise the tab is marked awake while still showing
      // the internal sleeping page. A real newer navigation remains
      // authoritative, and the sleeping page leaves the history once that
      // navigation's page opens.
      if (isAbortedLoad(error) && wakeWasSuperseded()) {
        forgetSleepingPageOnNextPage(access, tab)
        return
      }
      try {
        await tab.webContents.loadURL(restoreUrl)
      } catch (fallbackError) {
        // A newer navigation can also interrupt the fallback. Preserve its
        // live document instead of restoring the obsolete sleeping state.
        if (isAbortedLoad(fallbackError) && wakeWasSuperseded()) {
          forgetSleepingPageOnNextPage(access, tab)
          return
        }
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
    if (access.findTab(tab.id) === tab && !tab.webContents.isDestroyed()) forgetSleepingPage(tab.webContents)
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
 * tab after it, then before it, or a sleeping one when all of them sleep. A
 * tab of its own workspace comes first, so the person stays in the workspace.
 */
export function sleepFallbackTab<Tab extends TabSleepTab>(access: TabSleepAccess<Tab>, tab: Tab): Tab | undefined {
  const ordered = access.orderedTabs()
  const index = ordered.indexOf(tab)
  const candidates = [
    ...ordered.slice(index + 1),
    ...ordered.slice(0, index).reverse()
  ].filter((candidate) => candidate.id !== tab.id && !candidate.webContents.isDestroyed())
  const sameWorkspace = candidates.filter((candidate) => candidate.mcpGroupId === tab.mcpGroupId)
  return sameWorkspace.find((candidate) => !candidate.sleeping)
    ?? sameWorkspace[0]
    ?? candidates.find((candidate) => !candidate.sleeping)
    ?? candidates[0]
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
  if (!access.mcpTabGroups().has(groupId)) throw new LocalizedError('appErrors.workspace.unavailable', undefined, { message: `Unknown workspace: ${groupId}` })
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
  // Sleeping replaces the page, which would break what the two pages are doing together, such as signing in.
  if ((tab.openerTabId && access.hasTab(tab.openerTabId)) || [...access.tabs()].some(other => other.openerTabId === tab.id)) {
    return 'appErrors.sleep.window'
  }
  return undefined
}

/**
 * Whether one document holds form input the person changed, including fields inside open shadow roots, or edited
 * content its watcher recorded.
 */
const CHANGED_FORM_STATE_SCRIPT = `(() => {
    const changed = (field) => {
      if (field instanceof HTMLInputElement) {
        const type = (field.getAttribute('type') || 'text').toLowerCase();
        if (['button', 'submit', 'reset', 'image', 'hidden'].includes(type)) return false;
        if (type === 'checkbox' || type === 'radio') return field.checked !== field.defaultChecked;
        if (type === 'file') return (field.files?.length || 0) > 0;
        return field.value !== field.defaultValue;
      }
      if (field instanceof HTMLTextAreaElement) return field.value !== field.defaultValue;
      if (field instanceof HTMLSelectElement) {
        if (field.multiple) return [...field.options].some((option) => option.selected !== option.defaultSelected);
        const explicitDefault = [...field.options].findIndex((option) => option.defaultSelected);
        const defaultIndex = explicitDefault >= 0 ? explicitDefault : field.options.length > 0 ? 0 : -1;
        return field.selectedIndex !== defaultIndex;
      }
      return false;
    };
    const roots = [document];
    for (let index = 0; index < roots.length; index += 1) {
      for (const element of roots[index].querySelectorAll('*')) {
        if (changed(element)) return true;
        if (element.shadowRoot) roots.push(element.shadowRoot);
      }
    }
    return window.__hronautContentEditableDirty === true;
  })()`

/** How long an embedded frame has to answer the form check, so a busy or vanishing frame cannot hold up sleeping. */
const FRAME_FORM_CHECK_TIMEOUT_MS = 1_000

/**
 * Whether the page holds form input the person changed, including edited
 * content, so sleeping would lose it. Every frame is checked, since a draft
 * can be in an embedded form or editor. A page that cannot answer counts as
 * changed, except one whose renderer exited, which holds no input. An
 * embedded frame that cannot answer in time, such as one not allowed to run
 * scripts, is skipped, as before frames were checked, so it cannot keep the
 * tab awake for good.
 */
async function hasChangedFormState(tab: TabSleepTab): Promise<boolean> {
  try {
    if (await tab.webContents.executeJavaScript(CHANGED_FORM_STATE_SCRIPT) === true) return true
  } catch (error) {
    return !(error instanceof RendererExitedError)
  }
  if (tab.webContents.isDestroyed()) return false
  for (const frame of tab.webContents.mainFrame.framesInSubtree) {
    if (frame === tab.webContents.mainFrame || frame.isDestroyed() || frame.detached) continue
    if (await frameAnswer(frame.executeJavaScript(CHANGED_FORM_STATE_SCRIPT)) === true) return true
  }
  return false
}

/** The frame's answer, or undefined when it fails or does not answer in time. */
async function frameAnswer(call: Promise<unknown>): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<undefined>((resolve) => { timer = setTimeout(() => resolve(undefined), FRAME_FORM_CHECK_TIMEOUT_MS) })
  try {
    return await Promise.race([call.catch(() => undefined), late])
  } finally {
    clearTimeout(timer)
  }
}

/** Records in a document whether the person edits editable content, which forms do not show, inside shadow roots too. */
const WATCH_FORM_EDITS_SCRIPT = `(() => {
    if (window.__hronautFormEditTrackingInstalled) return;
    window.__hronautFormEditTrackingInstalled = true;
    window.__hronautContentEditableDirty = false;
    document.addEventListener('input', (event) => {
      const target = event.composedPath()[0];
      if (target instanceof HTMLElement && target.isContentEditable) {
        window.__hronautContentEditableDirty = true;
      }
    }, true);
  })()`

/**
 * Starts recording in the page, or in one of its frames once it loads, whether the person edits editable content,
 * which forms do not show. Adding a listener needs no user activation, so none is granted: activation would let the
 * page, or an embedded frame and every page above it, act as if the person had just clicked.
 */
export function watchUnsavedFormEdits(tab: TabSleepTab, frame?: WebFrameMain): void {
  const run = frame ? frame.executeJavaScript(WATCH_FORM_EDITS_SCRIPT, false) : tab.webContents.executeJavaScript(WATCH_FORM_EDITS_SCRIPT, false)
  void run.catch(() => undefined)
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
    // Awake while its page returns, as waking does, so the page's own redirects still go through.
    tab.sleeping = false
    try {
      try {
        await returnFromSleepingPage(tab.webContents, tab.url)
      } catch {
        await tab.webContents.loadURL(tab.url)
      }
      forgetSleepingPage(tab.webContents)
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
