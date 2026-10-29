import type { BrowserState, BrowserTabState } from '../../../shared/types.js'
import type { Browser } from '../browser.js'
import { orderedTabs } from '../browser-core.js'
import type { BrowserTab } from '../browser-tab.js'
import { showsUntrustedCertificate } from '../certificate-errors/certificate-errors.js'
import { persistedState } from './persisted-state.js'

/** The browser state as it is now. A change still waiting to be published goes out first (see StatePublication). */
export function browserState(browser: Browser): BrowserState {
  browser.statePublication.beforeRead()
  return buildBrowserState(browser)
}

/**
 * Tells the shell and MCP the browser state changed, and unless `persist` is
 * false saves it a moment later, once changes stop coming. Nothing goes out
 * while the browser closes or restores its layout.
 */
export function publishChange(browser: Browser, persist = true): void {
  if (browser.destroyed || browser.window.isDestroyed() || browser.restoringLayout) return
  browser.options.onChanged?.()
  browser.statePublication.changed()
  if (!persist) return
  if (browser.persistTimer) clearTimeout(browser.persistTimer)
  browser.persistTimer = setTimeout(() => {
    browser.persistTimer = null
    void browser.store.save(() => persistedState(browser)).catch((error) => console.error('[browser] Failed to persist tabs:', error))
  }, 250)
}

/**
 * The browser state the shell and MCP see: every tab in order, the recently
 * closed tabs newest first, the active tab, the split view, the global
 * mute, lock and pause, the MCP address and profile, the workspaces and the
 * followed agent. State publication sends what it builds.
 */
export function buildBrowserState(browser: Browser): BrowserState {
  const agentFollow = browser.publishedAgentFollow()
  return {
    tabs: orderedTabs(browser).map((tab) => toState(browser, tab)),
    closedTabs: [...browser.closedTabs].reverse().map((tab) => ({ ...tab })),
    activeTabId: browser.activeTabId,
    ...(browser.splitView ? { splitView: { ...browser.splitView } } : {}),
    allTabsMuted: browser.allTabsMuted,
    allHumanInteractionLocked: browser.allHumanInteractionLocked,
    agentControlLocked: browser.allAgentsPaused && !browser.agentPauseOverridesAllowed,
    mcpUrl: browser.mcpUrl,
    profilePath: browser.options.profilePath,
    mcpTabGroups: browser.listMcpTabGroups(),
    savedTabGroups: browser.listSavedTabGroups(),
    ...(agentFollow ? { agentFollow } : {})
  }
}

/** One tab as the browser state shows it, from its fields and the browser's view of it. */
function toState(browser: Browser, tab: BrowserTab): BrowserTabState {
  const navigation = browser.navigationButtons(tab)
  const webContentsDestroyed = tab.webContents.isDestroyed()
  return {
    id: tab.id,
    title: tab.title,
    ...(tab.labelDurabilityUnconfirmed ? { labelDurabilityUnconfirmed: true } : {}),
    ...(tab.label ? { label: tab.label } : {}),
    url: tab.url,
    loading: tab.loading,
    navigationGeneration: tab.navigationGeneration,
    documentGeneration: tab.documentGeneration,
    observationGeneration: tab.observationGeneration,
    humanInteractionGeneration: tab.humanInteractionGeneration,
    browserSessionGeneration: tab.browserSessionGeneration,
    canGoBack: navigation.canGoBack,
    canGoForward: navigation.canGoForward,
    active: tab.id === browser.activeTabId,
    pinned: tab.pinned,
    sleeping: tab.sleeping,
    pageLifecycleState: tab.pageLifecycleState,
    humanInteractionLocked: tab.humanInteractionLocked,
    tabAgentPaused: tab.tabAgentPaused,
    humanInteractionInputLocked: browser.isHumanInteractionLocked(tab),
    agentPaused: browser.isTabAgentPaused(tab.id),
    ...(browser.isTabTakenOver(tab.id) ? { takenOverAt: tab.takeOver!.at } : {}),
    ...(tab.handedBack ? { handedBack: { ...tab.handedBack } } : {}),
    preserveDiagnosticLogs: tab.preserveDiagnosticLogs,
    videoRecording: browser.videoRecorder.state(tab.id).status,
    zoomPercent: webContentsDestroyed ? 100 : Math.round(tab.webContents.getZoomFactor() * 100),
    ...(tab.zoomIsolated ? { zoomIsolated: true } : {}),
    ...(tab.defaultFontSize ? { defaultFontSize: tab.defaultFontSize } : {}),
    ...(tab.faviconDataUrl ? { faviconDataUrl: tab.faviconDataUrl } : {}),
    audible: tab.audible,
    tabMuted: tab.tabMuted,
    muted: tab.muted,
    devToolsOpen: !webContentsDestroyed && tab.webContents.isDevToolsOpened(),
    ...browser.emulationProjection(tab),
    ...(tab.networkRoutes.length ? { networkRouteCount: tab.networkRoutes.length } : {}),
    networkConditionState: browser.networkConditionState(tab.id),
    ...(tab.inspectorIssues.length ? { inspectorIssueCount: tab.inspectorIssues.length } : {}),
    ...(tab.reproRecording ? {
      reproRecording: {
        active: tab.reproRecording.active,
        stepCount: tab.reproRecording.steps.length,
        startedAt: tab.reproRecording.startedAt
      }
    } : {}),
    pwaLifecycleActive: browser.pwaLifecycleRecorder.active(tab.id),
    ...(browser.cssStatePreview.summary(tab) ? { cssStatePreview: browser.cssStatePreview.summary(tab) } : {}),
    ...(browser.virtualPasskeys.summary(tab) ? { virtualPasskey: browser.virtualPasskeys.summary(tab) } : {}),
    ...(browser.logpoints.summary(tab) ? { logpoints: browser.logpoints.summary(tab) } : {}),
    ...(tab.domChangesRecording?.observationGeneration === tab.observationGeneration ? {
      domChangesRecording: {
        active: tab.domChangesRecording.active,
        changeCount: tab.domChangesRecording.changeCount,
        startedAt: tab.domChangesRecording.startedAt
      }
    } : {}),
    ...(tab.codeCoverage?.recording ? {
      codeCoverageRecording: {
        startedAt: tab.codeCoverage.recording.startedAt,
        mode: tab.codeCoverage.recording.mode
      }
    } : {}),
    ...(tab.cpuProfile?.recording ? {
      cpuProfileRecording: {
        startedAt: tab.cpuProfile.recording.startedAt
      }
    } : {}),
    ...(tab.memoryAllocation?.recording ? {
      memoryAllocationRecording: {
        startedAt: tab.memoryAllocation.recording.startedAt
      }
    } : {}),
    ...(tab.pageProblem ? { pageProblem: { ...tab.pageProblem } } : {}),
    ...(!webContentsDestroyed && showsUntrustedCertificate(tab) ? { untrustedCertificate: true as const } : {}),
    ...(tab.dialog ? { dialog: { ...tab.dialog } } : {}),
    ...(tab.mcpGroupId ? {
      mcpGroupId: tab.mcpGroupId,
      mcpGroupName: browser.mcpTabGroups.get(tab.mcpGroupId)?.name ?? 'Unknown group'
    } : {})
  }
}
