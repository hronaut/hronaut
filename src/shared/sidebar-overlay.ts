import { isResolvedThemeName, type ResolvedThemeName } from './theme.js'
import { isSupportedLocale, type SupportedLocale } from './locale.js'
import { isBrowserTabGroupColor, type BrowserTabGroupColor } from './tab-groups.js'
import type { AgentPresenceState } from './agent-presence.js'
import type { AppUpdateState, McpControlState } from './types.js'
import type { ShellTooltipRequest } from './shell-tooltip.js'

/**
 * With the tab rail collapsed when not in use, resting the pointer on it opens the rail over the page instead of
 * beside it, as in Zen browser: the page keeps its size and place and goes on running under it. The page views sit
 * above the shell's own DOM, so main draws the open rail in a native view of its own, exactly the rail's box and no
 * larger, above the page and below toasts, tooltips, the agent card and address suggestions. The shell keeps the rail,
 * its state and its commands; it sends main what the open rail shows, main forwards it to the view, and once the view
 * has drawn that revision main places and shows it. What the person does in the view comes back through main to the
 * shell, which runs it as it runs a click in its own rail. Keyboard focus still opens the shell's own rail.
 */

/** Most tabs and workspaces the open rail lists; a larger rail is the shell's own to show. */
export const SIDEBAR_OVERLAY_MAX_TABS = 1_000
export const SIDEBAR_OVERLAY_MAX_WORKSPACES = 1_000
/** Longest text the view draws for one tab, workspace or button; the shell cuts longer text before sending it. */
export const SIDEBAR_OVERLAY_TEXT_LIMIT = 2_000
/** Largest favicon the view draws, as a data URL; the shell leaves out a larger one and the tab shows its globe. */
export const SIDEBAR_OVERLAY_FAVICON_LIMIT = 200_000
const ID_LIMIT = 128
const AGENTS_PER_WORKSPACE_LIMIT = 64
const URL_LIMIT = 8_192

export type SidebarOverlayPlatform = 'darwin' | 'win32' | 'linux'
export type SidebarOverlayLifecycle = 'active' | 'frozen' | 'unknown'

/** A tab as the rail draws it: its name, marks and state, not its page. */
export interface SidebarOverlayTab {
  id: string
  title: string
  url: string
  label?: string
  active: boolean
  pinned: boolean
  loading: boolean
  sleeping: boolean
  pageLifecycleState?: SidebarOverlayLifecycle
  humanInteractionLocked: boolean
  humanInteractionInputLocked?: boolean
  faviconDataUrl?: string
  audible: boolean
  muted: boolean
  mcpGroupId?: string
  /** The page failed to load or needs attention; the rail draws its warning mark. */
  pageProblem: boolean
  /** The tab emulates a device or conditions; the rail draws its speed mark, named by `emulationDescription`. */
  emulation: boolean
  emulationDescription: string
  networkRouteCount?: number
  /** Its network conditions are not confirmed applied; the rail draws its route mark. */
  networkConditionUnconfirmed: boolean
  videoRecording: boolean
  pwaLifecycleActive: boolean
  /** The tab's name as the rail's tooltip and accessible name give it. */
  tooltip: string
  /** The agent command running in the tab now, if any. */
  agentCommand?: string
}

export interface SidebarOverlayWorkspace {
  id: string
  name: string
  description: string
  color: BrowserTabGroupColor
  pinnedAt?: string
  hiddenFromSidebar?: boolean
}

/** An agent's avatar in its workspace's header, as the rail draws it. */
export interface SidebarOverlayAgent {
  clientKey: string
  name: string
  initial: string
  colorIndex: number
  state: AgentPresenceState
}

export interface SidebarOverlayRail {
  tabs: SidebarOverlayTab[]
  workspaces: SidebarOverlayWorkspace[]
  activeTabId: string | null
  splitView?: { firstTabId: string; secondTabId: string; orientation: 'vertical' | 'horizontal' }
  allHumanInteractionLocked: boolean
  allTabsMuted: boolean
  agentFollow?: { tabId: string; agentName: string }
  settingsActive: boolean
  workspaceSwitcherOpen: boolean
  /** The agent's request for the person, by the tab or workspace it names. */
  attention?: { tabId?: string; workspaceId?: string; reason: string; decision: boolean }
  /** The workspaces folded in the rail. */
  collapsedWorkspaceIds: string[]
  /** The agents in each workspace, in display order. */
  agents: Record<string, SidebarOverlayAgent[]>
  /** How far the shell's tab list is scrolled, in CSS pixels; the open rail starts there. */
  scrollTop: number
}

/** The rail's footer commands and what their buttons show. */
export interface SidebarOverlayFooter {
  commandPaletteOpen: boolean
  tabSearchOpen: boolean
  downloadsOpen: boolean
  historyOpen: boolean
  settingsOpen: boolean
  /** How many downloads the badge counts, at most 99. */
  downloadCount: number
  activeDownloadCount: number
  /** The newest download finished and its file is still there. */
  lastDownloadDone: boolean
  downloadButtonLabel: string
  hasWebsiteTabs: boolean
  allTabsMuted: boolean
  allInteractionLocked: boolean
  allInteractionLockLabel: string
  interactionPending: boolean
  audioPending: boolean
  followAgentActivity: boolean
  /** The update pill's state, while the rail shows it. */
  update?: AppUpdateState
  licenseReminderShown: boolean
  mcp: { endpoint: string; state: McpControlState; pauseBusy: boolean }
}

/** Everything the open rail draws, from the shell. */
export interface SidebarOverlayModel {
  theme: ResolvedThemeName
  locale: SupportedLocale
  platform: SidebarOverlayPlatform
  /** The open rail's width in the shell's CSS pixels. */
  width: number
  /** Where the rail's content starts below the window's top edge, in CSS pixels: below a title bar drawn by the shell. */
  top: number
  /** The shell's viewport, in CSS pixels, which the rail's surface wash and layout follow. */
  viewport: { width: number; height: number }
  /** The color of the workspace in view, which washes the rail's surface; null for none. */
  tint: string | null
  rail: SidebarOverlayRail
  footer: SidebarOverlayFooter
}

/** What the shell asks main to show for the reveal with this id; the same id again updates what shows. */
export interface SidebarOverlayRequest {
  id: number
  model: SidebarOverlayModel
}

/** What main sends the view: the model, and a revision the view reports back once it has drawn it. */
export interface SidebarOverlayState {
  revision: number
  /** The reveal it belongs to; a new one starts at the shell's scroll position again. */
  session: number
  model: SidebarOverlayModel
}

export interface SidebarOverlayRendered {
  revision: number
}

/** Whether the pointer is over the view, and whether a press or a drag in it holds it open. */
export interface SidebarOverlayPointer {
  hovered: boolean
  held: boolean
}

export const SIDEBAR_OVERLAY_FOOTER_ACTIONS = [
  'command-palette',
  'tab-search',
  'downloads',
  'history',
  'all-tabs-muted',
  'all-interaction',
  'follow-agent-activity',
  'update-settings',
  'license-settings',
  'settings',
  'mcp-summary',
  'mcp-pause'
] as const
export type SidebarOverlayFooterAction = typeof SIDEBAR_OVERLAY_FOOTER_ACTIONS[number]

/** What the person did in the view, as the shell's own rail reports it. Nothing else comes back from the view. */
export type SidebarOverlayIntent =
  | { kind: 'open-home' }
  | { kind: 'select-tab'; tabId: string }
  | { kind: 'close-tab'; tabId: string }
  | { kind: 'toggle-tab-muted'; tabId: string }
  | { kind: 'stop-worker-capture'; tabId: string }
  | { kind: 'tab-context-menu'; tabId: string }
  | { kind: 'reorder-tab'; tabId: string; targetTabId: string; placement: 'before' | 'after' }
  | { kind: 'new-tab'; workspaceId?: string }
  | { kind: 'workspace-context-menu'; workspaceId: string }
  | { kind: 'toggle-workspace'; workspaceId: string }
  | { kind: 'create-workspace' }
  | { kind: 'switch-workspace' }
  | { kind: 'stay-here' }
  | { kind: 'toggle-rail-pinned' }
  | { kind: 'drag-start' }
  | { kind: 'scroll'; top: number }
  | { kind: 'dismiss' }
  | { kind: 'footer'; action: SidebarOverlayFooterAction }

/** Why main took the open rail down by itself. */
export type SidebarOverlayHiddenReason = 'blur' | 'window' | 'occluded' | 'fullscreen' | 'lost'

/**
 * What the shell hears about the reveal with this id: the view shows it, the view cannot show it (the shell then opens
 * its own rail beside the page, as before), main took it down, where the pointer is, or what the person did in it.
 */
export type SidebarOverlayEvent =
  | { id: number; kind: 'shown' }
  | { id: number; kind: 'unavailable' }
  | { id: number; kind: 'hidden'; reason: SidebarOverlayHiddenReason }
  | ({ id: number; kind: 'pointer' } & SidebarOverlayPointer)
  | { id: number; kind: 'intent'; intent: SidebarOverlayIntent }

export interface HronautSidebarOverlayApi {
  show(request: SidebarOverlayRequest): void
  hide(id: number): void
  onEvent(listener: (event: SidebarOverlayEvent) => void): () => void
}

/** What the open rail's view can do: hear what to draw, and report that it drew it, where the pointer is and what the person did. */
export interface HronautSidebarOverlayViewApi {
  onState(listener: (state: SidebarOverlayState) => void): () => void
  rendered(report: SidebarOverlayRendered): void
  pointer(pointer: SidebarOverlayPointer): void
  intent(intent: SidebarOverlayIntent): void
  /** Its controls' tooltips, which main shows beside the control as it shows the shell's. */
  showTooltip(request: ShellTooltipRequest): void
  hideTooltip(id?: number): void
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function invalid(what: string): never {
  throw new TypeError(`Invalid sidebar overlay ${what}`)
}

export function validSidebarOverlayId(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1
}

/** The id of the reveal a request is for, even one main will not draw; undefined without a valid one. */
export function sidebarOverlayRequestId(value: unknown): number | undefined {
  const id = record(value)?.id
  return validSidebarOverlayId(id) ? id : undefined
}

function text(value: unknown, what: string, limit = SIDEBAR_OVERLAY_TEXT_LIMIT): string {
  if (typeof value !== 'string' || value.length > limit) invalid(what)
  return value
}

function optionalText(value: unknown, what: string, limit = SIDEBAR_OVERLAY_TEXT_LIMIT): string | undefined {
  return value === undefined ? undefined : text(value, what, limit)
}

function identifier(value: unknown, what: string): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > ID_LIMIT || value.trim() !== value) invalid(what)
  return value
}

function optionalIdentifier(value: unknown, what: string): string | undefined {
  return value === undefined ? undefined : identifier(value, what)
}

function flag(value: unknown, what: string): boolean {
  if (typeof value !== 'boolean') invalid(what)
  return value
}

function optionalFlag(value: unknown, what: string): boolean | undefined {
  return value === undefined ? undefined : flag(value, what)
}

function count(value: unknown, what: string, maximum = 1_000_000): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > maximum) invalid(what)
  return value as number
}

function length(value: unknown, what: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) invalid(what)
  return value
}

function list(value: unknown, what: string, limit: number): unknown[] {
  if (!Array.isArray(value) || value.length > limit) invalid(what)
  return value
}

function parseTab(value: unknown): SidebarOverlayTab {
  const tab = record(value) ?? invalid('tab')
  const lifecycle = tab.pageLifecycleState
  if (lifecycle !== undefined && lifecycle !== 'active' && lifecycle !== 'frozen' && lifecycle !== 'unknown') invalid('tab lifecycle')
  const favicon = optionalText(tab.faviconDataUrl, 'favicon', SIDEBAR_OVERLAY_FAVICON_LIMIT)
  if (favicon !== undefined && !favicon.startsWith('data:image/')) invalid('favicon')
  const label = optionalText(tab.label, 'tab label')
  const inputLocked = optionalFlag(tab.humanInteractionInputLocked, 'tab lock')
  const groupId = optionalIdentifier(tab.mcpGroupId, 'tab workspace')
  const routes = tab.networkRouteCount === undefined ? undefined : count(tab.networkRouteCount, 'tab routes')
  const command = optionalText(tab.agentCommand, 'tab command', 200)
  return {
    id: identifier(tab.id, 'tab id'),
    title: text(tab.title, 'tab title'),
    url: text(tab.url, 'tab url', URL_LIMIT),
    ...(label !== undefined ? { label } : {}),
    active: flag(tab.active, 'tab'),
    pinned: flag(tab.pinned, 'tab'),
    loading: flag(tab.loading, 'tab'),
    sleeping: flag(tab.sleeping, 'tab'),
    ...(lifecycle !== undefined ? { pageLifecycleState: lifecycle } : {}),
    humanInteractionLocked: flag(tab.humanInteractionLocked, 'tab'),
    ...(inputLocked !== undefined ? { humanInteractionInputLocked: inputLocked } : {}),
    ...(favicon !== undefined ? { faviconDataUrl: favicon } : {}),
    audible: flag(tab.audible, 'tab'),
    muted: flag(tab.muted, 'tab'),
    ...(groupId !== undefined ? { mcpGroupId: groupId } : {}),
    pageProblem: flag(tab.pageProblem, 'tab'),
    emulation: flag(tab.emulation, 'tab'),
    emulationDescription: text(tab.emulationDescription, 'tab emulation'),
    ...(routes !== undefined ? { networkRouteCount: routes } : {}),
    networkConditionUnconfirmed: flag(tab.networkConditionUnconfirmed, 'tab'),
    videoRecording: flag(tab.videoRecording, 'tab'),
    pwaLifecycleActive: flag(tab.pwaLifecycleActive, 'tab'),
    tooltip: text(tab.tooltip, 'tab tooltip'),
    ...(command !== undefined ? { agentCommand: command } : {})
  }
}

function parseWorkspace(value: unknown): SidebarOverlayWorkspace {
  const workspace = record(value) ?? invalid('workspace')
  if (!isBrowserTabGroupColor(workspace.color)) invalid('workspace color')
  const pinnedAt = optionalText(workspace.pinnedAt, 'workspace pin', 64)
  const hidden = optionalFlag(workspace.hiddenFromSidebar, 'workspace')
  return {
    id: identifier(workspace.id, 'workspace id'),
    name: text(workspace.name, 'workspace name'),
    description: text(workspace.description, 'workspace description'),
    color: workspace.color,
    ...(pinnedAt !== undefined ? { pinnedAt } : {}),
    ...(hidden !== undefined ? { hiddenFromSidebar: hidden } : {})
  }
}

function presenceState(value: unknown, what: string): AgentPresenceState {
  if (value !== 'idle' && value !== 'working' && value !== 'needs-you') invalid(what)
  return value
}

function parseAgent(value: unknown): SidebarOverlayAgent {
  const agent = record(value) ?? invalid('agent')
  const state = presenceState(agent.state, 'agent state')
  return {
    clientKey: identifier(agent.clientKey, 'agent'),
    name: text(agent.name, 'agent name', 200),
    initial: text(agent.initial, 'agent initial', 8),
    colorIndex: count(agent.colorIndex, 'agent color', 64),
    state
  }
}

function parseRail(value: unknown): SidebarOverlayRail {
  const rail = record(value) ?? invalid('rail')
  const tabs = list(rail.tabs, 'tabs', SIDEBAR_OVERLAY_MAX_TABS).map(parseTab)
  const workspaces = list(rail.workspaces, 'workspaces', SIDEBAR_OVERLAY_MAX_WORKSPACES).map(parseWorkspace)
  const activeTabId = rail.activeTabId === null ? null : identifier(rail.activeTabId, 'active tab')
  let splitView: SidebarOverlayRail['splitView']
  if (rail.splitView !== undefined) {
    const split = record(rail.splitView) ?? invalid('split view')
    if (split.orientation !== 'vertical' && split.orientation !== 'horizontal') invalid('split view')
    splitView = { firstTabId: identifier(split.firstTabId, 'split view'), secondTabId: identifier(split.secondTabId, 'split view'), orientation: split.orientation }
  }
  let agentFollow: SidebarOverlayRail['agentFollow']
  if (rail.agentFollow !== undefined) {
    const follow = record(rail.agentFollow) ?? invalid('follow')
    agentFollow = { tabId: identifier(follow.tabId, 'follow'), agentName: text(follow.agentName, 'follow', 200) }
  }
  let attention: SidebarOverlayRail['attention']
  if (rail.attention !== undefined) {
    const request = record(rail.attention) ?? invalid('attention')
    const tabId = optionalIdentifier(request.tabId, 'attention')
    const workspaceId = optionalIdentifier(request.workspaceId, 'attention')
    attention = {
      ...(tabId !== undefined ? { tabId } : {}),
      ...(workspaceId !== undefined ? { workspaceId } : {}),
      reason: text(request.reason, 'attention'),
      decision: flag(request.decision, 'attention')
    }
  }
  const agentsSource = record(rail.agents) ?? invalid('agents')
  const agentEntries = Object.entries(agentsSource)
  if (agentEntries.length > SIDEBAR_OVERLAY_MAX_WORKSPACES) invalid('agents')
  const agents: Record<string, SidebarOverlayAgent[]> = {}
  for (const [workspaceId, entries] of agentEntries) {
    agents[identifier(workspaceId, 'agents')] = list(entries, 'agents', AGENTS_PER_WORKSPACE_LIMIT).map(parseAgent)
  }
  return {
    tabs,
    workspaces,
    activeTabId,
    ...(splitView ? { splitView } : {}),
    allHumanInteractionLocked: flag(rail.allHumanInteractionLocked, 'rail'),
    allTabsMuted: flag(rail.allTabsMuted, 'rail'),
    ...(agentFollow ? { agentFollow } : {}),
    settingsActive: flag(rail.settingsActive, 'rail'),
    workspaceSwitcherOpen: flag(rail.workspaceSwitcherOpen, 'rail'),
    ...(attention ? { attention } : {}),
    collapsedWorkspaceIds: list(rail.collapsedWorkspaceIds, 'folded workspaces', SIDEBAR_OVERLAY_MAX_WORKSPACES)
      .map((id) => identifier(id, 'folded workspace')),
    agents,
    scrollTop: length(rail.scrollTop, 'scroll position', 0, 10_000_000)
  }
}

const UPDATE_STATUSES = new Set(['idle', 'checking', 'available', 'downloading', 'downloaded', 'installing', 'up-to-date', 'error', 'install-error', 'disabled'])
const MCP_STATUSES = new Set(['starting', 'ready', 'paused', 'error'])
const MCP_PROBES = new Set(['probe_verified', 'probe_failed', 'unknown', 'blocked'])
const MCP_ERROR_CODES = new Set(['port-in-use', 'port-denied', 'other'])

function parseUpdate(value: unknown): AppUpdateState {
  const update = record(value) ?? invalid('update')
  if (!UPDATE_STATUSES.has(update.status as string)) invalid('update status')
  const availableVersion = optionalText(update.availableVersion, 'update', 100)
  const message = optionalText(update.message, 'update')
  const percent = update.percent === undefined ? undefined : length(update.percent, 'update', 0, 100)
  // The pill shows only its status; release notes stay in Settings.
  return {
    status: update.status as AppUpdateState['status'],
    currentVersion: text(update.currentVersion, 'update', 100),
    ...(availableVersion !== undefined ? { availableVersion } : {}),
    ...(percent !== undefined ? { percent } : {}),
    ...(message !== undefined ? { message } : {})
  }
}

function parseMcpState(value: unknown): McpControlState {
  const state = record(value) ?? invalid('MCP state')
  if (!MCP_STATUSES.has(state.status as string)) invalid('MCP status')
  let readiness: McpControlState['readiness']
  if (state.readiness !== undefined) {
    const source = record(state.readiness) ?? invalid('MCP readiness')
    if (!MCP_PROBES.has(source.probe as string)) invalid('MCP readiness')
    readiness = { initializedClientCount: count(source.initializedClientCount, 'MCP readiness'), probe: source.probe as NonNullable<McpControlState['readiness']>['probe'] }
  }
  const agents = state.agents === undefined ? undefined : list(state.agents, 'MCP agents', AGENTS_PER_WORKSPACE_LIMIT).map((entry) => {
    const agent = record(entry) ?? invalid('MCP agent')
    return { key: identifier(agent.key, 'MCP agent'), name: text(agent.name, 'MCP agent', 200), state: presenceState(agent.state, 'MCP agent') }
  })
  if (state.errorCode !== undefined && !MCP_ERROR_CODES.has(state.errorCode as string)) invalid('MCP error')
  const activeCommands = state.activeCommands === undefined ? undefined : count(state.activeCommands, 'MCP commands')
  const error = optionalText(state.error, 'MCP error')
  const failedPort = state.failedPort === undefined ? undefined : count(state.failedPort, 'MCP port', 65_535)
  const suggestedPort = state.suggestedPort === undefined ? undefined : count(state.suggestedPort, 'MCP port', 65_535)
  return {
    ...(readiness ? { readiness } : {}),
    status: state.status as McpControlState['status'],
    paused: flag(state.paused, 'MCP state'),
    ...(activeCommands !== undefined ? { activeCommands } : {}),
    ...(agents ? { agents } : {}),
    ...(error !== undefined ? { error } : {}),
    ...(state.errorCode !== undefined ? { errorCode: state.errorCode as McpControlState['errorCode'] } : {}),
    ...(failedPort !== undefined ? { failedPort } : {}),
    ...(suggestedPort !== undefined ? { suggestedPort } : {})
  }
}

function parseFooter(value: unknown): SidebarOverlayFooter {
  const footer = record(value) ?? invalid('footer')
  const mcp = record(footer.mcp) ?? invalid('MCP')
  return {
    commandPaletteOpen: flag(footer.commandPaletteOpen, 'footer'),
    tabSearchOpen: flag(footer.tabSearchOpen, 'footer'),
    downloadsOpen: flag(footer.downloadsOpen, 'footer'),
    historyOpen: flag(footer.historyOpen, 'footer'),
    settingsOpen: flag(footer.settingsOpen, 'footer'),
    downloadCount: count(footer.downloadCount, 'downloads', 99),
    activeDownloadCount: count(footer.activeDownloadCount, 'downloads', 99),
    lastDownloadDone: flag(footer.lastDownloadDone, 'downloads'),
    downloadButtonLabel: text(footer.downloadButtonLabel, 'footer'),
    hasWebsiteTabs: flag(footer.hasWebsiteTabs, 'footer'),
    allTabsMuted: flag(footer.allTabsMuted, 'footer'),
    allInteractionLocked: flag(footer.allInteractionLocked, 'footer'),
    allInteractionLockLabel: text(footer.allInteractionLockLabel, 'footer'),
    interactionPending: flag(footer.interactionPending, 'footer'),
    audioPending: flag(footer.audioPending, 'footer'),
    followAgentActivity: flag(footer.followAgentActivity, 'footer'),
    ...(footer.update !== undefined ? { update: parseUpdate(footer.update) } : {}),
    licenseReminderShown: flag(footer.licenseReminderShown, 'footer'),
    mcp: { endpoint: text(mcp.endpoint, 'MCP endpoint', URL_LIMIT), state: parseMcpState(mcp.state), pauseBusy: flag(mcp.pauseBusy, 'MCP') }
  }
}

/** Only an open rail within these limits is drawn; anything else is refused, and the shell opens its own rail instead. */
export function parseSidebarOverlayRequest(value: unknown): SidebarOverlayRequest {
  const request = record(value) ?? invalid('request')
  if (!validSidebarOverlayId(request.id)) invalid('request id')
  const model = record(request.model) ?? invalid('model')
  if (!isResolvedThemeName(model.theme)) invalid('theme')
  if (!isSupportedLocale(model.locale)) invalid('locale')
  if (model.platform !== 'darwin' && model.platform !== 'win32' && model.platform !== 'linux') invalid('platform')
  const viewport = record(model.viewport) ?? invalid('viewport')
  const tint = model.tint === null ? null : text(model.tint, 'tint', 7)
  if (tint !== null && !/^#[0-9a-f]{6}$/i.test(tint)) invalid('tint')
  return {
    id: request.id,
    model: {
      theme: model.theme,
      locale: model.locale,
      platform: model.platform,
      width: length(model.width, 'width', 56, 2_000),
      top: length(model.top, 'top', 0, 400),
      viewport: { width: length(viewport.width, 'viewport', 1, 100_000), height: length(viewport.height, 'viewport', 1, 100_000) },
      tint,
      rail: parseRail(model.rail),
      footer: parseFooter(model.footer)
    }
  }
}

export function parseSidebarOverlayRendered(value: unknown): SidebarOverlayRendered | null {
  const source = record(value)
  return source && validSidebarOverlayId(source.revision) ? { revision: source.revision } : null
}

export function parseSidebarOverlayPointer(value: unknown): SidebarOverlayPointer | null {
  const source = record(value)
  if (!source || typeof source.hovered !== 'boolean' || typeof source.held !== 'boolean') return null
  return { hovered: source.hovered, held: source.held }
}

function idField(value: unknown): string | null {
  return typeof value === 'string' && value.length >= 1 && value.length <= ID_LIMIT && value.trim() === value ? value : null
}

/**
 * Reads what the view reports the person did: only the commands its rail has, each with well-formed ids. Main further
 * admits only a tab or workspace the open rail shows.
 */
export function parseSidebarOverlayIntent(value: unknown): SidebarOverlayIntent | null {
  const source = record(value)
  if (!source) return null
  switch (source.kind) {
    case 'open-home':
    case 'create-workspace':
    case 'switch-workspace':
    case 'stay-here':
    case 'toggle-rail-pinned':
    case 'drag-start':
    case 'dismiss':
      return { kind: source.kind }
    case 'select-tab':
    case 'close-tab':
    case 'toggle-tab-muted':
    case 'stop-worker-capture':
    case 'tab-context-menu': {
      const tabId = idField(source.tabId)
      return tabId ? { kind: source.kind, tabId } : null
    }
    case 'reorder-tab': {
      const tabId = idField(source.tabId)
      const targetTabId = idField(source.targetTabId)
      const placement = source.placement
      return tabId && targetTabId && (placement === 'before' || placement === 'after') ? { kind: 'reorder-tab', tabId, targetTabId, placement } : null
    }
    case 'new-tab': {
      if (source.workspaceId === undefined) return { kind: 'new-tab' }
      const workspaceId = idField(source.workspaceId)
      return workspaceId ? { kind: 'new-tab', workspaceId } : null
    }
    case 'workspace-context-menu':
    case 'toggle-workspace': {
      const workspaceId = idField(source.workspaceId)
      return workspaceId ? { kind: source.kind, workspaceId } : null
    }
    case 'scroll': {
      const top = source.top
      return typeof top === 'number' && Number.isFinite(top) && top >= 0 && top <= 10_000_000 ? { kind: 'scroll', top } : null
    }
    case 'footer':
      return (SIDEBAR_OVERLAY_FOOTER_ACTIONS as readonly unknown[]).includes(source.action)
        ? { kind: 'footer', action: source.action as SidebarOverlayFooterAction }
        : null
    default:
      return null
  }
}

/** The tab and workspace ids an intent acts on, which the open rail must show. */
export function sidebarOverlayIntentTargets(intent: SidebarOverlayIntent): { tabIds: string[]; workspaceIds: string[] } {
  switch (intent.kind) {
    case 'select-tab':
    case 'close-tab':
    case 'toggle-tab-muted':
    case 'stop-worker-capture':
    case 'tab-context-menu':
      return { tabIds: [intent.tabId], workspaceIds: [] }
    case 'reorder-tab':
      return { tabIds: [intent.tabId, intent.targetTabId], workspaceIds: [] }
    case 'new-tab':
      return { tabIds: [], workspaceIds: intent.workspaceId ? [intent.workspaceId] : [] }
    case 'workspace-context-menu':
    case 'toggle-workspace':
      return { tabIds: [], workspaceIds: [intent.workspaceId] }
    default:
      return { tabIds: [], workspaceIds: [] }
  }
}
