import type { BrowserState, BrowserTabState } from '../../../shared/types.js'
import type { BrowserStateAccess, BrowserStateTab } from './browser-state-access.js'

/**
 * The browser state the shell and MCP see: every tab in order, the recently
 * closed tabs newest first, the active tab, the split view, the global
 * mute, lock and pause, the MCP address and profile, the workspaces and the
 * followed agent.
 */
export function getState<Tab extends BrowserStateTab>(access: BrowserStateAccess<Tab>): BrowserState {
  const agentFollow = access.publishedAgentFollow()
  return {
    tabs: access.orderedTabs().map((tab) => toState(access, tab)),
    closedTabs: [...access.closedTabs()].reverse().map((tab) => ({ ...tab })),
    activeTabId: access.activeTabId(),
    ...(access.splitView() ? { splitView: { ...access.splitView()! } } : {}),
    allTabsMuted: access.allTabsMuted(),
    allHumanInteractionLocked: access.allHumanInteractionLocked(),
    agentControlLocked: access.allAgentsPaused() && !access.agentPauseOverridesAllowed(),
    mcpUrl: access.mcpUrl(),
    profilePath: access.options().profilePath,
    mcpTabGroups: access.listMcpTabGroups(),
    savedTabGroups: access.listSavedTabGroups(),
    ...(agentFollow ? { agentFollow } : {})
  }
}

/** One tab as the browser state shows it, from its fields and the manager's view of it. */
function toState<Tab extends BrowserStateTab>(access: BrowserStateAccess<Tab>, tab: Tab): BrowserTabState {
  const navigation = access.navigationButtons(tab)
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
    active: tab.id === access.activeTabId(),
    pinned: tab.pinned,
    sleeping: tab.sleeping,
    pageLifecycleState: tab.pageLifecycleState,
    humanInteractionLocked: tab.humanInteractionLocked,
    tabAgentPaused: tab.tabAgentPaused,
    humanInteractionInputLocked: access.isHumanInteractionLocked(tab),
    agentPaused: access.isTabAgentPaused(tab.id),
    ...(access.isTabTakenOver(tab.id) ? { takenOverAt: tab.takeOver!.at } : {}),
    ...(tab.handedBack ? { handedBack: { ...tab.handedBack } } : {}),
    preserveDiagnosticLogs: tab.preserveDiagnosticLogs,
    videoRecording: access.videoRecorder().state(tab.id).status,
    zoomPercent: webContentsDestroyed ? 100 : Math.round(tab.webContents.getZoomFactor() * 100),
    ...(tab.zoomIsolated ? { zoomIsolated: true } : {}),
    ...(tab.defaultFontSize ? { defaultFontSize: tab.defaultFontSize } : {}),
    ...(tab.faviconDataUrl ? { faviconDataUrl: tab.faviconDataUrl } : {}),
    audible: tab.audible,
    tabMuted: tab.tabMuted,
    muted: tab.muted,
    devToolsOpen: !webContentsDestroyed && tab.webContents.isDevToolsOpened(),
    ...access.emulationProjection(tab),
    ...(tab.networkRoutes.length ? { networkRouteCount: tab.networkRoutes.length } : {}),
    networkConditionState: access.networkConditionState(tab.id),
    ...(tab.inspectorIssues.length ? { inspectorIssueCount: tab.inspectorIssues.length } : {}),
    ...(tab.reproRecording ? {
      reproRecording: {
        active: tab.reproRecording.active,
        stepCount: tab.reproRecording.steps.length,
        startedAt: tab.reproRecording.startedAt
      }
    } : {}),
    pwaLifecycleActive: access.pwaLifecycleRecorder().active(tab.id),
    ...(access.cssStatePreview().summary(tab) ? { cssStatePreview: access.cssStatePreview().summary(tab) } : {}),
    ...(access.virtualPasskeys().summary(tab) ? { virtualPasskey: access.virtualPasskeys().summary(tab) } : {}),
    ...(access.logpoints().summary(tab) ? { logpoints: access.logpoints().summary(tab) } : {}),
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
    ...(tab.dialog ? { dialog: { ...tab.dialog } } : {}),
    ...(tab.mcpGroupId ? {
      mcpGroupId: tab.mcpGroupId,
      mcpGroupName: access.mcpTabGroups().get(tab.mcpGroupId)?.name ?? 'Unknown group'
    } : {})
  }
}
