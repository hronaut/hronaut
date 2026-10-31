import { type LoadURLOptions, type NavigationEntry, type WebContents, WebContentsView, type WebPreferences } from 'electron'
import { normalizeDefaultFontSize } from '../../../shared/default-font-size.js'
import { UNTITLED_TAB_TITLE } from '../../../shared/tab-title.js'
import { uuidV7 } from '../../uuid-v7.js'
import { orderedTabs } from '../browser-core.js'
import { publishChange } from '../browser-state/browser-state.js'
import type { BrowserTab } from '../browser-tab.js'
import type { Browser } from '../browser.js'
import { opensFromPage } from '../download-tab-close/download-tab-close.js'
import { DEFAULT_EMULATION } from '../emulation-state.js'
import { forgetTabsOpenedFrom } from '../link-tab-placement/link-tab-openers.js'
import { placeTabOpenedFromPage } from '../link-tab-placement/link-tab-placement.js'
import type { NavigationHistorySnapshot } from '../navigation-history.js'
import { loadFailureProblem } from '../page-load-problem.js'
import { nextPageLoadTurn } from '../page-load-turns/page-load-turns.js'
import { holdUntilFirstLoad } from '../renderer-exit-guard.js'
import { keepSessionCookies } from '../session-cookies/saved-session-cookies.js'
import { installSessionHooks } from '../session-hooks/session-hooks.js'
import { applySiteMuting } from '../site-muting/site-muting.js'
import { TabDiscoveryTitle } from '../tab-discovery-title.js'
import { attachTabEvents } from '../tab-events/attach-tab-events.js'
import { attachPageCloseEvents } from '../tab-events/page-close-events.js'
import { normalizeTabTitle } from '../tab-metadata.js'
import { BackgroundLoads } from '../tab-sleep/background-loads.js'
import { sleepBeforeFirstLoad } from '../tab-sleep/tab-sleep.js'
import { isHronautHomeUrl, isWebUrl, normalizeAddress } from '../url.js'
import { contentAreaBounds } from '../window-layout/content-area.js'
import { roundPageCorners } from '../window-layout/window-layout.js'
import { workspaceObservationGeneration } from '../workspace-continuity/workspace-continuity.js'
import { assertWorkspaceNavigationAllowed } from '../workspace-navigation/workspace-navigation.js'
import { workspacePartition } from '../workspace-storage.js'
import { assertCanCreateTab, pageWebPreferences } from './tab-admission.js'

const HRONAUT_HOME_URL = 'hronaut://home/'
const ABORTED_LOAD_ERROR = -3

function isAbortedLoad(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const details = error as Error & { code?: unknown; errno?: unknown }
  return details.code === ABORTED_LOAD_ERROR
    || details.errno === ABORTED_LOAD_ERROR
    || details.code === 'ERR_ABORTED'
    || /\bERR_ABORTED\b|\(-3\)\s+loading\b/.test(error.message)
}

/**
 * Restores a tab's Back and Forward history and loads the page it shows, or, when Electron cannot take the history and
 * the tab has none, loads its address instead.
 */
async function restoreHistoryOrLoad(webContents: WebContents, history: NavigationHistorySnapshot, url: string, loadOptions?: LoadURLOptions): Promise<void> {
  try {
    await webContents.navigationHistory.restore(history)
  } catch (error) {
    if (webContents.isDestroyed() || webContents.navigationHistory.length() > 0) throw error
    await webContents.loadURL(url, loadOptions)
  }
}

/** The tabs waiting asleep to load in their turn. Made when first used, as browsers made without the constructor are. */
function backgroundLoads(browser: Browser): BackgroundLoads {
  browser.backgroundTabLoads ??= new BackgroundLoads({
    waiting: (tabId) => {
      const tab = browser.tabs.get(tabId)
      return Boolean(!browser.destroyed && tab?.waitsForTurn && tab.sleeping && !tab.wakePromise && !tab.webContents.isDestroyed())
    },
    wake: (tabId) => browser.wakeTab(tabId)
  })
  return browser.backgroundTabLoads
}

/**
 * Opens a tab: its page's view and session, its record among the tabs and its page's events, then its first load,
 * unless it starts asleep or waits for its turn.
 */
export async function createTab(browser: Browser, options: {
  id?: string
  title?: string
  label?: string
  url: string
  pinned?: boolean
  muted?: boolean
  humanInteractionLocked?: boolean
  tabAgentPaused?: boolean
  zoomIsolated?: boolean
  defaultFontSize?: number
  faviconDataUrl?: string
  focus?: boolean
  navigationGeneration?: number
  suppressInitialHistory?: boolean
  navigationHistory?: { entries: NavigationEntry[]; index: number }
  /**
   * Whether the tab starts asleep, with its address and history, and loads its page only once it is shown or used,
   * as Chrome restores the tabs behind the one shown. Only a website tab that is not pinned does.
   */
  asleep?: boolean
  /**
   * Whether the tab starts asleep as above and loads in its turn among the tabs opened behind the one shown,
   * BACKGROUND_LOADS at a time, as when Open all opens many at once.
   */
  loadsInTurn?: boolean
  loadOptions?: LoadURLOptions
  /**
   * The page Chromium created for a window a workspace tab opened, which this tab shows; it loads itself. The
   * opener's tab id is there while the two pages can reach each other.
   */
  adopt?: { webContents: WebContents; webPreferences?: WebPreferences; openerTabId?: string }
  /**
   * The tab whose page opened this one, and whether it opens behind, which places it beside that tab as in Chrome,
   * and whether it is a window that asked for its own size or position, which Chrome opens as a window of its own.
   */
  openedFrom?: { tabId: string; background: boolean; window?: boolean }
  active: boolean
  selectVisible?: boolean
  mcpGroupId?: string
  allowBusyWorkspace?: boolean
  onCreated?: (tab: BrowserTab) => void
  onCreationAttempt?: () => void
}): Promise<BrowserTab> {
  assertCanCreateTab(browser, options.mcpGroupId, options.allowBusyWorkspace === true)
  const id = options.id ?? uuidV7()
  const url = normalizeAddress(options.url, browser.options.getSearchEngine?.())
  // The window open handler checked the address of a page opened for a window, and its navigation is checked too.
  if (options.mcpGroupId && !options.adopt) {
    assertWorkspaceNavigationAllowed(browser, options.mcpGroupId, url, 'direct')
  }
  const defaultFontSize = isHronautHomeUrl(url) ? undefined : normalizeDefaultFontSize(options.defaultFontSize)
  const asleep = (options.asleep === true || options.loadsInTurn === true) && !options.adopt && options.pinned !== true && isWebUrl(url) && !isHronautHomeUrl(url)
  const opener = options.adopt?.openerTabId ? browser.tabs.get(options.adopt.openerTabId) : undefined
  const workspace = options.mcpGroupId ? browser.mcpTabGroups.get(options.mcpGroupId) : undefined
  const partition = isHronautHomeUrl(url)
    ? workspacePartition(browser.options.partition, 'home')
    : workspacePartition(browser.options.partition, workspace!.storageId)
  options.onCreationAttempt?.()
  // An adopted page already belongs to its opener's session, the workspace's.
  const view = options.adopt
    ? new WebContentsView({ webContents: options.adopt.webContents, webPreferences: options.adopt.webPreferences })
    : new WebContentsView({
      webPreferences: {
        partition,
        ...pageWebPreferences(browser),
        // Construction-time only: switching a live view back to shared mode can
        // write its level into the origin zoom map. Home keeps its own zoom too,
        // at 100% since nothing zooms it, even where an older Hronaut stored one.
        ...(options.zoomIsolated === true || isHronautHomeUrl(url) ? { zoomMode: 'isolated' } : {}),
        // Also construction-time only: Electron has no API to change it on a live view.
        ...(defaultFontSize ? { defaultFontSize } : {})
      }
    })
  try {
    view.setBackgroundColor('#ffffff')
    // Background tabs need a real initial layout even before their first selection.
    // A zero-sized viewport cannot paint a meaningful explicit page preview.
    // Their space is the page card's, even while a shown page in full screen fills the window.
    view.setBounds(contentAreaBounds(browser))
    roundPageCorners(browser, view)
  } catch (error) {
    // This view has no registered tab or owner yet, so normal tab rollback
    // cannot find and close its WebContents after initialization fails.
    if (!view.webContents.isDestroyed()) view.webContents.close()
    throw error
  }
  const tab: BrowserTab = {
    label: isHronautHomeUrl(url) ? undefined : options.label,
    id,
    discoveryTitle: new TabDiscoveryTitle(),
    title: normalizeTabTitle(
      options.title || (url === HRONAUT_HOME_URL ? 'Hronaut Home' : url === 'about:blank' ? UNTITLED_TAB_TITLE : url)
    ),
    url,
    loading: !asleep,
    navigationGeneration: options.navigationGeneration ?? 0,
    walletNavigationGeneration: options.navigationGeneration ?? 0,
    documentGeneration: 0,
    observationGeneration: options.mcpGroupId
      ? workspaceObservationGeneration(browser, options.mcpGroupId)
      : 0,
    humanInteractionGeneration: 0,
    nativeInputEnvironmentGeneration: 0,
    browserSessionGeneration: 0,
    overviewPreviewSequence: 0,
    navigationPolicyDenialSequence: 0,
    pinned: options.pinned === true && !isHronautHomeUrl(url),
    sleeping: asleep,
    pageLifecycleState: 'active',
    lastActiveAt: performance.now(),
    tabAgentPaused: options.tabAgentPaused === true,
    zoomIsolated: options.zoomIsolated === true && !isHronautHomeUrl(url),
    ...(defaultFontSize ? { defaultFontSize } : {}),
    humanInteractionLocked: options.humanInteractionLocked === true || workspace?.contextClass === 'public-observer',
    preserveDiagnosticLogs: true,
    ...(options.faviconDataUrl ? { faviconDataUrl: options.faviconDataUrl } : {}),
    faviconRequestId: 0,
    audible: false,
    tabMuted: options.muted === true,
    muted: (browser.allTabsMuted || options.muted === true) && !isHronautHomeUrl(url),
    mutedBySite: false,
    siteMuteApplied: false,
    view,
    webContents: view.webContents,
    browserSession: view.webContents.session,
    consoleMessages: [],
    pendingRuntimeConsoleMessages: [],
    networkRequests: [],
    networkCaptureSequence: 0,
    networkRoutes: [],
    networkConditionApplication: 'confirmed',
    networkConditionEpoch: 0,
    networkDebuggerEpoch: 0,
    inspectorIssues: [],
    authChallenges: [],
    authChallengesTruncated: false,
    authNavigationPending: false,
    inspectorIssuesTruncated: false,
    networkDebuggerEnabled: false,
    lastHumanInteractionAt: Number.NEGATIVE_INFINITY,
    agentCallStartedAt: Number.NEGATIVE_INFINITY,
    suppressInitialHistory: options.suppressInitialHistory === true,
    pendingHistoryUrl: null,
    emulation: { ...DEFAULT_EMULATION },
    emulationApplication: 'confirmed',
    emulationRevision: 0,
    emulationContextGeneration: 0,
    emulationExtraHttpHeaders: {},
    snapshotBaselineGeneration: 0,
    accessibilityBaselineGeneration: 0,
    memoryBaselineGeneration: 0,
    performanceBaselineGeneration: 0,
    visualComparisonGeneration: 0,
    storageComparisonGeneration: 0,
    ...(options.mcpGroupId ? { mcpGroupId: options.mcpGroupId } : {}),
    ...(opener ? { openerTabId: opener.id } : {}),
    ...(options.openedFrom ? { openedFromTabId: options.openedFrom.tabId } : {}),
    ...(opensFromPage(options) ? { openedFromPage: true } : {})
  }
  // A tab restored or reopened asleep shows its website's sound setting before its page loads.
  applySiteMuting(browser, tab)
  tab.webContents.setAudioMuted(tab.muted)
  // A page's tab opened in front starts a new task, so its workspace forgets which page opened its other tabs. A
  // window such as a sign-in popup leaves them, as in Chrome, where it opens beside the tabs rather than among them.
  if (options.openedFrom && !options.openedFrom.background && !options.openedFrom.window) {
    forgetTabsOpenedFrom(browser.tabs.values(), options.mcpGroupId)
  }
  browser.tabs.set(id, tab)
  const placed = options.openedFrom ? placeTabOpenedFromPage(orderedTabs(browser), tab, options.openedFrom.background) : undefined
  if (placed) {
    browser.tabs.clear()
    for (const placedTab of placed) browser.tabs.set(placedTab.id, placedTab)
  }
  if (tab.mcpGroupId) {
    const group = browser.mcpTabGroups.get(tab.mcpGroupId)!
    if (options.active || !group.activeTabId) group.activeTabId = id
    // Putting the saved tabs back at startup is not a use of their workspace.
    if (!browser.restoringLayout) group.lastUsedAt = new Date().toISOString()
  }
  browser.webContentsToTab.set(view.webContents.id, id)
  browser.options.configureSession?.(view.webContents.session, isHronautHomeUrl(url) ? undefined : workspace?.id)
  installSessionHooks(browser, view.webContents.session)
  // A tab created asleep loads nothing, so it has no renderer to answer the page's calls until it wakes.
  if (asleep) holdUntilFirstLoad(view.webContents)
  const openedBy = options.adopt && options.openedFrom ? browser.tabs.get(options.openedFrom.tabId) : undefined
  attachTabEvents(browser, tab, openedBy?.webContents)
  // A page that closes itself closes its tab: a page opened for a window, as a sign-in popup, and one that a desktop
  // app's sign-in ends on, which asks to be closed. Electron lets a page close itself whatever its history, which Chrome
  // allows only to a page opened for a window or still on its first entry, so its tab never stays without its page.
  attachPageCloseEvents(browser, tab, view.webContents)
  // Restore all tabs before selecting the saved global tab. Selecting the first
  // recreated tab here would overwrite its workspace's remembered selection.
  if ((options.active && options.selectVisible !== false) || (!browser.activeTabId && !browser.restoringLayout)) {
    browser.selectTab(id, { focus: options.focus })
  }
  if (options.navigationHistory) tab.discoveryTitle.restoring(options.navigationHistory.entries)
  // A workspace's first page waits for its session cookies saved at the last quit, so its sites keep the sign-ins.
  const cookiesBack = isHronautHomeUrl(url) ? Promise.resolve() : keepSessionCookies(view.webContents.session)
  if (asleep) {
    tab.sleepNavigationHistory = options.navigationHistory ?? { entries: [{ url, title: tab.title }], index: 0 }
    tab.pageReady = sleepBeforeFirstLoad(cookiesBack)
  }
  const loading = options.adopt || asleep
    ? Promise.resolve()
    : cookiesBack.then(nextPageLoadTurn).then(() => {
      // A tab closed before its turn has nothing to load.
      if (view.webContents.isDestroyed() || browser.tabs.get(id) !== tab) return undefined
      // A navigation that began meanwhile, such as an agent's to the tab it just opened, is newer than its address.
      if (view.webContents.isLoading() || view.webContents.getURL() !== '') return undefined
      return options.navigationHistory
        ? restoreHistoryOrLoad(view.webContents, options.navigationHistory, url, options.loadOptions)
        : view.webContents.loadURL(url, options.loadOptions)
    })
  void loading.catch((error: unknown) => {
    if (isAbortedLoad(error)) return
    if (tab.navigationPolicyDenialSequence > 0) {
      tab.loading = false
      publishChange(browser, false)
      return
    }
    tab.loading = false
    if (!tab.pageProblem) {
      tab.title = browser.text('native.pageProblem.loadTabTitle')
      tab.pageProblem = loadFailureProblem(browser.options.getLocale(), url, 0, 'ERR_FAILED')
    }
    publishChange(browser)
    console.error(`[browser] Failed to load ${url}:`, error)
  })
  if (asleep && options.loadsInTurn) {
    tab.waitsForTurn = true
    backgroundLoads(browser).add(tab.id)
  }
  options.onCreated?.(tab)
  publishChange(browser)
  return tab
}
