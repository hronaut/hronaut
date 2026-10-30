import { MAX_BROWSER_TABS } from '../../../shared/types.js'
import { normalizeWorkspaceDescription } from '../../../shared/workspace-description.js'
import { persistedState } from '../browser-state/persisted-state.js'
import type { Browser } from '../browser.js'
import type { NavigationHistorySnapshot } from '../navigation-history.js'
import { watchPresentedViewVisibility } from '../presented-view-visibility.js'
import { restoredClosedTabs } from '../saved-closed-tabs/saved-closed-tabs.js'
import { savedTabHistory } from '../saved-tab-history/saved-tab-history.js'
import { rememberSavedClosedTabs } from '../tab-reopening/tab-reopening.js'
import { sweepMemorySaver } from '../tab-sleep/memory-saver.js'
import { focusTabOrTrustedChrome } from '../trusted-chrome-focus/trusted-chrome-focus.js'
import { isHronautHomeUrl } from '../url.js'
import { normalizeWorkspaceNavigationPolicy } from '../workspace-navigation-policy.js'
import { cleanExplicitlyDeletedWorkspaceStorage } from '../workspace-storage-deletion.js'
import { saveForNextStart } from './save-for-next-start.js'

const HRONAUT_HOME_URL = 'hronaut://home/'
const MAX_TABS = MAX_BROWSER_TABS
const MEMORY_SAVER_SWEEP_MS = 30_000
/** How often the tabs' history is saved, with their pages' scroll and form state, as Chrome saves its session a moment after each change. */
const TAB_HISTORY_SAVE_MS = 5_000

/**
 * Brings back the saved workspaces, archived workspaces, tabs, their history and Recently closed, then saves them for
 * the next start every few seconds and starts Memory Saver.
 */
export async function initializeBrowser(browser: Browser): Promise<void> {
  browser.restoringLayout = true
  // The tabs' saved history and Recently closed are read meanwhile: neither waits for the workspaces' storage. Neither
  // read fails; one that cannot read its file starts empty.
  const historiesRead = browser.tabHistoryStore?.load()
  const closedRead = browser.closedTabsStore?.load()
  // Full, nonmutating validation precedes both deletion and normalization.
  const accepted = await browser.store.load({ persistRepairs: false, requireExisting: browser.options.requireExistingMetadata })
  const cleanup = accepted && browser.options.sessionDataPath
    ? await cleanExplicitlyDeletedWorkspaceStorage(browser.options.storePath, browser.options.sessionDataPath, browser.options.partition)
    : { metadataBlocked: false }
  // Cleanup can retire deletion intent. Reread rather than resurrecting a
  // stale prepared snapshot; disappearance is no longer a fresh profile.
  const saved = await browser.store.load({ blockStorageCleanup: cleanup.metadataBlocked, requireExisting: accepted !== null || browser.options.requireExistingMetadata })
  for (const id of saved?.deletedWorkspaceStorageIds ?? []) browser.deletedWorkspaceStorageIds.add(id)
  browser.workspaceStorageCleanupBlocked = saved?.workspaceStorageCleanupBlocked === true
    || (cleanup.metadataBlocked && saved !== null)
  for (const workspaceId of saved?.continuityWorkspaceIds ?? []) browser.workspaceContinuity.restoreStale(workspaceId)
  browser.allTabsMuted = saved?.allTabsMuted === true
  browser.allHumanInteractionLocked = saved?.allHumanInteractionLocked === true
  const persistedTabs = saved?.tabs ?? []
  const savedHistories = await historiesRead ?? new Map<string, NavigationHistorySnapshot>()
  const savedClosed = await closedRead ?? []
  for (const group of saved?.mcpTabGroups ?? []) {
    browser.mcpTabGroups.set(group.id, {
      ...group,
      description: normalizeWorkspaceDescription(group.description ?? ''),
      activeTabId: group.activeTabId ?? null,
      origins: [...(group.origins ?? [])],
      navigationPolicy: normalizeWorkspaceNavigationPolicy(group.navigationPolicy),
      navigationAudit: [...(group.navigationAudit ?? [])]
    })
  }
  for (const group of saved?.savedTabGroups ?? []) {
    browser.savedTabGroups.set(group.id, {
      ...group,
      description: normalizeWorkspaceDescription(group.description ?? ''),
      storageOriginCount: group.origins?.length ?? 0,
      origins: [...(group.origins ?? [])],
      navigationPolicy: normalizeWorkspaceNavigationPolicy(group.navigationPolicy),
      navigationAudit: [...(group.navigationAudit ?? [])],
      tabs: group.tabs.map((tab) => ({
        title: tab.title, url: tab.url, pinned: tab.pinned === true, ...(tab.label ? { label: tab.label } : {}),
        ...(tab.zoomIsolated ? { zoomIsolated: true as const } : {}), ...(tab.defaultFontSize ? { defaultFontSize: tab.defaultFontSize } : {}),
        ...(tab.muted ? { muted: true as const } : {}),
        ...(tab.tabAgentPaused ? { tabAgentPaused: true as const } : {}),
        ...(tab.humanInteractionLocked ? { humanInteractionLocked: true as const } : {})
      }))
    })
  }
  // Recently closed comes back as Chrome's does, with the closed tabs of workspaces that are open again.
  rememberSavedClosedTabs(browser.closedTabs, restoredClosedTabs(savedClosed, (workspaceId) => browser.mcpTabGroups.get(workspaceId)?.navigationPolicy))
  if (persistedTabs.length) {
    let restoredHome = false
    // The tabs shown come back loaded: the window's, and each workspace's own, which its agent reads and acts in as
    // Chrome loads each window's. The tabs behind them come back asleep, as in Chrome: each loads its page once it is
    // shown or used, so a restart loads the shown pages rather than every tab's.
    const shownTabIds = new Set([
      saved?.activeTabId, saved?.splitView?.firstTabId, saved?.splitView?.secondTabId,
      ...[...browser.mcpTabGroups.values()].map(group => group.activeTabId)
    ])
    for (const tab of persistedTabs) {
      if (browser.tabs.size >= MAX_TABS) break
      if (isHronautHomeUrl(tab.url)) {
        if (restoredHome) continue
        restoredHome = true
      }
      // A workspace tab comes back with its Back and Forward history and the scroll of its pages, as in Chrome.
      const workspacePolicy = tab.mcpGroupId && !isHronautHomeUrl(tab.url) ? browser.mcpTabGroups.get(tab.mcpGroupId)?.navigationPolicy : undefined
      const navigationHistory = workspacePolicy ? savedTabHistory(savedHistories.get(tab.id), tab.url, workspacePolicy) : undefined
      await browser.createTab({
        id: tab.id,
        label: tab.label,
        title: isHronautHomeUrl(tab.url) ? undefined : tab.title,
        url: isHronautHomeUrl(tab.url) ? HRONAUT_HOME_URL : tab.url,
        pinned: tab.pinned === true && !isHronautHomeUrl(tab.url),
        muted: tab.muted === true,
        humanInteractionLocked: tab.humanInteractionLocked === true,
        tabAgentPaused: tab.tabAgentPaused === true,
        zoomIsolated: tab.zoomIsolated === true,
        defaultFontSize: tab.defaultFontSize,
        faviconDataUrl: tab.faviconDataUrl,
        mcpGroupId: isHronautHomeUrl(tab.url)
          ? undefined
          : tab.mcpGroupId,
        ...(navigationHistory ? { navigationHistory } : {}),
        asleep: !shownTabIds.has(tab.id),
        suppressInitialHistory: true,
        active: false
      })
    }
    const fallbackId = browser.tabs.keys().next().value as string | undefined
    if (fallbackId) {
      const restoredActiveTabId = saved?.activeTabId && browser.tabs.has(saved.activeTabId) ? saved.activeTabId : fallbackId
      browser.selectTab(restoredActiveTabId)
      const savedSplit = saved?.splitView
      if (
        savedSplit
        && browser.tabs.has(savedSplit.firstTabId)
        && browser.tabs.has(savedSplit.secondTabId)
        && !isHronautHomeUrl(browser.tabs.get(savedSplit.firstTabId)!.url)
        && !isHronautHomeUrl(browser.tabs.get(savedSplit.secondTabId)!.url)
        && (restoredActiveTabId === savedSplit.firstTabId || restoredActiveTabId === savedSplit.secondTabId)
      ) {
        browser.splitView = savedSplit
        const otherTabId = restoredActiveTabId === savedSplit.firstTabId ? savedSplit.secondTabId : savedSplit.firstTabId
        browser.window.contentView.addChildView(browser.tabs.get(otherTabId)!.view)
      }
    }
  } else {
    await browser.createTab({ url: HRONAUT_HOME_URL, active: true })
  }
  browser.layout()
  browser.restoringLayout = false
  await browser.store.initializeState(() => persistedState(browser))
  browser.initialized = true
  // The saved history leaves out tabs that did not come back; from then on it is saved every few seconds, with
  // Recently closed.
  void saveForNextStart(browser)
  browser.tabHistoryTimer = setInterval(() => { void saveForNextStart(browser) }, TAB_HISTORY_SAVE_MS)
  browser.tabHistoryTimer.unref()
  if (browser.activeTabId) {
    const activeTab = browser.tabs.get(browser.activeTabId)
    if (activeTab) focusTabOrTrustedChrome(browser, activeTab)
  }
  browser.stopPresentationWatcher = watchPresentedViewVisibility(browser.window, () => {
    const ids = browser.splitView
      ? [browser.splitView.firstTabId, browser.splitView.secondTabId]
      : browser.activeTabId ? [browser.activeTabId] : []
    return ids.flatMap(id => {
      const tab = browser.tabs.get(id)
      return tab?.pageLifecycleState === 'active' && tab.pageLifecycleOperation?.requestedState !== 'frozen'
        ? [tab.view]
        : []
    })
  })
  browser.memorySaverTimer = setInterval(() => {
    void sweepMemorySaver(browser, false).catch((error) => console.error('[browser] Memory Saver sweep failed:', error))
  }, MEMORY_SAVER_SWEEP_MS)
  browser.memorySaverTimer.unref()
}
