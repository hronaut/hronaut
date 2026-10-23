import { isResolvedThemeName } from '../../../shared/theme.js'
import type { SupportedLocale } from '../../../shared/locale.js'
import type { AgentPresence } from '../../../shared/agent-presence.js'
import {
  SIDEBAR_OVERLAY_FAVICON_LIMIT,
  SIDEBAR_OVERLAY_MAX_TABS,
  SIDEBAR_OVERLAY_MAX_WORKSPACES,
  SIDEBAR_OVERLAY_TEXT_LIMIT,
  type SidebarOverlayAgent,
  type SidebarOverlayModel,
  type SidebarOverlayPlatform,
  type SidebarOverlayTab
} from '../../../shared/sidebar-overlay.js'
import type {
  AppUpdateState,
  BrowserDownloadState,
  BrowserState,
  BrowserTabState,
  McpControlState,
  McpTabActivity,
  UserAttentionRequest
} from '../../../shared/types.js'

/** What the open rail over the page shows, as the shell's own rail and its footer show it. */
export interface SidebarOverlayModelInputs {
  /** The shell's resolved theme, as its root element names it. */
  theme: string | undefined
  locale: SupportedLocale
  platform: SidebarOverlayPlatform
  width: number
  top: number
  viewport: { width: number; height: number }
  /** The workspace color washing the shell's surface, as its root element sets it; empty for none. */
  tint: string
  state: BrowserState
  settingsActive: boolean
  workspaceSwitcherOpen: boolean
  userAttention: UserAttentionRequest | null | undefined
  collapsedWorkspaceIds: Iterable<string>
  agents: Readonly<Record<string, readonly AgentPresence[]>>
  scrollTop: number
  mcpActivityByTab: Readonly<Record<string, McpTabActivity>>
  tabTooltip: (tab: BrowserTabState) => string
  describeEmulation: (tab: BrowserTabState) => string
  footer: {
    commandPaletteOpen: boolean
    tabSearchOpen: boolean
    downloadsOpen: boolean
    historyOpen: boolean
    settingsOpen: boolean
    downloads: readonly BrowserDownloadState[]
    activeDownloads: readonly BrowserDownloadState[]
    downloadButtonLabel: string
    hasWebsiteTabs: boolean
    allTabsMuted: boolean
    allInteractionLocked: boolean
    allInteractionLockLabel: string
    interactionPending: boolean
    audioPending: boolean
    followAgentActivity: boolean
    showUpdateStatus: boolean
    updateState: AppUpdateState
    licenseReminderShown: boolean
    mcpEndpoint: string
    mcpState: McpControlState
    mcpPauseBusy: boolean
  }
}

const AGENTS_PER_WORKSPACE = 64

function clip(text: string, limit = SIDEBAR_OVERLAY_TEXT_LIMIT): string {
  return text.length > limit ? text.slice(0, limit) : text
}

function railTab(tab: BrowserTabState, inputs: SidebarOverlayModelInputs): SidebarOverlayTab {
  const command = inputs.mcpActivityByTab[tab.id]?.toolName
  const favicon = tab.faviconDataUrl && tab.faviconDataUrl.length <= SIDEBAR_OVERLAY_FAVICON_LIMIT && tab.faviconDataUrl.startsWith('data:image/')
    ? tab.faviconDataUrl
    : undefined
  return {
    id: tab.id,
    title: clip(tab.title),
    url: clip(tab.url, 8_192),
    ...(tab.label !== undefined ? { label: clip(tab.label) } : {}),
    active: tab.active,
    pinned: tab.pinned,
    loading: tab.loading,
    sleeping: tab.sleeping,
    ...(tab.pageLifecycleState !== undefined ? { pageLifecycleState: tab.pageLifecycleState } : {}),
    humanInteractionLocked: tab.humanInteractionLocked,
    ...(tab.humanInteractionInputLocked !== undefined ? { humanInteractionInputLocked: tab.humanInteractionInputLocked } : {}),
    ...(favicon ? { faviconDataUrl: favicon } : {}),
    audible: tab.audible,
    muted: tab.muted,
    ...(tab.mcpGroupId !== undefined ? { mcpGroupId: tab.mcpGroupId } : {}),
    pageProblem: Boolean(tab.pageProblem),
    emulation: Boolean(tab.emulation),
    emulationDescription: tab.emulation ? clip(inputs.describeEmulation(tab)) : '',
    ...(tab.networkRouteCount !== undefined ? { networkRouteCount: tab.networkRouteCount } : {}),
    networkConditionUnconfirmed: Boolean(tab.networkConditionState && tab.networkConditionState.application !== 'confirmed'),
    videoRecording: tab.videoRecording === 'recording',
    pwaLifecycleActive: tab.pwaLifecycleActive === true,
    tooltip: clip(inputs.tabTooltip(tab)),
    ...(command ? { agentCommand: clip(command, 200) } : {})
  }
}

function railAgent(agent: AgentPresence): SidebarOverlayAgent {
  return { clientKey: agent.clientKey, name: clip(agent.name, 200), initial: clip(agent.initial, 8), colorIndex: agent.colorIndex, state: agent.state }
}

/** A copy of what the open rail shows, in plain data the view can be sent; null when it is too large to send. */
export function sidebarOverlayModel(inputs: SidebarOverlayModelInputs): SidebarOverlayModel | null {
  const { state, footer } = inputs
  if (state.tabs.length > SIDEBAR_OVERLAY_MAX_TABS || state.mcpTabGroups.length > SIDEBAR_OVERLAY_MAX_WORKSPACES) return null
  const tint = inputs.tint.trim().toLowerCase()
  const attention = inputs.userAttention
  const workspaceIds = new Set(state.mcpTabGroups.map((group) => group.id))
  const agents: Record<string, SidebarOverlayAgent[]> = {}
  for (const [workspaceId, present] of Object.entries(inputs.agents)) {
    if (workspaceIds.has(workspaceId) && present.length) agents[workspaceId] = present.slice(0, AGENTS_PER_WORKSPACE).map(railAgent)
  }
  const mcp = footer.mcpState
  return {
    theme: isResolvedThemeName(inputs.theme) ? inputs.theme : 'light',
    locale: inputs.locale,
    platform: inputs.platform,
    width: inputs.width,
    top: Math.max(0, inputs.top),
    viewport: { width: Math.max(1, inputs.viewport.width), height: Math.max(1, inputs.viewport.height) },
    tint: /^#[0-9a-f]{6}$/.test(tint) ? tint : null,
    rail: {
      tabs: state.tabs.map((tab) => railTab(tab, inputs)),
      workspaces: state.mcpTabGroups.map((group) => ({
        id: group.id,
        name: clip(group.name),
        description: clip(group.description),
        color: group.color,
        ...(group.pinnedAt !== undefined ? { pinnedAt: clip(group.pinnedAt, 64) } : {}),
        ...(group.hiddenFromSidebar !== undefined ? { hiddenFromSidebar: group.hiddenFromSidebar } : {})
      })),
      activeTabId: state.activeTabId,
      ...(state.splitView
        ? { splitView: { firstTabId: state.splitView.firstTabId, secondTabId: state.splitView.secondTabId, orientation: state.splitView.orientation } }
        : {}),
      allHumanInteractionLocked: state.allHumanInteractionLocked,
      allTabsMuted: state.allTabsMuted === true,
      ...(state.agentFollow ? { agentFollow: { tabId: state.agentFollow.tabId, agentName: clip(state.agentFollow.agentName, 200) } } : {}),
      settingsActive: inputs.settingsActive,
      workspaceSwitcherOpen: inputs.workspaceSwitcherOpen,
      ...(attention
        ? {
            attention: {
              ...(attention.tabId !== undefined ? { tabId: attention.tabId } : {}),
              ...(attention.workspaceId !== undefined ? { workspaceId: attention.workspaceId } : {}),
              reason: clip(attention.reason),
              decision: attention.humanWaitingDecisionId !== undefined
            }
          }
        : {}),
      collapsedWorkspaceIds: [...inputs.collapsedWorkspaceIds].filter((id) => workspaceIds.has(id)),
      agents,
      scrollTop: Math.max(0, inputs.scrollTop)
    },
    footer: {
      commandPaletteOpen: footer.commandPaletteOpen,
      tabSearchOpen: footer.tabSearchOpen,
      downloadsOpen: footer.downloadsOpen,
      historyOpen: footer.historyOpen,
      settingsOpen: footer.settingsOpen,
      downloadCount: Math.min(footer.downloads.length, 99),
      activeDownloadCount: Math.min(footer.activeDownloads.length, 99),
      lastDownloadDone: footer.downloads[0]?.state === 'completed' && !footer.downloads[0].fileRemoved,
      downloadButtonLabel: clip(footer.downloadButtonLabel),
      hasWebsiteTabs: footer.hasWebsiteTabs,
      allTabsMuted: footer.allTabsMuted,
      allInteractionLocked: footer.allInteractionLocked,
      allInteractionLockLabel: clip(footer.allInteractionLockLabel),
      interactionPending: footer.interactionPending,
      audioPending: footer.audioPending,
      followAgentActivity: footer.followAgentActivity,
      ...(footer.showUpdateStatus
        ? {
            update: {
              status: footer.updateState.status,
              currentVersion: clip(footer.updateState.currentVersion, 100),
              ...(footer.updateState.availableVersion !== undefined ? { availableVersion: clip(footer.updateState.availableVersion, 100) } : {}),
              ...(footer.updateState.percent !== undefined ? { percent: Math.min(100, Math.max(0, footer.updateState.percent)) } : {}),
              ...(footer.updateState.message !== undefined ? { message: clip(footer.updateState.message) } : {})
            }
          }
        : {}),
      licenseReminderShown: footer.licenseReminderShown,
      mcp: {
        endpoint: clip(footer.mcpEndpoint, 8_192),
        state: {
          ...(mcp.readiness ? { readiness: { initializedClientCount: mcp.readiness.initializedClientCount, probe: mcp.readiness.probe } } : {}),
          status: mcp.status,
          paused: mcp.paused,
          ...(mcp.activeCommands !== undefined ? { activeCommands: mcp.activeCommands } : {}),
          ...(mcp.agents ? { agents: mcp.agents.slice(0, AGENTS_PER_WORKSPACE).map((agent) => ({ key: agent.key, name: clip(agent.name, 200), state: agent.state })) } : {}),
          ...(mcp.error !== undefined ? { error: clip(mcp.error) } : {}),
          ...(mcp.errorCode !== undefined ? { errorCode: mcp.errorCode } : {}),
          ...(mcp.failedPort !== undefined ? { failedPort: mcp.failedPort } : {}),
          ...(mcp.suggestedPort !== undefined ? { suggestedPort: mcp.suggestedPort } : {})
        },
        pauseBusy: footer.mcpPauseBusy
      }
    }
  }
}
