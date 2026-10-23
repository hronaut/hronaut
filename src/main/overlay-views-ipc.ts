import type { IpcMain, IpcMainEvent } from 'electron'
import type { AgentCardOverlay } from './agent-card-overlay.js'
import type { ShellOverlayView } from './shell-overlay-view.js'
import type { ShellTooltipOverlay } from './shell-tooltip-overlay.js'
import type { ToastOverlay } from './toast-overlay.js'
import { SIDEBAR_OVERLAY_TOOLTIP_ID_OFFSET, type SidebarOverlay } from './sidebar-overlay.js'
import {
  parseAgentCardMeasurement,
  parseAgentCardShowRequest,
  parseAgentCardViewMessage,
  validAgentCardId,
  type AgentCardShowRequest
} from '../shared/agent-card.js'
import { parseShellTooltipMeasurement, parseShellTooltipRequest } from '../shared/shell-tooltip.js'
import {
  parseSidebarOverlayIntent,
  parseSidebarOverlayPointer,
  parseSidebarOverlayRendered,
  parseSidebarOverlayRequest,
  sidebarOverlayRequestId,
  validSidebarOverlayId,
  type SidebarOverlayRequest
} from '../shared/sidebar-overlay.js'
import {
  parseToastOverlayMeasurement,
  parseToastOverlayMessage,
  parseToastOverlayRequest,
  toastOverlayRequestId,
  type ToastOverlayRequest
} from '../shared/toast-overlay.js'

interface OverlayViewsIpcHost {
  /** Admits only the main window's shell document, not a detached panel window. */
  assertMainShellSender(event: IpcMainEvent): void
  /** Why saved workspaces could not start, if they could not; read on every check. */
  workspaceStartupFailure(): Error | undefined
  shellTooltips(): Pick<ShellTooltipOverlay, 'show' | 'hide' | 'measured' | 'shownId'>
  agentCards(): Pick<AgentCardOverlay, 'refused' | 'show' | 'hide' | 'measured' | 'received'>
  toastOverlay(): Pick<ToastOverlay, 'refused' | 'show' | 'measured' | 'received'>
  /** The transparent view that draws the agent card above the page views. */
  agentCardView(): Pick<ShellOverlayView, 'isSender'>
  /** The transparent view that draws toasts at the bottom of the page area. */
  toastOverlayView(): Pick<ShellOverlayView, 'isSender'>
  /** The transparent view that draws the shell's tooltips above the page views. */
  tooltipView(): Pick<ShellOverlayView, 'isSender'>
  sidebarOverlay(): Pick<SidebarOverlay, 'refused' | 'show' | 'hide' | 'rendered' | 'pointer' | 'received' | 'tooltip'>
  /** The view that draws the open tab rail over the page. */
  sidebarOverlayView(): Pick<ShellOverlayView, 'isSender'>
}

/**
 * The shell's requests to show and hide tooltips, agent cards, toasts and the open tab rail drawn in overlay views
 * above the pages, and those views' own reports. Dependencies stay lazy because handlers are registered before the
 * window loads.
 */
export function registerOverlayViewsIpc(ipcMain: Pick<IpcMain, 'on'>, host: OverlayViewsIpcHost): void {
  function assertAgentCardSender(event: Electron.IpcMainEvent): void {
    if (!host.agentCardView().isSender(event)) throw new Error('Rejected IPC from a non-agent-card renderer')
  }

  function assertToastOverlaySender(event: Electron.IpcMainEvent): void {
    if (!host.toastOverlayView().isSender(event)) throw new Error('Rejected IPC from a non-toast renderer')
  }

  function assertTooltipOverlaySender(event: Electron.IpcMainEvent): void {
    if (!host.tooltipView().isSender(event)) throw new Error('Rejected IPC from a non-tooltip renderer')
  }

  function assertSidebarOverlaySender(event: Electron.IpcMainEvent): void {
    if (!host.sidebarOverlayView().isSender(event)) throw new Error('Rejected IPC from a non-sidebar renderer')
  }

  ipcMain.on('shell-tooltip:show', (event, value: unknown) => {
    if (host.workspaceStartupFailure()) return
    host.assertMainShellSender(event)
    host.shellTooltips().show(parseShellTooltipRequest(value), event.sender.getZoomFactor())
  })
  ipcMain.on('shell-tooltip:hide', (event, id: unknown) => {
    if (host.workspaceStartupFailure()) return
    host.assertMainShellSender(event)
    if (id !== undefined && !(Number.isSafeInteger(id) && (id as number) > 0)) throw new TypeError('Invalid tooltip id')
    host.shellTooltips().hide(id as number | undefined)
  })
  ipcMain.on('agent-card:show', (event, value: unknown) => {
    if (host.workspaceStartupFailure()) return
    host.assertMainShellSender(event)
    let request: AgentCardShowRequest
    try {
      request = parseAgentCardShowRequest(value)
    } catch (error) {
      // Nothing outside the contract is drawn; the shell hears the card closed and resets its avatar.
      const cardId = value && typeof value === 'object' ? (value as { cardId?: unknown }).cardId : undefined
      if (validAgentCardId(cardId)) host.agentCards().refused(cardId)
      throw error
    }
    host.agentCards().show(request, event.sender.getZoomFactor())
  })
  ipcMain.on('agent-card:hide', (event, cardId: unknown) => {
    if (host.workspaceStartupFailure()) return
    host.assertMainShellSender(event)
    if (!validAgentCardId(cardId)) throw new TypeError('Invalid agent card id')
    host.agentCards().hide(cardId)
  })
  ipcMain.on('agent-card-view:measured', (event, value: unknown) => {
    assertAgentCardSender(event)
    const measurement = parseAgentCardMeasurement(value)
    if (measurement) host.agentCards().measured(measurement)
  })
  ipcMain.on('agent-card-view:message', (event, value: unknown) => {
    assertAgentCardSender(event)
    const message = parseAgentCardViewMessage(value)
    if (message) host.agentCards().received(message)
  })
  ipcMain.on('toast-overlay:show', (event, value: unknown) => {
    const refuse = (): void => {
      const id = toastOverlayRequestId(value)
      if (id !== undefined) host.toastOverlay().refused(id)
    }
    // As for the other shell overlays, nothing is drawn while startup has stopped; the shell keeps its own copy.
    if (host.workspaceStartupFailure()) {
      refuse()
      return
    }
    host.assertMainShellSender(event)
    let request: ToastOverlayRequest
    try {
      request = parseToastOverlayRequest(value)
    } catch (error) {
      // Nothing outside the contract is drawn; the shell hears the toast is not shown and shows its own copy.
      refuse()
      throw error
    }
    host.toastOverlay().show(request)
  })
  ipcMain.on('toast-overlay-view:measured', (event, value: unknown) => {
    assertToastOverlaySender(event)
    const measurement = parseToastOverlayMeasurement(value)
    if (measurement) host.toastOverlay().measured(measurement)
  })
  ipcMain.on('toast-overlay-view:message', (event, value: unknown) => {
    assertToastOverlaySender(event)
    const message = parseToastOverlayMessage(value)
    if (message) host.toastOverlay().received(message)
  })
  ipcMain.on('sidebar-overlay:show', (event, value: unknown) => {
    const refuse = (): void => {
      const id = sidebarOverlayRequestId(value)
      if (id !== undefined) host.sidebarOverlay().refused(id)
    }
    // Only the main window's shell numbers reveals; another sender's id could end one that is still to come.
    host.assertMainShellSender(event)
    // Nothing is drawn while startup has stopped; the shell opens its own rail beside the page.
    if (host.workspaceStartupFailure()) {
      refuse()
      return
    }
    let request: SidebarOverlayRequest
    try {
      request = parseSidebarOverlayRequest(value)
    } catch (error) {
      // Nothing outside the contract is drawn; the shell hears it and opens its own rail beside the page.
      refuse()
      throw error
    }
    host.sidebarOverlay().show(request)
  })
  ipcMain.on('sidebar-overlay:hide', (event, id: unknown) => {
    if (host.workspaceStartupFailure()) return
    host.assertMainShellSender(event)
    if (!validSidebarOverlayId(id)) throw new TypeError('Invalid sidebar overlay id')
    host.sidebarOverlay().hide(id)
  })
  ipcMain.on('sidebar-overlay-view:rendered', (event, value: unknown) => {
    assertSidebarOverlaySender(event)
    const report = parseSidebarOverlayRendered(value)
    if (report) host.sidebarOverlay().rendered(report)
  })
  ipcMain.on('sidebar-overlay-view:pointer', (event, value: unknown) => {
    assertSidebarOverlaySender(event)
    const pointer = parseSidebarOverlayPointer(value)
    if (pointer) host.sidebarOverlay().pointer(pointer)
  })
  ipcMain.on('sidebar-overlay-view:intent', (event, value: unknown) => {
    assertSidebarOverlaySender(event)
    const intent = parseSidebarOverlayIntent(value)
    if (intent) host.sidebarOverlay().received(intent)
  })
  // The rail's controls show their tooltips as the shell's do, beside the control in the tooltip view.
  ipcMain.on('sidebar-overlay-view:tooltip-show', (event, value: unknown) => {
    assertSidebarOverlaySender(event)
    const request = host.sidebarOverlay().tooltip(parseShellTooltipRequest(value))
    if (request) host.shellTooltips().show(request, event.sender.getZoomFactor())
  })
  ipcMain.on('sidebar-overlay-view:tooltip-hide', (event, id: unknown) => {
    assertSidebarOverlaySender(event)
    if (id !== undefined && !(Number.isSafeInteger(id) && (id as number) > 0)) throw new TypeError('Invalid tooltip id')
    // Only the rail's own tooltip; the shell's keep theirs.
    if (id === undefined) {
      const shown = host.shellTooltips().shownId
      if (shown !== undefined && shown > SIDEBAR_OVERLAY_TOOLTIP_ID_OFFSET) host.shellTooltips().hide(shown)
      return
    }
    host.shellTooltips().hide(SIDEBAR_OVERLAY_TOOLTIP_ID_OFFSET + (id as number))
  })
  ipcMain.on('tooltip-overlay:measured', (event, value: unknown) => {
    assertTooltipOverlaySender(event)
    const measurement = parseShellTooltipMeasurement(value)
    if (measurement) host.shellTooltips().measured(measurement)
  })
}
