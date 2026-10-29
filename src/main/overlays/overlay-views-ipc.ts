import type { IpcMain, IpcMainEvent } from 'electron'
import type { AgentCardOverlay } from './agent-card-overlay.js'
import type { ShellOverlayView } from './shell-overlay-view.js'
import type { ShellTooltipOverlay } from './shell-tooltip-overlay.js'
import type { ToastOverlay } from './toast-overlay.js'
import { SIDEBAR_OVERLAY_TOOLTIP_ID_OFFSET, type SidebarOverlay } from './sidebar-overlay.js'
import type { StatusBubbleOverlay } from './status-bubble-overlay.js'
import {
  parseAgentCardMeasurement,
  parseAgentCardShowRequest,
  parseAgentCardViewMessage,
  validAgentCardId,
  type AgentCardShowRequest
} from '../../shared/agent-card.js'
import { parseShellTooltipMeasurement, parseShellTooltipRequest } from '../../shared/shell-tooltip.js'
import { parseStatusBubbleMeasurement } from '../../shared/status-bubble.js'
import {
  parseSidebarOverlayIntent,
  parseSidebarOverlayPointer,
  parseSidebarOverlayRendered,
  parseSidebarOverlayRequest,
  sidebarOverlayRequestId,
  validSidebarOverlayId,
  type SidebarOverlayRequest
} from '../../shared/sidebar-overlay.js'
import {
  parseToastOverlayMeasurement,
  parseToastOverlayMessage,
  parseToastOverlayRequest,
  toastOverlayRequestId,
  type ToastOverlayRequest
} from '../../shared/toast-overlay.js'

interface OverlayViewsIpcHost {
  /** Whether a message came from the main window's shell document, whether or not saved workspaces started. */
  isMainShellSender(event: IpcMainEvent): boolean
  /** Admits only the main window's shell document, not a detached panel window, and nothing after a failed startup. */
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
  statusBubble(): Pick<StatusBubbleOverlay, 'measured'>
  /** The view that draws the status bubble at a page's corner. */
  statusBubbleView(): Pick<ShellOverlayView, 'isSender'>
}

/**
 * The shell's requests to show and hide tooltips, agent cards, toasts and the open tab rail drawn in overlay views
 * above the pages, and those views' own reports, with the status bubble's. Dependencies stay lazy because handlers are
 * registered before the window loads.
 */
export function registerOverlayViewsIpc(ipcMain: Pick<IpcMain, 'on'>, host: OverlayViewsIpcHost): void {
  // Each overlay view reports only for itself. Its last reports can still arrive after the window closed it, or after a
  // new view replaced it, and nothing waits for an answer to them, so a report from anything but the current view is
  // dropped rather than thrown, which would be an uncaught exception in main.
  function fromAgentCardView(event: Electron.IpcMainEvent): boolean {
    return host.agentCardView().isSender(event)
  }

  function fromToastOverlayView(event: Electron.IpcMainEvent): boolean {
    return host.toastOverlayView().isSender(event)
  }

  function fromTooltipView(event: Electron.IpcMainEvent): boolean {
    return host.tooltipView().isSender(event)
  }

  function fromSidebarOverlayView(event: Electron.IpcMainEvent): boolean {
    return host.sidebarOverlayView().isSender(event)
  }

  function fromStatusBubbleView(event: Electron.IpcMainEvent): boolean {
    return host.statusBubbleView().isSender(event)
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
    if (!fromAgentCardView(event)) return
    const measurement = parseAgentCardMeasurement(value)
    if (measurement) host.agentCards().measured(measurement)
  })
  ipcMain.on('agent-card-view:message', (event, value: unknown) => {
    if (!fromAgentCardView(event)) return
    const message = parseAgentCardViewMessage(value)
    if (message) host.agentCards().received(message)
  })
  ipcMain.on('toast-overlay:show', (event, value: unknown) => {
    const refuse = (): void => {
      const id = toastOverlayRequestId(value)
      if (id !== undefined) host.toastOverlay().refused(id)
    }
    // As for the other shell overlays, nothing is drawn while startup has stopped; the shell keeps its own copy. Only the
    // main window's shell hears so, as for the rail below.
    if (host.workspaceStartupFailure()) {
      if (host.isMainShellSender(event)) refuse()
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
    if (!fromToastOverlayView(event)) return
    const measurement = parseToastOverlayMeasurement(value)
    if (measurement) host.toastOverlay().measured(measurement)
  })
  ipcMain.on('toast-overlay-view:message', (event, value: unknown) => {
    if (!fromToastOverlayView(event)) return
    const message = parseToastOverlayMessage(value)
    if (message) host.toastOverlay().received(message)
  })
  ipcMain.on('sidebar-overlay:show', (event, value: unknown) => {
    const refuse = (): void => {
      const id = sidebarOverlayRequestId(value)
      if (id !== undefined) host.sidebarOverlay().refused(id)
    }
    // Only the main window's shell numbers reveals; another sender's id could end one that is still to come.
    // Nothing is drawn while startup has stopped: the shell hears so and opens its own rail beside the page. The sender
    // check below throws then for the shell as well, so the shell is recognized here first.
    if (host.workspaceStartupFailure()) {
      if (host.isMainShellSender(event)) refuse()
      return
    }
    host.assertMainShellSender(event)
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
    if (!fromSidebarOverlayView(event)) return
    const report = parseSidebarOverlayRendered(value)
    if (report) host.sidebarOverlay().rendered(report)
  })
  ipcMain.on('sidebar-overlay-view:pointer', (event, value: unknown) => {
    if (!fromSidebarOverlayView(event)) return
    const pointer = parseSidebarOverlayPointer(value)
    if (pointer) host.sidebarOverlay().pointer(pointer)
  })
  ipcMain.on('sidebar-overlay-view:intent', (event, value: unknown) => {
    if (!fromSidebarOverlayView(event)) return
    const intent = parseSidebarOverlayIntent(value)
    if (intent) host.sidebarOverlay().received(intent)
  })
  // The rail's controls show their tooltips as the shell's do, beside the control in the tooltip view.
  ipcMain.on('sidebar-overlay-view:tooltip-show', (event, value: unknown) => {
    if (!fromSidebarOverlayView(event)) return
    const request = host.sidebarOverlay().tooltip(parseShellTooltipRequest(value))
    if (request) host.shellTooltips().show(request, event.sender.getZoomFactor())
  })
  ipcMain.on('sidebar-overlay-view:tooltip-hide', (event, id: unknown) => {
    if (!fromSidebarOverlayView(event)) return
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
    if (!fromTooltipView(event)) return
    const measurement = parseShellTooltipMeasurement(value)
    if (measurement) host.shellTooltips().measured(measurement)
  })
  ipcMain.on('status-bubble:measured', (event, value: unknown) => {
    if (!fromStatusBubbleView(event)) return
    const measurement = parseStatusBubbleMeasurement(value)
    if (measurement) host.statusBubble().measured(measurement)
  })
}
